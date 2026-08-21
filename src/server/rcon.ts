import { createConnection } from 'node:net';

import type { RconConfig } from '../core/cfg.js';

// Source RCON packet types. AUTH_RESPONSE and EXEC share the value 2.
const PACKET_AUTH = 3;
const PACKET_AUTH_RESPONSE = 2;
const PACKET_EXEC = 2;
const PACKET_RESPONSE = 0;

const AUTH_ID = 1;
const EXEC_ID = 2;

// Max time budget for answering loop.
const DEADLINE_MS = 10_000;
// Long answers arrive as several packets back to back, expect stragglers.
const DRAIN_MS = 250;
// Source RCON caps packets at 4096 bytes; anything larger is a desync.
const MAX_PACKET_SIZE = 8_192;

interface RconPacket {
	readonly id: number;
	readonly type: number;
	readonly body: string;
}

/**
 * Builds one RCON packet: little-endian size, id and type, then the body and
 * two terminating nulls.
 *
 * @param {number} id - Request id, echoed by the server.
 * @param {number} type - Packet type constant.
 * @param {string} body - Command or password text.
 * @returns {Buffer} The wire-format packet.
 */
export function encodePacket(id: number, type: number, body: string): Buffer {
	const bodyBuf = Buffer.from(body, 'utf8');
	// id + type + body + the two nulls.
	const size = bodyBuf.length + 10;
	const buf = Buffer.alloc(size + 4);
	buf.writeInt32LE(size, 0);
	buf.writeInt32LE(id, 4);
	buf.writeInt32LE(type, 8);
	bodyBuf.copy(buf, 12);
	return buf;
}

/**
 * Splits whatever has arrived so far into complete packets, keeping the
 * trailing partial packet for the next chunk.
 *
 * @param {Buffer} buffer - Bytes received but not yet parsed.
 * @returns {{ packets: RconPacket[]; rest: Buffer }} Complete packets and the remainder.
 */
export function decodePackets(buffer: Buffer): { packets: RconPacket[]; rest: Buffer } {
	const packets: RconPacket[] = [];
	let offset = 0;
	while (buffer.length - offset >= 4) {
		const size = buffer.readInt32LE(offset);
		if (size < 10 || size > MAX_PACKET_SIZE) {
			throw new Error('RCON stream out of sync');
		}
		if (buffer.length - offset - 4 < size) break;
		packets.push({
			id: buffer.readInt32LE(offset + 4),
			type: buffer.readInt32LE(offset + 8),
			// Body runs to the two trailing nulls.
			body: buffer.toString('utf8', offset + 12, offset + 4 + size - 2)
		});
		offset += 4 + size;
	}
	return { packets, rest: buffer.subarray(offset) };
}

/**
 * Authenticates against a Source RCON endpoint and runs one command.
 * The protocol is game-agnostic
 *
 * @param {RconConfig} rcon - Endpoint and credentials from the server config.
 * @param {string} command - Command to execute, e.g. 'list' or 'ShowPlayers'.
 * @returns {Promise<string>} The server's raw text answer.
 */
export async function rconExec(rcon: RconConfig, command: string): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const socket = createConnection({ host: rcon.host, port: rcon.port });
		const bodies: string[] = [];
		// Weird ts bug for node 20.
		// alloc() returns the narrower Buffer<ArrayBuffer>, but
		// subarray() hands back Buffer<ArrayBufferLike> on every reassignment.
		let pending: Buffer = Buffer.alloc(0);
		let authed = false;
		let settled = false;
		let drainTimer: NodeJS.Timeout | undefined;

		const deadline = setTimeout(() => {
			finish(new Error(`RCON timed out after ${DEADLINE_MS}ms`));
		}, DEADLINE_MS);

		/**
		 * Resolves or rejects once, clearing timers and the socket either way.
		 *
		 * @param {Error | undefined} err - Failure, or undefined on success.
		 * @returns {void}
		 */
		function finish(err?: Error): void {
			if (settled) return;
			settled = true;
			clearTimeout(deadline);
			clearTimeout(drainTimer);
			socket.destroy();
			if (err !== undefined) reject(err);
			else resolve(bodies.join('').trim());
		}

		/**
		 * Decodes one TCP chunk and advances the exchange: authenticate first,
		 * then collect answer bodies. Partial packets stay buffered in pending.
		 *
		 * @param {Buffer} chunk - Bytes delivered by the socket.
		 * @returns {void}
		 */
		function handleChunk(chunk: Buffer): void {
			let packets: RconPacket[];
			try {
				const decoded = decodePackets(Buffer.concat([pending, chunk]));
				packets = decoded.packets;
				pending = decoded.rest;
			} catch (err) {
				finish(err as Error);
				return;
			}

			for (const packet of packets) {
				if (!authed) {
					// Some servers send an empty RESPONSE_VALUE before the verdict.
					if (packet.type !== PACKET_AUTH_RESPONSE) continue;
					if (packet.id === -1) {
						finish(new Error('RCON authentication failed'));
						return;
					}
					authed = true;
					socket.write(encodePacket(EXEC_ID, PACKET_EXEC, command));
					continue;
				}
				if (packet.type !== PACKET_RESPONSE) continue;
				bodies.push(packet.body);
				// Ids are echoed inconsistently across implementations, so end the
				// exchange on a quiet gap rather than on a sentinel packet.
				clearTimeout(drainTimer);
				drainTimer = setTimeout(() => finish(), DRAIN_MS);
			}
		}

		socket.on('connect', () => {
			socket.write(encodePacket(AUTH_ID, PACKET_AUTH, rcon.password));
		});

		socket.on('data', handleChunk);

		socket.on('error', (err) => finish(err));
		socket.on('close', () => {
			if (authed) finish();
			else finish(new Error('RCON connection closed before authentication'));
		});
	});
}
