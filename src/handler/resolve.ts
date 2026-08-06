import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';

import { ServerConfig, SERVERS } from '../core/cfg.js';
import { Command } from '../discord/commands.js';
import { describe, getState, startUnit, stopUnit, waitFor } from '../server/state.js';
import { hasServerRole } from '../discord/roles.js';

export async function resolveBasecommand(interaction: ChatInputCommandInteraction): Promise<void> {
	switch (interaction.commandName) {
		case Command.BASE: {
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
	interaction: ChatInputCommandInteraction
): Promise<void> {
	const key = interaction.options.getString('server');
	// Resolve from config. noUncheckedIndexedAccess in tsconfig makes this check mandatory.
	const srv = key === null ? undefined : SERVERS.get(key);
	// Check server exists.
	if (srv === undefined) {
		await interaction.reply({
			content: 'Unknown server!',
			flags: MessageFlags.Ephemeral
		});
		return;
	}
	// Server role check.
	if (!hasServerRole(interaction, srv)) {
		await interaction.reply({
			content: `You don't have access to ${srv.label}!`,
			flags: MessageFlags.Ephemeral
		});
		return;
	}
	switch (interaction.commandName) {
		case Command.SERVER_STATUS: {
			// Defer before touching systemctl/ss: Discord gives us 3 seconds to ack,
			// and subprocess spawns on a loaded machine can blow that window.
			await interaction.deferReply();
			await interaction.editReply(describe(srv, await getState(srv)));

			break;
		}
		case Command.SERVER_START: {
			await interaction.deferReply();
			await startServer(interaction, srv);

			break;
		}
		case Command.SERVER_STOP: {
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

export async function unknownCommand(interaction: ChatInputCommandInteraction): Promise<void> {
	await interaction.reply({
		content: `Invalid command! Use /${Command.BASE} to have a list of commands.`,
		flags: MessageFlags.Ephemeral
	});

	return;
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
