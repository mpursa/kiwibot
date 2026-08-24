import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { AutoStopTracker } from '../src/server/autostop.ts';

const MINUTES = 30;
const MS = 60_000;
const T0 = 1_700_000_000_000;

test('the countdown starts on the first confirmed-empty observation', () => {
	const tracker = new AutoStopTracker();
	assert.equal(tracker.observe('a', MINUTES, 'running', [], T0), 'waiting');
});

test('it waits until the configured minutes have fully elapsed', () => {
	const tracker = new AutoStopTracker();
	tracker.observe('a', MINUTES, 'running', [], T0);
	assert.equal(tracker.observe('a', MINUTES, 'running', [], T0 + 29 * MS), 'waiting');
	assert.equal(tracker.observe('a', MINUTES, 'running', [], T0 + 30 * MS), 'stop');
});

test('a player appearing mid-countdown resets it', () => {
	const tracker = new AutoStopTracker();
	tracker.observe('a', MINUTES, 'running', [], T0);
	assert.equal(tracker.observe('a', MINUTES, 'running', ['alice'], T0 + 20 * MS), 'idle');
	// The clock restarts here, so the original deadline must not fire.
	assert.equal(tracker.observe('a', MINUTES, 'running', [], T0 + 21 * MS), 'waiting');
	assert.equal(tracker.observe('a', MINUTES, 'running', [], T0 + 50 * MS), 'waiting');
	assert.equal(tracker.observe('a', MINUTES, 'running', [], T0 + 51 * MS), 'stop');
});

test('an unknown player list resets the countdown — the safety property', () => {
	const tracker = new AutoStopTracker();
	tracker.observe('a', MINUTES, 'running', [], T0);
	// RCON down or a blank answer: emptiness is unverified, so never stop on it.
	assert.equal(tracker.observe('a', MINUTES, 'running', undefined, T0 + 20 * MS), 'idle');
	assert.equal(tracker.observe('a', MINUTES, 'running', [], T0 + 40 * MS), 'waiting');
});

test('a server that is not running is never counted down', () => {
	const tracker = new AutoStopTracker();
	for (const state of ['starting', 'stopped', 'failed', 'unknown'] as const) {
		assert.equal(tracker.observe('a', MINUTES, state, [], T0), 'idle');
	}
	// Still nothing pending once it comes up.
	assert.equal(tracker.observe('a', MINUTES, 'running', [], T0), 'waiting');
});

test('a server stopping mid-countdown resets it', () => {
	const tracker = new AutoStopTracker();
	tracker.observe('a', MINUTES, 'running', [], T0);
	assert.equal(tracker.observe('a', MINUTES, 'stopped', undefined, T0 + 10 * MS), 'idle');
	assert.equal(tracker.observe('a', MINUTES, 'running', [], T0 + 40 * MS), 'waiting');
});

test('stopping clears the clock, so a failed stop waits out another period', () => {
	const tracker = new AutoStopTracker();
	tracker.observe('a', MINUTES, 'running', [], T0);
	assert.equal(tracker.observe('a', MINUTES, 'running', [], T0 + 30 * MS), 'stop');
	// The unit did not actually go down; the next tick must not stop it again.
	assert.equal(tracker.observe('a', MINUTES, 'running', [], T0 + 31 * MS), 'waiting');
});

test('servers are tracked independently', () => {
	const tracker = new AutoStopTracker();
	tracker.observe('a', MINUTES, 'running', [], T0);
	tracker.observe('b', MINUTES, 'running', [], T0 + 10 * MS);
	assert.equal(tracker.observe('a', MINUTES, 'running', [], T0 + 30 * MS), 'stop');
	assert.equal(tracker.observe('b', MINUTES, 'running', [], T0 + 30 * MS), 'waiting');
});

test('each server honours its own configured idle time', () => {
	const tracker = new AutoStopTracker();
	tracker.observe('quick', 5, 'running', [], T0);
	assert.equal(tracker.observe('quick', 5, 'running', [], T0 + 5 * MS), 'stop');
});

test('forget drops a pending countdown', () => {
	const tracker = new AutoStopTracker();
	tracker.observe('a', MINUTES, 'running', [], T0);
	tracker.forget('a');
	assert.equal(tracker.observe('a', MINUTES, 'running', [], T0 + 30 * MS), 'waiting');
});
