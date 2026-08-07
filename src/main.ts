import { Client, GatewayIntentBits, MessageFlags, REST, Routes } from 'discord.js';

import { SERVERS, requireEnv } from './core/cfg.js';
import {
	commandNotSupportedResponse,
	resolveAdminCommand,
	resolveBasecommand,
	resolveServerCommand,
	unknownCommandResponse
} from './handler/resolve.js';
import { CommandType, discordCommands, getCommandFromName } from './discord/commands.js';
import { hasDefaultRole } from './discord/roles.js';
import { sudoAllows } from './server/state.js';

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
		`serverbot ready as ${c.user.tag} — ${SERVERS.size} server(s): ${[...SERVERS.keys()].join(', ')}`
	);
});

client.on('interactionCreate', async (interaction) => {
	if (!interaction.isChatInputCommand()) return;

	try {
		// Base role check.
		if (!hasDefaultRole(interaction)) {
			await interaction.reply({
				content: "You don't have access to serverbot!",
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
				await resolveBasecommand(interaction);

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
});

await client.login(TOKEN);
