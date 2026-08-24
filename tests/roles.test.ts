import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { hasAdminRole, hasDefaultRole, hasServerRole } from '../src/discord/roles.ts';
import { fakeInteraction, makeServer } from './fakes.ts';

// Must match .env.test, which roles.ts read at import time.
const BASE_ROLE = process.env['DEFAULT_ROLE_ID'] as string;
const SERVER_ROLE = '200000000000000002';
const ADMIN_ROLE = '300000000000000003';

test('hasDefaultRole requires exactly the base role', () => {
	assert.equal(hasDefaultRole(fakeInteraction('bot', { roles: [BASE_ROLE] }).interaction), true);
	assert.equal(hasDefaultRole(fakeInteraction('bot').interaction), false);
	assert.equal(hasDefaultRole(fakeInteraction('bot', { roles: [SERVER_ROLE] }).interaction), false);
});

test('hasServerRole needs only the base role when the server sets no roleId', () => {
	const srv = makeServer();
	const permitted = fakeInteraction('status', { roles: [BASE_ROLE] }).interaction;
	const stranger = fakeInteraction('status').interaction;
	assert.equal(hasServerRole(permitted, srv), true);
	assert.equal(hasServerRole(stranger, srv), false);
});

test('hasServerRole needs base and server roles when roleId is set', () => {
	const srv = makeServer({ roleId: SERVER_ROLE });
	const both = fakeInteraction('status', { roles: [BASE_ROLE, SERVER_ROLE] }).interaction;
	const baseOnly = fakeInteraction('status', { roles: [BASE_ROLE] }).interaction;
	const serverOnly = fakeInteraction('status', { roles: [SERVER_ROLE] }).interaction;
	assert.equal(hasServerRole(both, srv), true);
	assert.equal(hasServerRole(baseOnly, srv), false);
	assert.equal(hasServerRole(serverOnly, srv), false);
});

test('hasAdminRole stacks base, server and admin roles', () => {
	const srv = makeServer({ roleId: SERVER_ROLE, adminRoleId: ADMIN_ROLE });
	const all = fakeInteraction('admin', { roles: [BASE_ROLE, SERVER_ROLE, ADMIN_ROLE] }).interaction;
	const noAdmin = fakeInteraction('admin', { roles: [BASE_ROLE, SERVER_ROLE] }).interaction;
	const noServer = fakeInteraction('admin', { roles: [BASE_ROLE, ADMIN_ROLE] }).interaction;
	const adminOnly = fakeInteraction('admin', { roles: [ADMIN_ROLE] }).interaction;
	assert.equal(hasAdminRole(all, srv), true);
	assert.equal(hasAdminRole(noAdmin, srv), false);
	assert.equal(hasAdminRole(noServer, srv), false);
	assert.equal(hasAdminRole(adminOnly, srv), false);
});

test('hasAdminRole without adminRoleId reduces to the server check', () => {
	const srv = makeServer();
	assert.equal(
		hasAdminRole(fakeInteraction('admin', { roles: [BASE_ROLE] }).interaction, srv),
		true
	);
	assert.equal(hasAdminRole(fakeInteraction('admin').interaction, srv), false);
});
