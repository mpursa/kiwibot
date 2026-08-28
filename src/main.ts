import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';

import { SERVERS, VERSION, requireEnv } from './core/cfg.ts';
import { resolveCommand } from './handler/resolve.ts';
import { sendAlert } from './discord/messaging.ts';
import { discordCommands } from './discord/commands.ts';
import { startAutoStop } from './server/autostop.ts';
import { sudoAllows } from './server/state.ts';

const TOKEN = requireEnv('DISCORD_TOKEN');
const APP_ID = requireEnv('APP_ID');
const GUILD_ID = requireEnv('GUILD_ID');

// ENTRY POINT
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async (c) => {
	// Fail loudly (in the journal) if servers.json and the sudoers file disagree.
	for (const srv of SERVERS.values()) {
		for (const verb of ['start', 'stop'] as const) {
			if (!(await sudoAllows(verb, srv.unit))) {
				console.warn(
					`WARNING: sudoers does not allow 'systemctl ${verb} ${srv.unit}' — /${verb} will fail for ${srv.label}`
				);
			}
		}
	}
	await new REST()
		.setToken(TOKEN)
		.put(Routes.applicationGuildCommands(APP_ID, GUILD_ID), { body: discordCommands });
	console.log(
		`kiwibot ready as ${c.user.tag} — ${SERVERS.size} server(s): ${[...SERVERS.keys()].join(', ')}`
	);
	startAutoStop(c);
	await sendAlert(c, `**KiwiBot** v.${VERSION} is online.`);
});

/**
 * On chat command received.
 */
client.on('interactionCreate', async (interaction) => {
	if (!interaction.isChatInputCommand()) return;

	try {
		await resolveCommand(interaction);
	} catch (err) {
		console.error(err);
		const msg = `Command failed: \`${String((err as Error).message).slice(0, 200)}\``;
		// The report itself can fail (e.g. the interaction token expired).
		try {
			if (interaction.deferred) await interaction.editReply(msg);
			else if (!interaction.replied) await interaction.reply(msg);
		} catch (replyErr) {
			console.error('Could not report failure to Discord:', replyErr);
		}
	}

	return;
});

await client.login(TOKEN);
