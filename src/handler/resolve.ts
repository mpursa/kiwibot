import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';

import { REPO_URL, ServerConfig, SERVERS, VERSION, VERSION_CHANGELOG } from '../core/cfg.ts';
import { announce } from '../discord/messaging.ts';
import { Command, COMMANDS, CommandType, getCommandFromName } from '../discord/commands.ts';
import { connectedPlayers } from '../server/players.ts';
import { rconExec } from '../server/rcon.ts';
import { describe, getState, startUnit, stopUnit, waitFor } from '../server/state.ts';
import { hasAdminRole, hasDefaultRole, hasServerRole } from '../discord/roles.ts';

// Discord max msg is 2k char. Leave room for code fences.
const MAX_RCON_REPLY = 1_800;
// Names shown before a stop refusal switches to a count.
const MAX_LISTED_PLAYERS = 10;
// A changelog entry must leave room for the version line and link.
const MAX_CHANGELOG_REPLY = 1_500;

const MS_PER_MINUTE = 60_000;
// Servers with pending stop commands.
const pendingStops = new Set<string>();

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
			await stopServer(interaction, srv, false);

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
 * Ephemeral reply with the running kiwibot version.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @returns {Promise<void>}
 */
async function versionResponse(interaction: ChatInputCommandInteraction): Promise<void> {
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
async function baseResponse(interaction: ChatInputCommandInteraction): Promise<void> {
	const lines = COMMANDS.map((command) => `\`/${command.name}\` — ${command.description}`);

	await interaction.reply({
		content: `**kiwibot** is up.\n\n${lines.join('\n')}`,
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
			? `🟢 **${srv.label}** ready · \`${srv.address}:${srv.port}\``
			: `🟡 **${srv.label}** is taking longer than usual — try \`/status\`.`
	);

	return;
}

/**
 * Comma-separated names, capped so a busy server cannot blow the message limit.
 *
 * @param {string[]} names - Connected player names.
 * @returns {string} The first few names, with a count of the rest.
 */
function namesPreview(names: string[]): string {
	if (names.length <= MAX_LISTED_PLAYERS) return names.join(', ');
	const shown = names.slice(0, MAX_LISTED_PLAYERS).join(', ');
	return `${shown} and ${names.length - MAX_LISTED_PLAYERS} more`;
}

/**
 * Decides whether a stop can or cannot proceed (players connected).
 * An admin role can force this to skip the check.
 *
 * @param {ServerConfig} srv - Target server.
 * @param {boolean} force - Skip the connected-players check.
 * @param {boolean} scheduled - Word the refusal as a cancelled schedule.
 * @returns {Promise<string | undefined>} The message to show, or undefined when clear to stop.
 */
async function stopBlocker(
	srv: ServerConfig,
	force: boolean,
	scheduled: boolean
): Promise<string | undefined> {
	if ((await getState(srv)) === 'stopped') return describe(srv, 'stopped');
	if (force) return undefined;
	const players = await connectedPlayers(srv);
	if (players === undefined || players.length === 0) return undefined;
	const who = `${players.length} player${players.length === 1 ? '' : 's'} connected: ${namesPreview(players)}`;
	return scheduled
		? `✋ Scheduled stop of **${srv.label}** cancelled — ${who}`
		: `✋ **${srv.label}** still has ${who}\n` +
				`Ask an admin for \`/${Command.SERVER_STOP_FORCE}\` to stop it anyway.`;
}

/**
 * Stops the unit, waits for it to go down and words the outcome. Shared tail
 * of the immediate and delayed paths.
 *
 * @param {ServerConfig} srv - Target server.
 * @param {string} username - Who asked, for the audit line.
 * @returns {Promise<string>} The outcome message.
 */
async function stopAndReport(srv: ServerConfig, username: string): Promise<string> {
	await stopUnit(srv.unit);
	const down = await waitFor(srv, 'stopped');
	return down
		? `🔴 **${srv.label}** stopped by ${username}`
		: `🟡 **${srv.label}** is still shutting down — check \`/status\`.`;
}

/**
 * The tail of a delayed stop: warns the channel 1 minute before the deadline,
 * then re-runs the stop checks and stops the unit. Runs detached from the
 * interaction.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @param {ServerConfig} srv - Target server.
 * @param {boolean} force - Skip the connected-players re-check.
 * @param {number} minutes - Minutes to wait before stopping.
 * @returns {Promise<void>}
 */
async function delayedStop(
	interaction: ChatInputCommandInteraction,
	srv: ServerConfig,
	force: boolean,
	minutes: number
): Promise<void> {
	try {
		if (minutes > 1) {
			await new Promise((resolve) => setTimeout(resolve, (minutes - 1) * MS_PER_MINUTE));
		}
		await announce(interaction, `⚠️ **${srv.label}** will stop in 1 minute!`);
		await new Promise((resolve) => setTimeout(resolve, MS_PER_MINUTE));
		const blocker = await stopBlocker(srv, force, true);
		await announce(interaction, blocker ?? (await stopAndReport(srv, interaction.user.username)));
	} catch (err) {
		console.error(`Scheduled stop failed for ${srv.label}:`, (err as Error).message);
		await announce(
			interaction,
			`⚠️ Scheduled stop of **${srv.label}** failed: ${(err as Error).message}`
		);
	} finally {
		pendingStops.delete(srv.unit);
	}
}

/**
 * Stops the unit and names who asked. Defers first, same reason as startServer.
 * Unless forced, refuses while players are connected — a question only
 * answerable for servers whose rcon block declares a playersFormat; when the
 * answer is unknown the stop goes ahead as it always did.
 *
 * With the optional 'delay' option the stop is scheduled instead: the reply
 * confirms the schedule, a warning is announced 1 minute before the deadline,
 * and the checks re-run when it fires. A server's stopDelayMinutes supplies
 * the default when the option is omitted; delay:0 forces an immediate stop.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @param {ServerConfig} srv - Target server.
 * @param {boolean} force - Skip the connected-players check.
 * @returns {Promise<void>}
 */
async function stopServer(
	interaction: ChatInputCommandInteraction,
	srv: ServerConfig,
	force: boolean
): Promise<void> {
	await interaction.deferReply();
	const blocker = await stopBlocker(srv, force, false);
	if (blocker !== undefined) {
		await interaction.editReply(blocker);

		return;
	}
	// An explicit option — including delay:0 for "now" — beats the server's
	// configured default; only a missing option falls back to it.
	const requested = interaction.options.getInteger('delay');
	const minutes = requested ?? srv.stopDelayMinutes ?? 0;
	if (minutes > 0) {
		if (pendingStops.has(srv.unit)) {
			await interaction.editReply(`⏱️ **${srv.label}** already has a stop scheduled.`);

			return;
		}
		// Claimed here, not in delayedStop: a second command must see it immediately.
		pendingStops.add(srv.unit);
		// Whoever did not ask for a delay should hear where it came from.
		const source =
			requested === null
				? ` — this server has a configured stop delay; use \`delay:0\` to stop now`
				: '';
		await interaction.editReply(
			`⏱️ **${srv.label}** will stop in ${minutes} minute${minutes === 1 ? '' : 's'} ` +
				`(queued by ${interaction.user.username})${source}.`
		);
		void delayedStop(interaction, srv, force, minutes);

		return;
	}
	await interaction.editReply(await stopAndReport(srv, interaction.user.username));

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
