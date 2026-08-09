import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parsePlayers } from '../dist/server/players.js';

test('csv drops the header row and takes the first column', () => {
	// Palworld's ShowPlayers.
	const answer = 'name,playeruid,steamid\nAlice,123,7656119\nBob,124,7656120';
	assert.deepEqual(parsePlayers(answer, 'csv'), ['Alice', 'Bob']);
});

test('csv with only the header means nobody is connected', () => {
	assert.deepEqual(parsePlayers('name,playeruid,steamid', 'csv'), []);
});

test('csv without a header row keeps every row', () => {
	assert.deepEqual(parsePlayers('Alice,123\nBob,124', 'csv'), ['Alice', 'Bob']);
});

test('sentence takes the names after the last colon', () => {
	// Minecraft's list.
	const answer = 'There are 2 of a max of 20 players online: Alice, Bob';
	assert.deepEqual(parsePlayers(answer, 'sentence'), ['Alice', 'Bob']);
});

test('sentence with an empty tail means nobody is connected', () => {
	assert.deepEqual(parsePlayers('There are 0 of a max of 20 players online:', 'sentence'), []);
});

test('sentence without a colon yields no names', () => {
	assert.deepEqual(parsePlayers('nobody is playing', 'sentence'), []);
});

test('lines treats every non-empty line as a name', () => {
	assert.deepEqual(parsePlayers('Alice\n\n  Bob  \n', 'lines'), ['Alice', 'Bob']);
});

test('an empty answer yields no names in any format', () => {
	for (const format of ['csv', 'sentence', 'lines'] as const) {
		assert.deepEqual(parsePlayers('   \n  ', format), []);
	}
});
