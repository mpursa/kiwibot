import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describe } from '../dist/server/state.js';
import { makeServer } from './fakes.js';

test('describe covers every state with the right marker', () => {
	const srv = makeServer();
	assert.ok(describe(srv, 'running').includes('🟢'));
	assert.ok(describe(srv, 'running').includes(`${srv.address}:${srv.port}`));
	assert.ok(describe(srv, 'starting').includes('🟡'));
	assert.ok(describe(srv, 'stopped').includes('🔴'));
	assert.ok(describe(srv, 'failed').includes(srv.unit));
	assert.ok(describe(srv, 'unknown').includes(srv.label));
});
