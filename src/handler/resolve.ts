import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';

import { ServerConfig, SERVERS } from '../core/cfg.ts';
import { Command, CommandType, getCommandFromName } from '../discord/commands.ts';
import { hasAdminRole, hasDefaultRole, hasServerRole } from '../discord/roles.ts';
import { getState } from '../server/state.ts';
import { baseResponse, listServersResponse, reloadResponse, versionResponse } from './base.ts';
import {
	addressResponse,
	adminInfoResponse,
	passwordResponse,
	playersResponse,
	searchResponse,
	statusResponse
} from './info.ts';
import { startServer } from './start.ts';
import { cancelStopResponse, stopServer } from './stop.ts';

/**
 * Base resolver for all commands.
 * Depending on the command type call the specific resolver function.
 * First check for the base role.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @returns {Promise<void>}
 */
export async function resolveCommand(interaction: ChatInputCommandInteraction): Promise<void> {
	// Base role check.
	if (!hasDefaultRole(interaction)) {
		await interaction.reply({
			content: "You don't have access to KiwiBot!",
			flags: MessageFlags.Ephemeral
		});
		return;
	}

	switch (getCommandFromName(interaction).type) {
		case CommandType.UNKNOWN: {
			await unknownCommandResponse(interaction);

			break;
		}
		case CommandType.BASE: {
			await resolveBaseCommand(interaction);

			break;
		}
		case CommandType.SERVER: {
			await resolveServerCommand(interaction);

			break;
		}
		case CommandType.ADMIN: {
			await resolveAdminCommand(interaction);

			break;
		}
		default: {
			await commandNotSupportedResponse(interaction);
			break;
		}
	}

	return;
}

/**
 * Resolver for base-type commands.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @returns {Promise<void>}
 */
export async function resolveBaseCommand(interaction: ChatInputCommandInteraction): Promise<void> {
	switch (interaction.commandName) {
		case Command.BASE: {
			await baseResponse(interaction);

			break;
		}
		case Command.BOT_VERSION: {
			await versionResponse(interaction);

			break;
		}
		case Command.CFG_RELOAD: {
			await reloadResponse(interaction);

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

/**
 * Resolver for server-type commands: resolves the server option, checks the
 * server role, then dispatches.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @returns {Promise<void>}
 */
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
		case Command.SERVER_ADDRESS: {
			await addressResponse(interaction, srv);

			break;
		}
		case Command.SERVER_PLAYERS: {
			await playersResponse(interaction, srv);

			break;
		}
		case Command.SERVER_PW: {
			await passwordResponse(interaction, srv);

			break;
		}
		case Command.SERVER_SEARCH_INFO: {
			await searchResponse(interaction, srv);

			break;
		}
		case Command.SERVER_STATUS: {
			// Defer before touching systemctl/ss: Discord gives us 3 seconds to ack,
			// and subprocess spawns on a loaded machine can blow that window.
			await interaction.deferReply();
			await interaction.editReply(statusResponse(srv, await getState(srv)));

			break;
		}
		case Command.SERVER_START: {
			await startServer(interaction, srv);

			break;
		}
		case Command.SERVER_STOP: {
			await stopServer(interaction, srv, false);

			break;
		}
		case Command.SERVER_STOP_CANCEL: {
			await cancelStopResponse(interaction, srv);

			break;
		}
		default: {
			await existingButUnusedCommandResponse(interaction);

			break;
		}
	}
}

/**
 * Resolver for admin-type commands: resolves the server option, requires the
 * server to define admin mode and the member to hold the admin role.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @returns {Promise<void>}
 */
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
		case Command.SERVER_STOP_FORCE: {
			await stopServer(interaction, srv, true);

			break;
		}
		default: {
			await existingButUnusedCommandResponse(interaction);

			break;
		}
	}
}

/**
 * Ephemeral reply for a command that is not in the registry.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @returns {Promise<void>}
 */
export async function unknownCommandResponse(
	interaction: ChatInputCommandInteraction
): Promise<void> {
	await interaction.reply({
		content: `Invalid command! Use /${Command.BASE} to have a list of commands.`,
		flags: MessageFlags.Ephemeral
	});

	return;
}

/**
 * Ephemeral fallback for a registered command with no handler yet.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @returns {Promise<void>}
 */
async function existingButUnusedCommandResponse(
	interaction: ChatInputCommandInteraction
): Promise<void> {
	await interaction.reply({
		content: 'This command has not been implemented yet!',
		flags: MessageFlags.Ephemeral
	});

	return;
}

/**
 * Ephemeral fallback for a command type the dispatcher does not handle.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @returns {Promise<void>}
 */
export async function commandNotSupportedResponse(
	interaction: ChatInputCommandInteraction
): Promise<void> {
	await interaction.reply({
		content: 'This command type is not currently supported!',
		flags: MessageFlags.Ephemeral
	});

	return;
}

/**
 * Resolves the 'server' option against the config. noUncheckedIndexedAccess
 * in tsconfig makes the resulting undefined-check mandatory at every caller.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @returns {ServerConfig | undefined} The configured server, if the option names one.
 */
function getServerFromOptions(interaction: ChatInputCommandInteraction): ServerConfig | undefined {
	const key = interaction.options.getString('server');
	return key === null ? undefined : SERVERS.get(key);
}
