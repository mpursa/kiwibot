import type { Client } from 'discord.js';

import { optionalEnv } from '../core/cfg.ts';

export const ALERT_CHANNEL_ID = optionalEnv('ALERT_CHANNEL_ID');

/**
 * Posts a message to the alert channel, if one is configured.
 *
 * @param {Client} client - Logged-in Discord client.
 * @param {string | undefined} channelId - ALERT_CHANNEL_ID, or undefined to skip.
 * @param {string} message - Message to post.
 * @returns {Promise<void>}
 */
export async function sendAlert(client: Client, message: string): Promise<void> {
	if (ALERT_CHANNEL_ID === undefined) return;
	try {
		const channel = await client.channels.fetch(ALERT_CHANNEL_ID);
		if (channel === null || !channel.isTextBased() || !('send' in channel)) {
			console.warn(`ALERT_CHANNEL_ID ${ALERT_CHANNEL_ID} is not a channel this bot can post in`);
			return;
		}
		await channel.send(message);
	} catch (err) {
		console.error('Could not send alert:', (err as Error).message);
	}
}
