/**
 * Runs one bot command locally against a fake interaction and prints the replies.
 * No Discord connection is involved. Note that /status and /list execute the real
 * systemctl/ss checks on this machine, and /start·/stop attempt sudo systemctl —
 * off the VPS those fail, which is itself useful to see.
 *
 * Usage: bun run testCommand <command> [server] [delay-minutes] [--no-roles]
 *   bun run testCommand bot
 *   bun run testCommand status palworld
 *   bun run testCommand stop palworld 2
 *   bun run testCommand password palworld --no-roles
 *
 * Roles: by default the fake member holds the base role (DEFAULT_ROLE_ID, supplied
 * by --env-file=.env.test via the package script) plus the chosen server's
 * roleId/adminRoleId, so commands succeed. --no-roles drops them all to watch the
 * refusal paths — resolveCommand includes the base-role gate, so what you'll see
 * first is the outermost "You don't have access" refusal.
 */
import { MessageFlags } from 'discord.js';

import { SERVERS } from '../src/core/cfg.ts';
import { resolveCommand } from '../src/handler/resolve.ts';
import { contentOf, fakeInteraction } from './fakes.ts';

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const positional = args.filter((arg) => !arg.startsWith('--'));
const commandName = positional[0];
const serverKey = positional[1];
const delay = positional[2] === undefined ? undefined : Number.parseInt(positional[2], 10);

if (commandName === undefined) {
	console.error('Usage: bun run testCommand <command> [server] [delay-minutes] [--no-roles]');
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
	...(delay === undefined || Number.isNaN(delay) ? {} : { delay }),
	roles
});

console.log(
	`> /${commandName}${serverKey === undefined ? '' : ` server:${serverKey}`}` +
		`${delay === undefined || Number.isNaN(delay) ? '' : ` delay:${delay}`} ` +
		`(roles: ${roles.length === 0 ? 'none' : roles.join(', ')})`
);

try {
	await resolveCommand(interaction);
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
