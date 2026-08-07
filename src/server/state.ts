import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Protocol, ServerConfig } from '../core/cfg.js';

const run = promisify(execFile);

export type ServerState = 'running' | 'starting' | 'stopped' | 'failed' | 'unknown';

/**
 * Extracts stdout from a failed execFile call. `systemctl is-active` exits
 * non-zero when not active, so the answer arrives via the error.
 *
 * @param {unknown} err - Error thrown by execFile.
 * @returns {string} Captured stdout, or '' when absent.
 */
function stdoutOf(err: unknown): string {
	if (typeof err === 'object' && err !== null && 'stdout' in err) {
		const s = (err as { stdout?: unknown }).stdout;
		if (typeof s === 'string') return s;
	}
	return '';
}

/**
 * Raw systemd state of a unit.
 *
 * @param {string} unit - systemd unit name.
 * @returns {Promise<string>} active, activating, inactive, failed, … or 'unknown'.
 */
async function unitState(unit: string): Promise<string> {
	try {
		const { stdout } = await run('systemctl', ['is-active', unit]);
		return stdout.trim();
	} catch (err) {
		return stdoutOf(err).trim() || 'unknown';
	}
}

/**
 * True if something on this machine listens on the port. ss does the
 * filtering — a substring match on its output would false-positive.
 *
 * @param {number} port - Port the game binds.
 * @param {Protocol} protocol - 'tcp' or 'udp'.
 * @returns {Promise<boolean>}
 */
async function isListening(port: number, protocol: Protocol): Promise<boolean> {
	try {
		const { stdout } = await run('ss', [
			protocol === 'tcp' ? '-Htln' : '-Huln',
			`sport = :${port}`
		]);
		return stdout.trim() !== '';
	} catch {
		return false;
	}
}

/**
 * A unit reports active the moment it starts, but a game server isn't playable
 * until it opens its socket. Those are different states
 * and conflating them makes friends mash the start button.
 *
 * @param {ServerConfig} srv - Server to inspect.
 * @returns {Promise<ServerState>} Combined unit + socket state.
 */
export async function getState(srv: ServerConfig): Promise<ServerState> {
	const state = await unitState(srv.unit);
	if (state === 'failed') return 'failed';
	if (state === 'activating') return 'starting';
	if (state !== 'active') return state === 'inactive' ? 'stopped' : 'unknown';
	return (await isListening(srv.port, srv.protocol)) ? 'running' : 'starting';
}

/**
 * Starts the unit via sudo. Argument arrays, not shell strings: no
 * interpolation, so no injection surface.
 *
 * @param {string} unit - systemd unit name from the validated config.
 * @returns {Promise<void>}
 */
export async function startUnit(unit: string): Promise<void> {
	await run('sudo', ['-n', 'systemctl', 'start', unit]);
}

/**
 * Stops the unit via sudo. Same argument-array rationale as @see startUnit.
 *
 * @param {string} unit - systemd unit name from the validated config.
 * @returns {Promise<void>}
 */
export async function stopUnit(unit: string): Promise<void> {
	await run('sudo', ['-n', 'systemctl', 'stop', unit]);
}

/**
 * True if sudoers permits `systemctl <verb> <unit>` for this user. Used at
 * startup so a config/sudoers mismatch surfaces in the journal, not at 2am.
 *
 * @param {'start' | 'stop'} verb - systemctl verb to probe.
 * @param {string} unit - systemd unit name.
 * @returns {Promise<boolean>}
 */
export async function sudoAllows(verb: 'start' | 'stop', unit: string): Promise<boolean> {
	try {
		await run('sudo', ['-n', '-l', '/usr/bin/systemctl', verb, unit]);
		return true;
	} catch {
		return false;
	}
}

/**
 * Polls every 5s until the server reaches the target state. The deadline
 * comes from startupMs, which config caps under Discord's 15-minute
 * interaction-token lifetime so the reply after the wait can still be sent.
 *
 * @param {ServerConfig} srv - Server to watch.
 * @param {ServerState} target - State to wait for.
 * @returns {Promise<boolean>} True when reached, false on timeout.
 */
export async function waitFor(srv: ServerConfig, target: ServerState): Promise<boolean> {
	const deadline = Date.now() + srv.startupMs;
	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 5_000));
		if ((await getState(srv)) === target) return true;
	}
	return false;
}

/**
 * One-line Discord message for a server in a given state. No default branch:
 * adding a ServerState member is a compile error here, not a missing message.
 *
 * @param {ServerConfig} srv - Server being described.
 * @param {ServerState} state - Its current state.
 * @returns {string} Markdown line with a status emoji.
 */
export function describe(srv: ServerConfig, state: ServerState): string {
	switch (state) {
		case 'running':
			return `🟢 **${srv.label}** · \`${srv.address}:${srv.port}\``;
		case 'starting':
			return `🟡 **${srv.label}** — starting, give it a minute`;
		case 'stopped':
			return `🔴 **${srv.label}** — stopped`;
		case 'failed':
			return `⚠️ **${srv.label}** — failed (\`journalctl -u ${srv.unit}\`)`;
		case 'unknown':
			return `❓ **${srv.label}** — state unknown`;
	}
}
