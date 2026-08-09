import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export type Protocol = 'tcp' | 'udp';

/**
 * Shape of a game's answer to its players query, so the code can count players
 * without knowing any particular game:
 * - 'csv'      header row then one row per player (ex Palworld)
 * - 'sentence' names after the last colon, comma-separated (ex Minecraft)
 * - 'lines'    one player per line
 * Omit it when the answer fits none of these: /stop then cannot check for
 * connected players and stops the server as before.
 */
export type PlayersFormat = 'csv' | 'sentence' | 'lines';

const PLAYERS_FORMATS: readonly string[] = ['csv', 'sentence', 'lines'];

/**
 * Source RCON endpoint. The protocol is the same for every game that speaks it.
 */
export interface RconConfig {
	readonly host: string;
	readonly port: number;
	readonly password: string;
	readonly playersCommand: string;
	readonly playersFormat?: PlayersFormat;
}

export interface ServerConfig {
	readonly label: string;
	readonly unit: string;
	readonly port: number;
	readonly protocol: Protocol;
	readonly address: string;
	readonly startupMs: number;
	readonly password?: string;
	readonly adminInfo?: string;
	readonly roleId?: string;
	readonly adminRoleId?: string;
	readonly rcon?: RconConfig;
}

export type Servers = ReadonlyMap<string, ServerConfig>;

const DEFAULT_STARTUP_MS = 120_000;
// Discord interaction tokens expire after 15 minutes; the final editReply after
// waitFor() must land before that, so cap the configurable wait at 14 minutes.
const MAX_STARTUP_MS = 840_000;
const DEFAULT_RCON_HOST = '127.0.0.1';
const SERVERS_PATH = process.env['SERVERS_PATH'];
export const SERVERS = loadServers(
	SERVERS_PATH !== undefined && SERVERS_PATH !== ''
		? pathToFileURL(SERVERS_PATH)
		: new URL('../../servers.json', import.meta.url)
);
export const VERSION = loadVersion(new URL('../../package.json', import.meta.url));

/**
 * Project version from package.json. Display-only, so failures soft-fail
 * to 'unknown' instead of refusing to boot.
 *
 * @param {URL} path - package.json location, relative to the compiled file.
 * @returns {string} The version field, or 'unknown'.
 */
function loadVersion(path: URL): string {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
		if (typeof parsed === 'object' && parsed !== null) {
			const v = (parsed as Record<string, unknown>)['version'];
			if (typeof v === 'string' && v !== '') return v;
		}
	} catch {
		// Fall through.
	}
	return 'unknown';
}

/**
 * A mandatory non-empty string field, or a config error naming it.
 *
 * @param {Record<string, unknown>} o - Parsed server entry.
 * @param {string} key - Field to read.
 * @param {string} where - Server key, for the error message.
 * @returns {string}
 */
function requireString(o: Record<string, unknown>, key: string, where: string): string {
	const v = o[key];
	if (typeof v !== 'string' || v.trim() === '')
		throw new Error(`servers.json: ${where}.${key} must be a non-empty string`);
	return v;
}

/**
 * Narrows an unvalidated value to a supported players format.
 *
 * @param {unknown} v - Value from the config file.
 * @returns {v is PlayersFormat} True when it names a supported format.
 */
function isPlayersFormat(v: unknown): v is PlayersFormat {
	return typeof v === 'string' && PLAYERS_FORMATS.includes(v);
}

/**
 * Validates the optional rcon block. The bot and the games share a host, so
 * host defaults to loopback — keep the RCON port off the public interface.
 *
 * @param {string} key - Server key, used in error messages.
 * @param {unknown} raw - Unvalidated rcon block.
 * @returns {RconConfig} The validated block, defaults applied.
 */
function parseRcon(key: string, raw: unknown): RconConfig {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		throw new Error(`servers.json: ${key}.rcon must be an object`);
	}
	const o = raw as Record<string, unknown>;

	const port = o['port'];
	if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error(`servers.json: ${key}.rcon.port must be an integer between 1 and 65535`);
	}

	const host = o['host'];
	if (host !== undefined && (typeof host !== 'string' || host.trim() === '')) {
		throw new Error(`servers.json: ${key}.rcon.host must be a non-empty string if present`);
	}

	const playersFormat = o['playersFormat'];
	if (playersFormat !== undefined && !isPlayersFormat(playersFormat)) {
		throw new Error(
			`servers.json: ${key}.rcon.playersFormat must be one of ${PLAYERS_FORMATS.join(', ')}`
		);
	}

	return {
		host: typeof host === 'string' ? host : DEFAULT_RCON_HOST,
		port,
		password: requireString(o, 'password', `${key}.rcon`),
		playersCommand: requireString(o, 'playersCommand', `${key}.rcon`),
		...(isPlayersFormat(playersFormat) ? { playersFormat } : {})
	};
}

/**
 * Validates one servers.json entry. JSON.parse returns any; this boundary is
 * what makes every field trustworthy downstream.
 *
 * @param {string} key - Server key, used in error messages.
 * @param {unknown} raw - Unvalidated entry.
 * @returns {ServerConfig} The validated entry, defaults applied.
 */
function parseServer(key: string, raw: unknown): ServerConfig {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		throw new Error(`servers.json: ${key} must be an object`);
	}
	const o = raw as Record<string, unknown>;

	const port = o['port'];
	if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error(`servers.json: ${key}.port must be an integer between 1 and 65535`);
	}

	const protocol = o['protocol'];
	if (protocol !== 'tcp' && protocol !== 'udp') {
		throw new Error(`servers.json: ${key}.protocol must be 'tcp' or 'udp'`);
	}

	const startupRaw = o['startupMs'];
	if (
		startupRaw !== undefined &&
		(typeof startupRaw !== 'number' || startupRaw <= 0 || startupRaw > MAX_STARTUP_MS)
	) {
		throw new Error(
			`servers.json: ${key}.startupMs must be a positive number of ms, at most ${MAX_STARTUP_MS}`
		);
	}

	const password = o['password'];
	if (password !== undefined && typeof password !== 'string') {
		throw new Error(`servers.json: ${key}.password must be a string if present`);
	}

	const adminInfo = o['adminInfo'];
	if (adminInfo !== undefined && typeof adminInfo !== 'string') {
		throw new Error(`servers.json: ${key}.adminInfo must be a string if present`);
	}

	const roleId = o['roleId'];
	if (roleId !== undefined && typeof roleId !== 'string') {
		throw new Error(`servers.json: ${key}.roleId must be a string if present`);
	}

	const adminRoleId = o['adminRoleId'];
	if (adminRoleId !== undefined && typeof adminRoleId !== 'string') {
		throw new Error(`servers.json: ${key}.adminRoleId must be a string if present`);
	}

	const rconRaw = o['rcon'];
	const rcon = rconRaw === undefined ? undefined : parseRcon(key, rconRaw);

	return {
		label: requireString(o, 'label', key),
		unit: requireString(o, 'unit', key),
		address: requireString(o, 'address', key),
		port,
		protocol,
		startupMs: typeof startupRaw === 'number' ? startupRaw : DEFAULT_STARTUP_MS,
		...(typeof password === 'string' ? { password } : {}),
		...(typeof adminInfo === 'string' ? { adminInfo } : {}),
		...(typeof roleId === 'string' ? { roleId } : {}),
		...(typeof adminRoleId === 'string' ? { adminRoleId } : {}),
		...(rcon !== undefined ? { rcon } : {})
	};
}

/**
 * Loads and validates servers.json. A malformed file fails at startup with
 * the offending field named, instead of surfacing as undefined inside a
 * systemctl invocation.
 *
 * @param {URL} path - servers.json location, relative to the compiled file.
 * @returns {Servers} Immutable map of server key to validated config.
 */
export function loadServers(path: URL): Servers {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, 'utf8'));
	} catch (err) {
		throw new Error(`Could not read ${path.pathname}: ${(err as Error).message}`);
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error(`servers.json: root must be an object keyed by server name`);
	}

	const map = new Map<string, ServerConfig>();
	for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
		if (!/^[a-z0-9-]+$/.test(key)) {
			throw new Error(`servers.json: ${key} key must be lowercase letters, digits and hyphens`);
		}
		map.set(key, parseServer(key, raw));
	}
	if (map.size === 0) throw new Error(`servers.json: root defines no servers`);
	if (map.size > 25) throw new Error(`servers.json: Discord allows at most 25 choices per option`);

	return map;
}

/**
 * A mandatory environment variable, or a startup error naming it.
 *
 * @param {string} name - Variable name.
 * @returns {string} Its non-empty value.
 */
export function requireEnv(name: string): string {
	const v = process.env[name];
	if (v === undefined || v === '') throw new Error(`Missing environment variable ${name}`);
	return v;
}
