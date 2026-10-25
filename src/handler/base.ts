import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';

import { reloadServers, REPO_URL, SERVERS, VERSION, VERSION_CHANGELOG } from '../core/cfg.ts';
import { COMMANDS } from '../discord/commands.ts';
import { hasServerRole } from '../discord/roles.ts';
import { connectedPlayers } from '../server/players.ts';
import { describe, getState } from '../server/state.ts';

// A changelog entry must leave room for the version line and link.
const MAX_CHANGELOG_REPLY = 1_500;

/**
 * Ephemeral reply with the running kiwibot version.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @returns {Promise<void>}
 */
export async function versionResponse(interaction: ChatInputCommandInteraction): Promise<void> {
	const parts = [`**KiwiBot v.${VERSION}**`];
	if (VERSION_CHANGELOG !== undefined) {
		parts.push('', VERSION_CHANGELOG.slice(0, MAX_CHANGELOG_REPLY));
	}
	// Angle brackets keep Discord from unfurling the link into an embed.
	if (REPO_URL !== undefined) {
		parts.push('', `Full changelog: <${REPO_URL}/blob/main/CHANGELOG.md>`);
	}
	await interaction.reply({
		content: parts.join('\n'),
		flags: MessageFlags.Ephemeral
	});
}

/**
 * Ephemeral reply listing every command with its description, built from
 * COMMANDS so it cannot go stale.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @returns {Promise<void>}
 */
export async function baseResponse(interaction: ChatInputCommandInteraction): Promise<void> {
	const lines = COMMANDS.map((command) => `\`/${command.name}\` — ${command.description}`);

	await interaction.reply({
		content: `**kiwibot** is up.\n\n${lines.join('\n')}`,
		flags: MessageFlags.Ephemeral
	});
}

/**
 * Reloads servers.json and replies with the loaded server keys, or with the
 * validation error when the file is malformed (the previous config stays).
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @returns {Promise<void>}
 */
export async function reloadResponse(interaction: ChatInputCommandInteraction): Promise<void> {
	try {
		const servers = reloadServers();
		await interaction.reply({
			content: `Config reloaded — ${servers.size} server(s): ${[...servers.keys()].join(', ')}`,
			flags: MessageFlags.Ephemeral
		});
	} catch (err) {
		await interaction.reply({
			content: `Reload failed, keeping previous config: ${(err as Error).message}`,
			flags: MessageFlags.Ephemeral
		});
	}
}

/**
 * Lists the live state of every server the member may control. Defers first:
 * each server costs two subprocess spawns.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @returns {Promise<void>}
 */
export async function listServersResponse(interaction: ChatInputCommandInteraction): Promise<void> {
	const visible = [...SERVERS.values()].filter((srv) => hasServerRole(interaction, srv));
	if (visible.length === 0) {
		await interaction.reply({
			content: 'No servers available!',
			flags: MessageFlags.Ephemeral
		});
		return;
	}
	await interaction.deferReply();
	const lines = await Promise.all(
		visible.map(async (srv) => {
			const state = await getState(srv);
			const line = describe(srv, state);
			if (state !== 'running') return line;
			// connectedPlayers is undefined when no RCON.
			const players = await connectedPlayers(srv);
			return players === undefined ? line : `${line} · ${players.length} online`;
		})
	);
	await interaction.editReply(lines.join('\n'));
}
