import { setTimeout as sleep } from 'node:timers/promises';

import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';

import { ServerConfig } from '../core/cfg.ts';
import { announce } from '../discord/messaging.ts';
import { Command } from '../discord/commands.ts';
import { connectedPlayers } from '../server/players.ts';
import { describe, getState, stopUnit, waitFor } from '../server/state.ts';

// Names shown before a stop refusal switches to a count.
const MAX_LISTED_PLAYERS = 10;

const MS_PER_MINUTE = 60_000;
// Scheduled stops by unit; aborting the controller cancels the pending sleep.
const pendingStops = new Map<string, AbortController>();

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
 * @param {AbortSignal} signal - Aborting it cancels the schedule.
 * @returns {Promise<void>}
 */
async function delayedStop(
	interaction: ChatInputCommandInteraction,
	srv: ServerConfig,
	force: boolean,
	minutes: number,
	signal: AbortSignal
): Promise<void> {
	try {
		if (minutes > 1) {
			await sleep((minutes - 1) * MS_PER_MINUTE, undefined, { signal });
		}
		await announce(interaction, `⚠️ **${srv.label}** will stop in 1 minute!`);
		await sleep(MS_PER_MINUTE, undefined, { signal });
		const blocker = await stopBlocker(srv, force, true);
		await announce(interaction, blocker ?? (await stopAndReport(srv, interaction.user.username)));
	} catch (err) {
		// A cancelled schedule is not a failure; the canceller already announced it.
		if (signal.aborted) return;
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
 * Cancels a server's scheduled stop, if one is pending. The confirmation is
 * public, like the schedule it undoes, so the channel keeps its audit trail.
 *
 * @param {ChatInputCommandInteraction} interaction - Discord chat command.
 * @param {ServerConfig} srv - Target server.
 * @returns {Promise<void>}
 */
export async function cancelStopResponse(
	interaction: ChatInputCommandInteraction,
	srv: ServerConfig
): Promise<void> {
	const pending = pendingStops.get(srv.unit);
	if (pending === undefined) {
		await interaction.reply({
			content: `No stop is scheduled for ${srv.label}!`,
			flags: MessageFlags.Ephemeral
		});
		return;
	}
	// Release the slot before aborting, so a new schedule can claim it.
	pendingStops.delete(srv.unit);
	pending.abort();
	await interaction.reply(
		`✅ Scheduled stop of **${srv.label}** cancelled by ${interaction.user.username}.`
	);
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
export async function stopServer(
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
		const controller = new AbortController();
		pendingStops.set(srv.unit, controller);
		// Whoever did not ask for a delay should hear where it came from.
		const source =
			requested === null
				? ` — this server has a configured stop delay; use \`delay:0\` to stop now`
				: '';
		await interaction.editReply(
			`⏱️ **${srv.label}** will stop in ${minutes} minute${minutes === 1 ? '' : 's'} ` +
				`(queued by ${interaction.user.username})${source}.`
		);
		void delayedStop(interaction, srv, force, minutes, controller.signal);

		return;
	}
	await interaction.editReply(await stopAndReport(srv, interaction.user.username));

	return;
}
