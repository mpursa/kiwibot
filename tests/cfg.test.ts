import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { loadServers } from '../dist/core/cfg.js';

/**
 * Writes a config object to a temp file and returns its URL, like the real
 * servers.json.
 *
 * @param {unknown} config - Config object to serialize.
 * @returns {URL} file:// URL loadServers can read.
 */
function fixture(config: unknown): URL {
	const dir = mkdtempSync(join(tmpdir(), 'serverbot-test-'));
	const file = join(dir, 'servers.json');
	writeFileSync(file, JSON.stringify(config));
	return pathToFileURL(file);
}

const VALID = {
	label: 'Testworld',
	unit: 'testworld',
	address: 'test.example.com',
	port: 8211,
	protocol: 'udp'
};

test('a minimal server parses with defaults applied', () => {
	const servers = loadServers(fixture({ testworld: VALID }));
	const srv = servers.get('testworld');
	assert.ok(srv);
	assert.equal(srv.startupMs, 120_000);
	assert.equal(srv.roleId, undefined);
	assert.equal(srv.password, undefined);
});

test('optional fields survive the parse', () => {
	const servers = loadServers(
		fixture({
			testworld: {
				...VALID,
				password: 'hunter2',
				adminInfo: 'console at :8212',
				roleId: '1',
				adminRoleId: '2'
			}
		})
	);
	const srv = servers.get('testworld');
	assert.ok(srv);
	assert.equal(srv.password, 'hunter2');
	assert.equal(srv.adminRoleId, '2');
});

test('rejects an invalid port', () => {
	assert.throws(() => loadServers(fixture({ bad: { ...VALID, port: 70_000 } })), /port/);
	assert.throws(() => loadServers(fixture({ bad: { ...VALID, port: 0 } })), /port/);
});

test('rejects an invalid protocol', () => {
	assert.throws(() => loadServers(fixture({ bad: { ...VALID, protocol: 'sctp' } })), /protocol/);
});

test('rejects startupMs beyond the Discord interaction window', () => {
	assert.throws(() => loadServers(fixture({ bad: { ...VALID, startupMs: 900_000 } })), /startupMs/);
});

test('rejects an empty config and malformed keys', () => {
	assert.throws(() => loadServers(fixture({})), /no servers/);
	assert.throws(() => loadServers(fixture({ 'Bad Key': VALID })), /lowercase/);
});

test('an rcon block parses, defaulting host to loopback', () => {
	const servers = loadServers(
		fixture({
			testworld: {
				...VALID,
				rcon: { port: 25575, password: 'pw', playersCommand: 'ShowPlayers' }
			}
		})
	);
	const rcon = servers.get('testworld')?.rcon;
	assert.ok(rcon);
	assert.equal(rcon.host, '127.0.0.1');
	assert.equal(rcon.port, 25575);
	assert.equal(rcon.playersCommand, 'ShowPlayers');
});

test('an explicit rcon host wins over the default', () => {
	const servers = loadServers(
		fixture({
			testworld: {
				...VALID,
				rcon: { host: '10.0.0.5', port: 25575, password: 'pw', playersCommand: 'list' }
			}
		})
	);
	assert.equal(servers.get('testworld')?.rcon?.host, '10.0.0.5');
});

test('rejects a malformed rcon block', () => {
	const withRcon = (rcon: unknown) => () => loadServers(fixture({ bad: { ...VALID, rcon } }));
	assert.throws(withRcon('nope'), /rcon must be an object/);
	assert.throws(withRcon({ password: 'pw', playersCommand: 'list' }), /rcon\.port/);
	assert.throws(withRcon({ port: 70_000, password: 'pw', playersCommand: 'list' }), /rcon\.port/);
	assert.throws(withRcon({ port: 25575, playersCommand: 'list' }), /rcon\.password/);
	assert.throws(withRcon({ port: 25575, password: 'pw' }), /rcon\.playersCommand/);
	assert.throws(
		withRcon({ host: '', port: 25575, password: 'pw', playersCommand: 'list' }),
		/rcon\.host/
	);
});

test('rejects non-string optional fields', () => {
	assert.throws(() => loadServers(fixture({ bad: { ...VALID, password: 5 } })), /password/);
	assert.throws(() => loadServers(fixture({ bad: { ...VALID, adminRoleId: 5 } })), /adminRoleId/);
});
