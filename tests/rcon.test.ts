import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodePackets, encodePacket } from '../dist/server/rcon.js';

test('a packet round-trips through encode and decode', () => {
	const { packets, rest } = decodePackets(encodePacket(7, 2, 'ShowPlayers'));
	assert.equal(packets.length, 1);
	assert.deepEqual(packets[0], { id: 7, type: 2, body: 'ShowPlayers' });
	assert.equal(rest.length, 0);
});

test('an empty body round-trips', () => {
	const { packets } = decodePackets(encodePacket(1, 0, ''));
	assert.deepEqual(packets[0], { id: 1, type: 0, body: '' });
});

test('a multi-byte body round-trips', () => {
	// The size field counts bytes.
	const { packets } = decodePackets(encodePacket(1, 0, 'jörmungandr — 🐍'));
	assert.equal(packets[0]?.body, 'jörmungandr — 🐍');
});

test('two packets in one buffer decode in order', () => {
	const wire = Buffer.concat([encodePacket(1, 2, 'auth ok'), encodePacket(2, 0, 'answer')]);
	const { packets, rest } = decodePackets(wire);
	assert.deepEqual(
		packets.map((p) => p.body),
		['auth ok', 'answer']
	);
	assert.equal(rest.length, 0);
});

test('every possible chunk split still yields the same packets', () => {
	// Decode the complete packets and keep the remainder pending for the next chunk.
	const wire = Buffer.concat([
		encodePacket(1, 2, 'x'),
		encodePacket(2, 0, 'There are 2 of a max of 20 players online: a, b')
	]);
	for (let cut = 0; cut <= wire.length; cut++) {
		const first = decodePackets(wire.subarray(0, cut));
		const second = decodePackets(Buffer.concat([first.rest, wire.subarray(cut)]));
		const bodies = [...first.packets, ...second.packets].map((p) => p.body);
		assert.deepEqual(
			bodies,
			['x', 'There are 2 of a max of 20 players online: a, b'],
			`split at byte ${cut}`
		);
	}
});

test('fewer than four bytes decode to nothing and stay pending', () => {
	const { packets, rest } = decodePackets(Buffer.from([1, 2, 3]));
	assert.equal(packets.length, 0);
	assert.equal(rest.length, 3);
});

test('a desynced stream throws instead of decoding garbage', () => {
	const tooSmall = Buffer.alloc(8);
	tooSmall.writeInt32LE(4, 0);
	assert.throws(() => decodePackets(tooSmall), /out of sync/);

	const tooBig = Buffer.alloc(8);
	tooBig.writeInt32LE(1_000_000, 0);
	assert.throws(() => decodePackets(tooBig), /out of sync/);
});
