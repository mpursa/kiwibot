import { Client, GatewayIntentBits, MessageFlags, REST, Routes } from 'discord.js';

import { SERVERS, requireEnv } from './core/cfg.js';
import { resolveBasecommand, resolveServerCommand } from './handler/resolve.js';
import { CommandBase, CommandServer, commands } from './discord/commands.js';
import { hasDefaultRole, hasServerRole } from './discord/roles.js';
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
		.put(Routes.applicationGuildCommands(APP_ID, GUILD_ID), { body: commands });
	console.log(
		`serverbot ready as ${c.user.tag} — ${SERVERS.size} server(s): ${[...SERVERS.keys()].join(', ')}`
	);
});

client.on('interactionCreate', async (interaction) => {
	if (!interaction.isChatInputCommand()) return;

	const key = interaction.options.getString('server');

	try {
		// Base role check.
		if (!hasDefaultRole(interaction)) {
			await interaction.reply({
				content: "You don't have access to serverbot!",
				flags: MessageFlags.Ephemeral
			});
			return;
		}

		if ((<any>Object).values(CommandBase).includes(interaction.commandName)) {
			// Resolve command.
			await resolveBasecommand(interaction);
		} else if ((<any>Object).values(CommandServer).includes(interaction.commandName)) {
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
			// Resolve command.
			await resolveServerCommand(interaction, srv);
		} else {
			await interaction.reply({
				content: `Invalid command! Use /${CommandBase.BASE} to have a list of commands.`,
				flags: MessageFlags.Ephemeral
			});
		}

		return;
	} catch (err) {
		console.error(err);
		const msg = `Command failed: \`${String((err as Error).message).slice(0, 200)}\``;
		// The report itself can fail (e.g. the interaction token expired). Swallow
		// that: an unhandled rejection here would take down the whole process.
		try {
			if (interaction.deferred) await interaction.editReply(msg);
			else if (!interaction.replied) await interaction.reply(msg);
		} catch (replyErr) {
			console.error('Could not report failure to Discord:', replyErr);
		}
	}
});

await client.login(TOKEN);
