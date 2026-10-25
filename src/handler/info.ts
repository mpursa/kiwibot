import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';

import { ServerConfig } from '../core/cfg.ts';
import { Command } from '../discord/commands.ts';
import { rconExec } from '../server/rcon.ts';
import { describe, type ServerState } from '../server/state.ts';

// Discord max msg is 2k char. Leave room for code fences.
const MAX_RCON_REPLY = 1_800;

/**
 * One-line state plus the server's standing policies.
 *
 * @param {ServerConfig} srv - Server being described.
 * @param {ServerState} state - Its current state.
 * @returns {string} The describe() line, plus one line per configured policy.
 */
export function statusResponse(srv: ServerConfig, state: ServerState): string {
	const lines = [describe(srv, state)];
	if (srv.autoStopMinutes !== undefined) {
		lines.push(`⏲️ auto-stops after ${srv.autoStopMinutes} minutes with nobody connected`);
	}
	if (srv.stopDelayMinutes !== undefined) {
		lines.push(
			`⏳ /${Command.SERVER_STOP} waits ${srv.stopDelayMinutes} minutes by default — \`delay:0\` skips the wait`
		);
	}
	return lines.join('\n');
}

/**
 * Ephemeral reply with the address (host:port) players connect to.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @param {ServerConfig} srv - Target server.
 * @returns {Promise<void>}
 */
export async function addressResponse(
	interaction: ChatInputCommandInteraction,
	srv: ServerConfig
): Promise<void> {
	await interaction.reply({
		content: `Address for server ${srv.label} -> \`${srv.address}:${srv.port}\``,
		flags: MessageFlags.Ephemeral
	});
}

/**
 * Relays the game's own answer to its players query over RCON. The reply is
 * not parsed: every game words it differently, and passing the text through is
 * what keeps this command game-agnostic. Defers first — RCON is network I/O.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @param {ServerConfig} srv - Target server.
 * @returns {Promise<void>}
 */
export async function playersResponse(
	interaction: ChatInputCommandInteraction,
	srv: ServerConfig
): Promise<void> {
	const rcon = srv.rcon;
	if (rcon === undefined) {
		await interaction.reply({
			content: `Server ${srv.label} has no RCON set!`,
			flags: MessageFlags.Ephemeral
		});
		return;
	}
	await interaction.deferReply();
	let answer: string;
	try {
		answer = await rconExec(rcon, rcon.playersCommand);
	} catch (err) {
		// A dead RCON port is ordinary (server stopped), not a bot failure.
		await interaction.editReply(
			`❓ Could not reach **${srv.label}** over RCON: ${(err as Error).message}`
		);
		return;
	}
	if (answer === '') {
		await interaction.editReply(`**${srv.label}** returned no player info.`);
		return;
	}
	const body = answer.length > MAX_RCON_REPLY ? `${answer.slice(0, MAX_RCON_REPLY)}…` : answer;
	await interaction.editReply(`**${srv.label}** players:\n\`\`\`\n${body}\n\`\`\``);
}

/**
 * Ephemeral reply with the server's join password, when configured.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @param {ServerConfig} srv - Target server.
 * @returns {Promise<void>}
 */
export async function passwordResponse(
	interaction: ChatInputCommandInteraction,
	srv: ServerConfig
): Promise<void> {
	await interaction.reply({
		content:
			srv.password !== undefined
				? `Password for server ${srv.label} -> ${srv.password}`
				: `Server ${srv.label} does not have a password!`,
		flags: MessageFlags.Ephemeral
	});
}

/**
 * Ephemeral reply with the name to look for in the game's server browser,
 * when configured.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @param {ServerConfig} srv - Target server.
 * @returns {Promise<void>}
 */
export async function searchResponse(
	interaction: ChatInputCommandInteraction,
	srv: ServerConfig
): Promise<void> {
	await interaction.reply({
		content:
			srv.search !== undefined
				? `Search name for server ${srv.label} -> \`${srv.search.name}\``
				: `Server ${srv.label} does not have search info!`,
		flags: MessageFlags.Ephemeral
	});
}

/**
 * Ephemeral reply with the server's admin info text, when configured.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @param {ServerConfig} srv - Target server.
 * @returns {Promise<void>}
 */
export async function adminInfoResponse(
	interaction: ChatInputCommandInteraction,
	srv: ServerConfig
): Promise<void> {
	await interaction.reply({
		content:
			srv.adminInfo !== undefined
				? `Admin info for server ${srv.label}\n${srv.adminInfo}`
				: `No Admin info set for server ${srv.label}`,
		flags: MessageFlags.Ephemeral
	});

	return;
}
