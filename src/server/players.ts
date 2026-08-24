import type { PlayersFormat, ServerConfig } from '../core/cfg.ts';
import { rconExec } from './rcon.ts';

/**
 * Names out of a CSV answer: a header row, then one row per player with the
 * name first. The header is dropped only when its first field is literally
 * 'name', so a headerless table still parses.
 *
 * @param {string[]} lines - Non-empty trimmed lines of the answer.
 * @returns {string[]} Player names.
 */
function fromCsv(lines: string[]): string[] {
	const rows = lines[0]?.split(',')[0]?.trim().toLowerCase() === 'name' ? lines.slice(1) : lines;
	return rows.map((line) => line.split(',')[0]?.trim() ?? '').filter((name) => name !== '');
}

/**
 * Names out of a sentence answer: everything after the last colon, split on
 * commas ('There are 2 of a max of 20 players online: alice, bob').
 *
 * @param {string[]} lines - Non-empty trimmed lines of the answer.
 * @returns {string[]} Player names.
 */
function fromSentence(lines: string[]): string[] {
	const text = lines.join(' ');
	const colon = text.lastIndexOf(':');
	if (colon === -1) return [];
	return text
		.slice(colon + 1)
		.split(',')
		.map((name) => name.trim())
		.filter((name) => name !== '');
}

/**
 * Player names in a game's answer. Only generic text shapes are understood;
 * which shape a game speaks comes from its config, so no game-specific
 * knowledge lives here.
 *
 * @param {string} answer - Raw RCON answer.
 * @param {PlayersFormat} format - Shape declared by the server config.
 * @returns {string[]} Player names, empty when nobody is connected.
 */
export function parsePlayers(answer: string, format: PlayersFormat): string[] {
	const lines = answer
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '');
	if (lines.length === 0) return [];

	switch (format) {
		case 'csv':
			return fromCsv(lines);
		case 'sentence':
			return fromSentence(lines);
		case 'lines':
		default:
			return lines;
	}
}

/**
 * Player names in an answer, or undefined when the answer says nothing at all.
 * A healthy endpoint always replies with something so a blank answer means
 * the query failed and must never be read as "nobody is connected".
 *
 * @param {string} answer - Raw RCON answer.
 * @param {PlayersFormat} format - Shape declared by the server config.
 * @returns {string[] | undefined} Player names, or undefined when unknown.
 */
export function playersFromAnswer(answer: string, format: PlayersFormat): string[] | undefined {
	if (answer.trim() === '') return undefined;
	return parsePlayers(answer, format);
}

/**
 * Who is connected right now, as far as the bot can tell. Undefined means the
 * question is unanswerable — no RCON configured, no playersFormat to read the
 * answer with, or the endpoint did not answer usefully — which callers must
 * treat as "unknown", never as "nobody".
 *
 * @param {ServerConfig} srv - Server to query.
 * @returns {Promise<string[] | undefined>} Connected players, or undefined when unknown.
 */
export async function connectedPlayers(srv: ServerConfig): Promise<string[] | undefined> {
	const rcon = srv.rcon;
	if (rcon?.playersFormat === undefined) return undefined;
	try {
		return playersFromAnswer(await rconExec(rcon, rcon.playersCommand), rcon.playersFormat);
	} catch {
		// A dead RCON port tells us nothing about who is playing.
		return undefined;
	}
}
