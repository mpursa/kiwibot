import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';

import { ServerConfig } from '../core/cfg.js';
import { CommandBase, CommandServer } from '../discord/commands.js';
import { describe, getState, startUnit, stopUnit, waitFor } from '../server/state.js';

export async function resolveBasecommand(interaction: ChatInputCommandInteraction): Promise<void> {
	switch (interaction.commandName) {
		case CommandBase.BASE: {
			await baseResponse(interaction);

			break;
		}
		default: {
			await existingButUnusedCommand(interaction);

			break;
		}
	}
}

export async function resolveServerCommand(
	interaction: ChatInputCommandInteraction,
	srv: ServerConfig
): Promise<void> {
	switch (interaction.commandName) {
		case CommandServer.STATUS: {
			// Defer before touching systemctl/ss: Discord gives us 3 seconds to ack,
			// and subprocess spawns on a loaded machine can blow that window.
			await interaction.deferReply();
			await interaction.editReply(describe(srv, await getState(srv)));

			break;
		}
		case CommandServer.START: {
			await interaction.deferReply();
			await startServer(interaction, srv);

			break;
		}
		case CommandServer.STOP: {
			await interaction.deferReply();
			await stopServer(interaction, srv);

			break;
		}
		default: {
			await existingButUnusedCommand(interaction);

			break;
		}
	}
}

async function existingButUnusedCommand(interaction: ChatInputCommandInteraction): Promise<void> {
	await interaction.reply({
		content: 'This command has not been implemented yet!',
		flags: MessageFlags.Ephemeral
	});

	return;
}

async function baseResponse(interaction: ChatInputCommandInteraction): Promise<void> {
	await interaction.reply(
		`SERVERBOT is up and ready! Type /commands to see a list of available commands, type /list to see a list of the available game servers`
	);

	return;
}

async function startServer(
	interaction: ChatInputCommandInteraction,
	srv: ServerConfig
): Promise<void> {
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
			? `🟢 **${srv.label}** ready · \`${srv.address}\``
			: `🟡 **${srv.label}** is taking longer than usual — try \`/status\`.`
	);

	return;
}

async function stopServer(
	interaction: ChatInputCommandInteraction,
	srv: ServerConfig
): Promise<void> {
	if ((await getState(srv)) === 'stopped') {
		await interaction.editReply(describe(srv, 'stopped'));

		return;
	}
	await stopUnit(srv.unit);
	const down = await waitFor(srv, 'stopped');
	await interaction.editReply(
		down
			? `🔴 **${srv.label}** stopped by ${interaction.user.username}`
			: `🟡 **${srv.label}** is still shutting down — check \`/status\`.`
	);

	return;
}
