import { ChatInputCommandInteraction } from 'discord.js';

import { ServerConfig } from '../core/cfg.ts';
import { describe, getState, startUnit, waitFor } from '../server/state.ts';

/**
 * Starts the unit and edits the reply as it progresses. Defers first: it
 * spawns subprocesses and can wait up to startupMs for the socket to open.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @param {ServerConfig} srv - Target server.
 * @returns {Promise<void>}
 */
export async function startServer(
	interaction: ChatInputCommandInteraction,
	srv: ServerConfig
): Promise<void> {
	await interaction.deferReply();
	const state = await getState(srv);
	if (state !== 'stopped' && state !== 'failed') {
		await interaction.editReply(describe(srv, state));

		return;
	}
	await startUnit(srv.unit);
	await interaction.editReply(`🟡 Starting **${srv.label}**…`);
	const up = await waitFor(srv, 'running');
	await interaction.editReply(
		up
			? `🟢 **${srv.label}** ready · \`${srv.address}:${srv.port}\``
			: `🟡 **${srv.label}** is taking longer than usual — try \`/status\`.`
	);

	return;
}
