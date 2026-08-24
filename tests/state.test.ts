import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { describe } from '../src/server/state.ts';
import { makeServer } from './fakes.ts';

test('describe covers every state with the right marker', () => {
	const srv = makeServer();
	assert.ok(describe(srv, 'running').includes('🟢'));
	assert.ok(describe(srv, 'running').includes(`${srv.address}:${srv.port}`));
	assert.ok(describe(srv, 'starting').includes('🟡'));
	assert.ok(describe(srv, 'stopped').includes('🔴'));
	assert.ok(describe(srv, 'failed').includes(srv.unit));
	assert.ok(describe(srv, 'unknown').includes(srv.label));
});
