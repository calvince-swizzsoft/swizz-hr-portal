import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createApiClient } from '../src/lib/api.js';

test('password client uses authenticated HTTP, returns the new session, and never retries uncertain changes', async () => {
  const calls = [];
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ path: request.url, auth: request.headers.authorization, body });
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/hr-portal/me') {
      assert.equal(request.headers.authorization, 'Bearer replacement');
      response.end(JSON.stringify({ success: true, data: { Id: 'local-test-employee' } })); return;
    }
    assert.equal(request.url, '/api/auth/change-password');
    assert.equal(request.method, 'POST');
    if (body.currentPassword === 'uncertain') {
      response.statusCode = 503;
      response.end(JSON.stringify({ success: false, message: 'Do not retry automatically.', error: { code: 'PASSWORD_CHANGE_OUTCOME_UNKNOWN' } })); return;
    }
    if (body.currentPassword === 'expired') {
      response.statusCode = 401; response.end(JSON.stringify({ message: 'Session expired' })); return;
    }
    assert.equal(request.headers.authorization, 'Bearer existing');
    assert.deepEqual(body, { currentPassword: 'old', newPassword: 'new', confirmPassword: 'new' });
    response.end(JSON.stringify({ success: true, data: { token: 'replacement', UserName: 'local-test' } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    let ended = 0;
    const api = createApiClient({ baseUrl: `http://127.0.0.1:${server.address().port}/api`, onUnauthorized: () => ended++ });
    api.setToken('existing');
    const result = await api.changePassword({ UserName: 'must-not-be-sent', CurrentPassword: 'old', NewPassword: 'new', ConfirmPassword: 'new' });
    assert.equal(calls.length, 1, 'success must not trigger another login');
    api.setToken(result.token);
    assert.deepEqual(await api.profile(), { Id: 'local-test-employee' });
    const before = calls.length;
    await assert.rejects(api.changePassword({ CurrentPassword: 'uncertain', NewPassword: 'new', ConfirmPassword: 'new' }), error => error.status === 503 && error.code === 'PASSWORD_CHANGE_OUTCOME_UNKNOWN');
    assert.equal(calls.length, before + 1, 'uncertain writes must not be retried');
    await assert.rejects(api.changePassword({ CurrentPassword: 'expired', NewPassword: 'new', ConfirmPassword: 'new' }), error => error.status === 401);
    assert.equal(ended, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
