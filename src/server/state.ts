import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Protocol, ServerConfig } from '../core/cfg.js';

const run = promisify(execFile);

export type ServerState = 'running' | 'starting' | 'stopped' | 'failed' | 'unknown';

/** `systemctl is-active` exits non-zero when not active, so the answer arrives via the error. */
function stdoutOf(err: unknown): string {
	if (typeof err === 'object' && err !== null && 'stdout' in err) {
		const s = (err as { stdout?: unknown }).stdout;
		if (typeof s === 'string') return s;
	}
	return '';
}

async function unitState(unit: string): Promise<string> {
	try {
		const { stdout } = await run('systemctl', ['is-active', unit]);
		return stdout.trim();
	} catch (err) {
		return stdoutOf(err).trim() || 'unknown';
	}
}

async function isListening(port: number, protocol: Protocol): Promise<boolean> {
	try {
		// Let ss filter by port. A substring match on the output would
		// false-positive: ":80" matches ":8080".
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
 * until it opens its socket — 30-90s for Palworld. Those are different states
 * and conflating them makes friends mash the start button.
 */
export async function getState(srv: ServerConfig): Promise<ServerState> {
	const state = await unitState(srv.unit);
	if (state === 'failed') return 'failed';
	if (state === 'activating') return 'starting';
	if (state !== 'active') return state === 'inactive' ? 'stopped' : 'unknown';
	return (await isListening(srv.port, srv.protocol)) ? 'running' : 'starting';
}

// Argument arrays, not shell strings: no interpolation, so no injection surface.
export async function startUnit(unit: string): Promise<void> {
	await run('sudo', ['-n', 'systemctl', 'start', unit]);
}

export async function stopUnit(unit: string): Promise<void> {
	await run('sudo', ['-n', 'systemctl', 'stop', unit]);
}

/** True if sudoers permits `systemctl <verb> <unit>` for this user. */
export async function sudoAllows(verb: 'start' | 'stop', unit: string): Promise<boolean> {
	try {
		await run('sudo', ['-n', '-l', '/usr/bin/systemctl', verb, unit]);
		return true;
	} catch {
		return false;
	}
}

export async function waitFor(srv: ServerConfig, target: ServerState): Promise<boolean> {
	const deadline = Date.now() + srv.startupMs;
	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 5_000));
		if ((await getState(srv)) === target) return true;
	}
	return false;
}

export function describe(srv: ServerConfig, state: ServerState): string {
	switch (state) {
		case 'running':
			return `🟢 **${srv.label}** · \`${srv.address}\``;
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
