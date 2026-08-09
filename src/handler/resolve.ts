import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';

import { ServerConfig, SERVERS, VERSION } from '../core/cfg.js';
import { Command, COMMANDS, CommandType, getCommandFromName } from '../discord/commands.js';
import { rconExec } from '../server/rcon.js';
import { describe, getState, startUnit, stopUnit, waitFor } from '../server/state.js';
import { hasAdminRole, hasDefaultRole, hasServerRole } from '../discord/roles.js';

// Discord max msg is 2k char. Leave room for code fences.
const MAX_RCON_REPLY = 1_800;

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
			content: "You don't have access to ServerBot!",
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
 * Lists the live state of every server the member may control. Defers first:
 * each server costs two subprocess spawns.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @returns {Promise<void>}
 */
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
 * Ephemeral reply with the server's admin info text, when configured.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @param {ServerConfig} srv - Target server.
 * @returns {Promise<void>}
 */
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
 * Ephemeral reply with the running serverbot version.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @returns {Promise<void>}
 */
async function versionResponse(interaction: ChatInputCommandInteraction): Promise<void> {
	await interaction.reply({
		content: `ServerBot v.${VERSION}`,
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
async function baseResponse(interaction: ChatInputCommandInteraction): Promise<void> {
	const lines = COMMANDS.map((command) => `\`/${command.name}\` — ${command.description}`);

	await interaction.reply({
		content: `**serverbot** is up.\n\n${lines.join('\n')}`,
		flags: MessageFlags.Ephemeral
	});
}

/**
 * Ephemeral reply with the address (host:port) players connect to.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @param {ServerConfig} srv - Target server.
 * @returns {Promise<void>}
 */
async function addressResponse(
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
async function playersResponse(
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

/**
 * Starts the unit and edits the reply as it progresses. Defers first: it
 * spawns subprocesses and can wait up to startupMs for the socket to open.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @param {ServerConfig} srv - Target server.
 * @returns {Promise<void>}
 */
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

/**
 * Stops the unit and names who asked. Defers first, same reason as startServer.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @param {ServerConfig} srv - Target server.
 * @returns {Promise<void>}
 */
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
