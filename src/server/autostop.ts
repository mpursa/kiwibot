import type { Client } from 'discord.js';

import { SERVERS, type ServerConfig } from '../core/cfg.ts';
import { sendAlert } from '../discord/alerts.ts';
import { connectedPlayers } from './players.ts';
import { getState, stopUnit, waitFor, type ServerState } from './state.ts';

/**
 * What the caller should do after one observation:
 * - 'idle'    not counting down; nothing to do
 * - 'waiting' counting down; the server is confirmed empty but not yet due
 * - 'stop'    the configured idle time has elapsed; stop the server
 */
export type AutoStopDecision = 'idle' | 'waiting' | 'stop';

const MS_PER_MINUTE = 60_000;

/**
 * Decides when an empty server has been empty long enough to stop itself.
 *
 * Only a confirmed empty observation advances a countdown.
 * A server that is not running, that has players, or whose player list is unknown resets it.
 */
export class AutoStopTracker {
	/** Server key to the timestamp it was first seen empty. */
	private readonly emptySince = new Map<string, number>();

	/**
	 * Records one observation of a server and says what to do about it.
	 *
	 * @param {string} key - Server key from the config.
	 * @param {number} minutes - Configured idle minutes before stopping.
	 * @param {ServerState} state - Current state of the unit.
	 * @param {string[] | undefined} players - Connected players, undefined when unknown.
	 * @param {number} now - Current time in epoch milliseconds.
	 * @returns {AutoStopDecision} What the caller should do.
	 */
	observe(
		key: string,
		minutes: number,
		state: ServerState,
		players: string[] | undefined,
		now: number
	): AutoStopDecision {
		// Anything short of "running and confirmed empty" resets the countdown.
		if (state !== 'running' || players === undefined || players.length > 0) {
			this.emptySince.delete(key);
			return 'idle';
		}

		const since = this.emptySince.get(key);
		if (since === undefined) {
			this.emptySince.set(key, now);
			return 'waiting';
		}
		if (now - since < minutes * MS_PER_MINUTE) return 'waiting';

		// Clear before stopping: if the stop fails, the server waits out another
		// full idle period instead of retrying every tick.
		this.emptySince.delete(key);
		return 'stop';
	}

	/**
	 * Drops any countdown for a server, so the next observation starts over.
	 * Used when something outside the tracker changes the server's state.
	 *
	 * @param {string} key - Server key from the config.
	 * @returns {void}
	 */
	forget(key: string): void {
		this.emptySince.delete(key);
	}
}

/** How often every auto-stop server is observed. */
const DEFAULT_POLL_MS = 60_000;

/**
 * Starts watching every server that configures autoStopMinutes, stopping each
 * one once it has been confirmed empty for its configured time and announcing
 * it in the alert channel.
 *
 * Does nothing when no server opts in, so the timer only exists where the
 * feature is actually used.
 *
 * @param {Client} client - Logged-in Discord client, for the alert.
 * @param {number} pollMs - Observation interval; the default suits idle times in minutes.
 * @returns {() => void} Stops the poller; useful for shutdown and tests.
 */
export function startAutoStop(client: Client, pollMs: number = DEFAULT_POLL_MS): () => void {
	const watched = [...SERVERS].filter(([, srv]) => srv.autoStopMinutes !== undefined);
	if (watched.length === 0) return () => {};

	const tracker = new AutoStopTracker();
	// Servers whose stop is still running, so a slow shutdown is not re-entered.
	const stopping = new Set<string>();
	let ticking = false;

	/**
	 * Stops one server and reports it, releasing the guard either way.
	 *
	 * @param {string} key - Server key from the config.
	 * @param {ServerConfig} srv - Server to stop.
	 * @param {number} minutes - Idle minutes that triggered the stop.
	 * @returns {Promise<void>}
	 */
	async function stopIdleServer(key: string, srv: ServerConfig, minutes: number): Promise<void> {
		stopping.add(key);
		try {
			console.log(`auto-stop: ${srv.label} idle for ${minutes} minutes, stopping`);
			await stopUnit(srv.unit);
			// Without this a hung shutdown would be announced as a completed stop.
			const down = await waitFor(srv, 'stopped');
			if (!down) {
				console.warn(`auto-stop: ${srv.label} did not reach stopped within its deadline`);
			}
			await sendAlert(
				client,
				down
					? `🔴 **${srv.label}** stopped automatically — no players for ${minutes} minutes.`
					: `⚠️ Tried to auto-stop **${srv.label}** — it is still shutting down.`
			);
		} catch (err) {
			console.error(`auto-stop: could not stop ${srv.label}:`, (err as Error).message);
		} finally {
			stopping.delete(key);
		}
	}

	/**
	 * Observes every watched server once. Stops run detached: a shutdown can
	 * take minutes, and the other servers should still be observed meanwhile.
	 *
	 * @returns {Promise<void>}
	 */
	async function tick(): Promise<void> {
		if (ticking) return;
		ticking = true;
		try {
			for (const [key, srv] of watched) {
				const minutes = srv.autoStopMinutes;
				if (minutes === undefined || stopping.has(key)) continue;
				try {
					const state = await getState(srv);
					// Only ask the game who is on when it is actually up.
					const players = state === 'running' ? await connectedPlayers(srv) : undefined;
					if (tracker.observe(key, minutes, state, players, Date.now()) === 'stop') {
						void stopIdleServer(key, srv, minutes);
					}
				} catch (err) {
					console.error(`auto-stop: check failed for ${srv.label}:`, (err as Error).message);
				}
			}
		} finally {
			ticking = false;
		}
	}

	const timer = setInterval(() => void tick(), pollMs);
	console.log(
		`auto-stop watching ${watched.length} server(s): ${watched
			.map(([, srv]) => `${srv.label} (${srv.autoStopMinutes}m)`)
			.join(', ')}`
	);

	return () => clearInterval(timer);
}
