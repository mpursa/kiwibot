import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';

import { ServerConfig, SERVERS, VERSION } from '../core/cfg.js';
import { Command, COMMANDS } from '../discord/commands.js';
import { describe, getState, startUnit, stopUnit, waitFor } from '../server/state.js';
import { hasAdminRole, hasServerRole } from '../discord/roles.js';

export async function resolveBasecommand(interaction: ChatInputCommandInteraction): Promise<void> {
	switch (interaction.commandName) {
		case Command.BASE: {
			await baseResponse(interaction);

			break;
		}
		case Command.BOT_VERSION: {
			await versionResponse(interaction);

			break;
		}
		case Command.LIST: {
			await listServersResponse(interaction);

			break;
		}
		default: {
			await existingButUnusedCommandResponse(interaction);

			break;
		}
	}
}

export async function resolveServerCommand(
	interaction: ChatInputCommandInteraction
): Promise<void> {
	// Check server exists.
	const srv = getServerFromOptions(interaction);
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
		case Command.SERVER_PW: {
			await passwordResponse(interaction, srv);

			break;
		}
		case Command.SERVER_STATUS: {
			// Defer before touching systemctl/ss: Discord gives us 3 seconds to ack,
			// and subprocess spawns on a loaded machine can blow that window.
			await interaction.deferReply();
			await interaction.editReply(describe(srv, await getState(srv)));

			break;
		}
		case Command.SERVER_START: {
			await startServer(interaction, srv);

			break;
		}
		case Command.SERVER_STOP: {
			await stopServer(interaction, srv);

			break;
		}
		default: {
			await existingButUnusedCommandResponse(interaction);

			break;
		}
	}
}

export async function resolveAdminCommand(interaction: ChatInputCommandInteraction): Promise<void> {
	// Check server exists.
	const srv = getServerFromOptions(interaction);
	if (srv === undefined) {
		await interaction.reply({
			content: 'Unknown server!',
			flags: MessageFlags.Ephemeral
		});
		return;
	}
	// Admin mode is defined in the server config check.
	if (srv.adminRoleId === undefined) {
		await interaction.reply({
			content: `Server ${srv.label} has no Admin mode set!`,
			flags: MessageFlags.Ephemeral
		});
		return;
	}
	// Admin role check.
	if (!hasAdminRole(interaction, srv)) {
		await interaction.reply({
			content: `You don't have admin access to ${srv.label} server!`,
			flags: MessageFlags.Ephemeral
		});
		return;
	}
	switch (interaction.commandName) {
		case Command.SERVER_ADMIN: {
			await adminInfoResponse(interaction, srv);

			break;
		}
		default: {
			await existingButUnusedCommandResponse(interaction);

			break;
		}
	}
}

export async function unknownCommandResponse(
	interaction: ChatInputCommandInteraction
): Promise<void> {
	await interaction.reply({
		content: `Invalid command! Use /${Command.BASE} to have a list of commands.`,
		flags: MessageFlags.Ephemeral
	});

	return;
}

async function listServersResponse(interaction: ChatInputCommandInteraction): Promise<void> {
	const visible = [...SERVERS.values()].filter((srv) => hasServerRole(interaction, srv));
	if (visible.length === 0) {
		await interaction.reply({
			content: 'No servers available!',
			flags: MessageFlags.Ephemeral
		});
		return;
	}
	await interaction.deferReply();
	const lines = await Promise.all(visible.map(async (srv) => describe(srv, await getState(srv))));
	await interaction.editReply(lines.join('\n'));
}

async function existingButUnusedCommandResponse(
	interaction: ChatInputCommandInteraction
): Promise<void> {
	await interaction.reply({
		content: 'This command has not been implemented yet!',
		flags: MessageFlags.Ephemeral
	});

	return;
}

async function adminInfoResponse(
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

export async function commandNotSupportedResponse(
	interaction: ChatInputCommandInteraction
): Promise<void> {
	await interaction.reply({
		content: 'This command type is not currently supported!',
		flags: MessageFlags.Ephemeral
	});

	return;
}

async function versionResponse(interaction: ChatInputCommandInteraction): Promise<void> {
	await interaction.reply({
		content: `ServerBot v.${VERSION}`,
		flags: MessageFlags.Ephemeral
	});
}

async function baseResponse(interaction: ChatInputCommandInteraction): Promise<void> {
	const lines = COMMANDS.map((command) => `\`/${command.name}\` — ${command.description}`);

	await interaction.reply({
		content: `**serverbot** is up.\n\n${lines.join('\n')}`,
		flags: MessageFlags.Ephemeral
	});
}

async function passwordResponse(
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

async function startServer(
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
			? `🟢 **${srv.label}** ready · \`${srv.address}\``
			: `🟡 **${srv.label}** is taking longer than usual — try \`/status\`.`
	);

	return;
}

async function stopServer(
	interaction: ChatInputCommandInteraction,
	srv: ServerConfig
): Promise<void> {
	await interaction.deferReply();
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

function getServerFromOptions(interaction: ChatInputCommandInteraction): ServerConfig | undefined {
	const key = interaction.options.getString('server');
	// Resolve from config. noUncheckedIndexedAccess in tsconfig makes this check mandatory.
	return key === null ? undefined : SERVERS.get(key);
}
