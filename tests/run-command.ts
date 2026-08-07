/**
 * Runs one bot command locally against a fake interaction and prints the replies.
 * No Discord connection is involved. Note that /status and /list execute the real
 * systemctl/ss checks on this machine, and /start·/stop attempt sudo systemctl —
 * off the VPS those fail, which is itself useful to see.
 *
 * Usage: npm run testCommand -- <command> [server] [--no-roles]
 *   npm run testCommand -- bot
 *   npm run testCommand -- status palworld
 *   npm run testCommand -- password palworld --no-roles
 *
 * Roles: by default the fake member holds the base role plus the chosen server's
 * roleId/adminRoleId, so commands succeed. --no-roles drops them all to watch the
 * refusal paths. (The base-role gate itself lives in main.ts, not the handlers.)
 */
import { MessageFlags } from 'discord.js';

import { SERVERS } from '../dist/core/cfg.js';
import { CommandType, getCommandFromName } from '../dist/discord/commands.js';
import {
	commandNotSupportedResponse,
	resolveAdminCommand,
	resolveBasecommand,
	resolveServerCommand,
	unknownCommandResponse
} from '../dist/handler/resolve.js';
import { contentOf, fakeInteraction } from './fakes.js';

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const positional = args.filter((arg) => !arg.startsWith('--'));
const commandName = positional[0];
const serverKey = positional[1];

if (commandName === undefined) {
	console.error('Usage: npm run testCommand -- <command> [server] [--no-roles]');
	console.error(`Configured servers: ${[...SERVERS.keys()].join(', ')}`);
	process.exit(1);
}

const srv = serverKey === undefined ? undefined : SERVERS.get(serverKey);
const roles: string[] = [];
if (!flags.has('--no-roles')) {
	const base = process.env['DEFAULT_ROLE_ID'];
	if (base !== undefined) roles.push(base);
	if (srv?.roleId !== undefined) roles.push(srv.roleId);
	if (srv?.adminRoleId !== undefined) roles.push(srv.adminRoleId);
}

const { interaction, replies } = fakeInteraction(commandName, {
	...(serverKey === undefined ? {} : { server: serverKey }),
	roles
});

console.log(
	`> /${commandName}${serverKey === undefined ? '' : ` server:${serverKey}`} ` +
		`(roles: ${roles.length === 0 ? 'none' : roles.join(', ')})`
);

// Same dispatch as main.ts, minus the base-role gate.
try {
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
} catch (err) {
	console.error('Command threw:', (err as Error).message);
}

for (const [index, reply] of replies.entries()) {
	const ephemeral =
		typeof reply === 'object' &&
		reply !== null &&
		'flags' in reply &&
		(reply as { flags?: number }).flags === MessageFlags.Ephemeral;
	console.log(`[reply ${index + 1}]${ephemeral ? ' (ephemeral)' : ''} ${contentOf(reply)}`);
}
if (replies.length === 0) console.log('(no replies recorded)');
