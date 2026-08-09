import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SERVERS, VERSION } from '../dist/core/cfg.js';
import { Command, COMMANDS, CommandType } from '../dist/discord/commands.js';
import {
	commandNotSupportedResponse,
	resolveAdminCommand,
	resolveBaseCommand,
	resolveServerCommand,
	unknownCommandResponse
} from '../dist/handler/resolve.js';
import { contentOf, fakeInteraction } from './fakes.js';

const BASE_ROLE = process.env['DEFAULT_ROLE_ID'] as string;

/**
 * The roles a member needs to pass the server (and optionally admin) checks.
 *
 * @param {{ roleId?: string; adminRoleId?: string }} srv - Target server config.
 * @param {boolean} admin - Include the admin role too.
 * @returns {string[]} Role ids for the fake member.
 */
function rolesFor(srv: { roleId?: string; adminRoleId?: string }, admin = false): string[] {
	const roles = [BASE_ROLE];
	if (srv.roleId !== undefined) roles.push(srv.roleId);
	if (admin && srv.adminRoleId !== undefined) roles.push(srv.adminRoleId);
	return roles;
}

test('/bot lists every registered command', async () => {
	const { interaction, replies } = fakeInteraction(Command.BASE);
	await resolveBaseCommand(interaction);
	const content = contentOf(replies[0]);
	for (const cmd of COMMANDS) {
		assert.ok(content.includes(`/${cmd.name}`), `missing /${cmd.name}`);
	}
});

test('/bot_version reports the package version', async () => {
	const { interaction, replies } = fakeInteraction(Command.BOT_VERSION);
	await resolveBaseCommand(interaction);
	assert.equal(contentOf(replies[0]), `ServerBot v.${VERSION}`);
});

test('/list with no roles offers no servers', async () => {
	const { interaction, replies } = fakeInteraction(Command.LIST);
	await resolveBaseCommand(interaction);
	assert.equal(contentOf(replies[0]), 'No servers available!');
});

test('an unregistered base command answers "not implemented"', async () => {
	const { interaction, replies } = fakeInteraction('something-new');
	await resolveBaseCommand(interaction);
	assert.match(contentOf(replies[0]), /not been implemented/);
});

test('server commands refuse an unknown server', async () => {
	const { interaction, replies } = fakeInteraction(Command.SERVER_STATUS, {
		server: 'no-such-server',
		roles: [BASE_ROLE]
	});
	await resolveServerCommand(interaction);
	assert.equal(contentOf(replies[0]), 'Unknown server!');
});

test('server commands refuse a member without the server role', async () => {
	const first = [...SERVERS.entries()][0];
	assert.ok(first);
	const [key, srv] = first;
	const { interaction, replies } = fakeInteraction(Command.SERVER_PW, { server: key });
	await resolveServerCommand(interaction);
	assert.equal(contentOf(replies[0]), `You don't have access to ${srv.label}!`);
});

test('/address answers with host:port for a permitted member', async () => {
	const first = [...SERVERS.entries()][0];
	assert.ok(first);
	const [key, srv] = first;
	const { interaction, replies } = fakeInteraction(Command.SERVER_ADDRESS, {
		server: key,
		roles: rolesFor(srv)
	});
	await resolveServerCommand(interaction);
	assert.ok(contentOf(replies[0]).includes(`${srv.address}:${srv.port}`));
});

test('/password answers a permitted member', async () => {
	const first = [...SERVERS.entries()][0];
	assert.ok(first);
	const [key, srv] = first;
	const { interaction, replies } = fakeInteraction(Command.SERVER_PW, {
		server: key,
		roles: rolesFor(srv)
	});
	await resolveServerCommand(interaction);
	assert.ok(contentOf(replies[0]).includes(srv.label));
});

test('/players on a server without rcon says so', async (t) => {
	const entry = [...SERVERS.entries()].find(([, srv]) => srv.rcon === undefined);
	if (entry === undefined) return t.skip('every configured server has rcon');
	const [key, srv] = entry;
	const { interaction, replies } = fakeInteraction(Command.SERVER_PLAYERS, {
		server: key,
		roles: rolesFor(srv)
	});
	await resolveServerCommand(interaction);
	assert.equal(contentOf(replies[0]), `Server ${srv.label} has no RCON set!`);
});

test('/players reports an unreachable rcon endpoint instead of throwing', async (t) => {
	const entry = [...SERVERS.entries()].find(([, srv]) => srv.rcon !== undefined);
	if (entry === undefined) return t.skip('no configured server has rcon');
	const [key, srv] = entry;
	const { interaction, replies } = fakeInteraction(Command.SERVER_PLAYERS, {
		server: key,
		roles: rolesFor(srv)
	});
	// Nothing listens on the test rcon port, so this exercises the failure path.
	await resolveServerCommand(interaction);
	assert.match(contentOf(replies[0]), /RCON/);
	assert.ok(contentOf(replies[0]).includes(srv.label));
});

test('/admin on a server without admin mode says so', async (t) => {
	const entry = [...SERVERS.entries()].find(([, srv]) => srv.adminRoleId === undefined);
	if (entry === undefined) return t.skip('every configured server has adminRoleId');
	const [key, srv] = entry;
	const { interaction, replies } = fakeInteraction(Command.SERVER_ADMIN, {
		server: key,
		roles: rolesFor(srv)
	});
	await resolveAdminCommand(interaction);
	assert.equal(contentOf(replies[0]), `Server ${srv.label} has no Admin mode set!`);
});

test('/stop-force refuses a member without the admin role', async (t) => {
	const entry = [...SERVERS.entries()].find(([, srv]) => srv.adminRoleId !== undefined);
	if (entry === undefined) return t.skip('no configured server has adminRoleId');
	const [key, srv] = entry;
	const { interaction, replies } = fakeInteraction(Command.SERVER_STOP_FORCE, {
		server: key,
		roles: rolesFor(srv)
	});
	// Refused before any systemctl call, so this never touches the machine.
	await resolveAdminCommand(interaction);
	assert.equal(contentOf(replies[0]), `You don't have admin access to ${srv.label} server!`);
});

test('/stop-force is registered as an admin command', () => {
	const cmd = COMMANDS.find((c) => c.name === Command.SERVER_STOP_FORCE);
	assert.ok(cmd);
	assert.equal(cmd.type, CommandType.ADMIN);
});

test('/admin refuses a member without the admin role', async (t) => {
	const entry = [...SERVERS.entries()].find(([, srv]) => srv.adminRoleId !== undefined);
	if (entry === undefined) return t.skip('no configured server has adminRoleId');
	const [key, srv] = entry;
	const { interaction, replies } = fakeInteraction(Command.SERVER_ADMIN, {
		server: key,
		roles: rolesFor(srv)
	});
	await resolveAdminCommand(interaction);
	assert.equal(contentOf(replies[0]), `You don't have admin access to ${srv.label} server!`);
});

test('/admin shows admin info to an admin', async (t) => {
	const entry = [...SERVERS.entries()].find(([, srv]) => srv.adminRoleId !== undefined);
	if (entry === undefined) return t.skip('no configured server has adminRoleId');
	const [key, srv] = entry;
	const { interaction, replies } = fakeInteraction(Command.SERVER_ADMIN, {
		server: key,
		roles: rolesFor(srv, true)
	});
	await resolveAdminCommand(interaction);
	assert.ok(contentOf(replies[0]).includes(srv.label));
});

test('unknown and unsupported command responses', async () => {
	const unknown = fakeInteraction('whatever');
	await unknownCommandResponse(unknown.interaction);
	assert.match(contentOf(unknown.replies[0]), /Invalid command/);

	const unsupported = fakeInteraction('whatever');
	await commandNotSupportedResponse(unsupported.interaction);
	assert.match(contentOf(unsupported.replies[0]), /not currently supported/);
});
