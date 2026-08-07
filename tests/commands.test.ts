import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	Command,
	COMMANDS,
	CommandType,
	discordCommands,
	getCommandFromName
} from '../dist/discord/commands.js';
import { fakeInteraction } from './fakes.js';

test('getCommandFromName resolves registered commands', () => {
	const cmd = getCommandFromName(fakeInteraction(Command.SERVER_START).interaction);
	assert.equal(cmd.name, Command.SERVER_START);
	assert.equal(cmd.type, CommandType.SERVER);
});

test('getCommandFromName falls back to the unknown sentinel', () => {
	const cmd = getCommandFromName(fakeInteraction('garbage').interaction);
	assert.equal(cmd.type, CommandType.UNKNOWN);
});

test('every command registers with a non-empty description', () => {
	// Discord rejects the whole registration body over one empty description.
	assert.equal(discordCommands.length, COMMANDS.length);
	for (const cmd of discordCommands) {
		assert.ok(cmd.description.length > 0, `/${cmd.name} has an empty description`);
	}
});

test('server commands carry the required server option', () => {
	for (const cmd of COMMANDS) {
		if (cmd.type !== CommandType.SERVER) continue;
		const registered = discordCommands.find((c) => c.name === cmd.name);
		assert.ok(
			registered?.options?.some((o) => o.name === 'server' && 'required' in o && o.required === true)
		);
	}
});
