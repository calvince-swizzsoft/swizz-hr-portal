import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createApiClient } from '../src/lib/api.js';

test('login sends no bearer token and profile uses the established token', async () => {
  const calls = [];
  const api = createApiClient({ fetchImpl: async (...args) => { calls.push(args); return new Response(JSON.stringify({ success: true, data: { Id: 'employee' } })); } });
  api.setToken('session-token');
  await api.login({ UserName: 'employee', Password: 'example' });
  assert.equal(calls[0][1].headers.Authorization, undefined);
  assert.deepEqual(await api.profile(), { Id: 'employee' });
  assert.equal(calls[1][1].headers.Authorization, 'Bearer session-token');
});

test('expired sessions clear authentication and propagate the safe error', async () => {
  let ended = false;
  const calls = [];
  const api = createApiClient({ onUnauthorized: () => { ended = true; }, fetchImpl: async (...args) => {
    calls.push(args); return new Response(JSON.stringify({ message: 'Session expired', correlationId: 'ref-1' }), { status: calls.length === 1 ? 401 : 200 });
  } });
  api.setToken('expired');
  await assert.rejects(api.profile(), error => error instanceof ApiError && error.status === 401 && error.correlationId === 'ref-1');
  assert.equal(ended, true);
  await api.profile();
  assert.equal(calls[1][1].headers.Authorization, undefined);
});

test('cancellation remains distinct from a network failure', async () => {
  const api = createApiClient({ fetchImpl: async () => { throw new DOMException('Cancelled', 'AbortError'); } });
  await assert.rejects(api.profile(), { name: 'AbortError' });
});

test('an HTML fallback cannot be mistaken for a successful API response', async () => {
  const api = createApiClient({ fetchImpl: async () => new Response('<html>Portal</html>') });
  await assert.rejects(api.profile(), error => error instanceof ApiError && /unexpected response/.test(error.message));
});
