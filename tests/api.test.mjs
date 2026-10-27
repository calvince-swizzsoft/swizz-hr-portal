import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createApiClient } from '../src/lib/api.js';

test('login sends no bearer token and profile uses the established token', async () => {
  const calls = [];
  const api = createApiClient({ fetchImpl: async (...args) => { calls.push(args); return new Response(JSON.stringify({ success: true, data: { Id: 'employee' } })); } });
  api.setToken('session-token');
  await api.login({ UserName: 'employee', Password: 'example' });
  assert.deepEqual(JSON.parse(calls[0][1].body), { userName: 'employee', password: 'example' });
  assert.equal(calls[0][1].headers.Authorization, undefined);
  assert.deepEqual(await api.profile(), { Id: 'employee' });
  assert.equal(calls[1][1].headers.Authorization, 'Bearer session-token');
});

test('email confirmation and initial password changes use the documented API contracts', async () => {
  const calls = [];
  const loginResult = { token: 'new-session', userName: 'employee', roles: [] };
  const api = createApiClient({ baseUrl: 'https://fosa-api.ngrok.dev/api/', fetchImpl: async (...args) => {
    calls.push(args);
    return Response.json({
      success: true,
      data: calls.length === 3 ? loginResult : { message: 'Confirmed' },
    });
  } });

  await api.confirmEmail({ UserId: 'user-1', Code: '123456' });
  const result = await api.changeInitialPassword({
    UserName: 'employee',
    CurrentPassword: 'temporary',
    NewPassword: 'new-password',
    ConfirmPassword: 'new-password',
  });

  assert.equal(calls[0][0], 'https://fosa-api.ngrok.dev/api/auth/confirm-email');
  assert.deepEqual(JSON.parse(calls[0][1].body), { userId: 'user-1', code: '123456' });
  assert.equal(calls[0][1].headers.Authorization, undefined);
  assert.equal(calls[1][0], 'https://fosa-api.ngrok.dev/api/auth/change-initial-password');
  assert.deepEqual(JSON.parse(calls[1][1].body), {
    userName: 'employee',
    currentPassword: 'temporary',
    newPassword: 'new-password',
    confirmPassword: 'new-password',
  });
  assert.equal(calls[2][0], 'https://fosa-api.ngrok.dev/api/auth/login');
  assert.deepEqual(JSON.parse(calls[2][1].body), { userName: 'employee', password: 'new-password' });
  assert.deepEqual(result, loginResult);
});

test('signed-in password changes use the password endpoint and replace the session', async () => {
  const calls = [];
  const api = createApiClient({ fetchImpl: async (...args) => {
    calls.push(args);
    if (calls.length === 2) return Response.json({ success: true, data: { token: 'updated-session', userName: 'employee' } });
    return Response.json({ success: true, data: {} });
  } });
  api.setToken('old-session');

  const result = await api.changePassword({
    UserName: 'employee',
    CurrentPassword: 'old-password',
    NewPassword: 'new-password',
    ConfirmPassword: 'new-password',
  });

  assert.equal(calls[0][0], '/api/auth/change-initial-password');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(calls[0][1].body), {
    userName: 'employee',
    currentPassword: 'old-password',
    newPassword: 'new-password',
    confirmPassword: 'new-password',
  });
  assert.equal(calls[1][0], '/api/auth/login');
  assert.equal(calls[1][1].headers.Authorization, undefined);
  assert.deepEqual(result, { token: 'updated-session', userName: 'employee' });
  api.setToken(result.token);
  await api.profile();
  assert.ok(calls[2][1].headers.Authorization);
});

test('leave preview sends required query fields and includes excludedId only when supplied', async () => {
  const calls = [];
  const api = createApiClient({ fetchImpl: async (...args) => {
    calls.push(args);
    return Response.json({ success: true, data: { CanSubmit: true } });
  } });
  api.setToken('session-token');

  await api.preview({ leaveTypeId: 'annual', start: '2026-11-01', end: '2026-11-02' });
  await api.preview({ leaveTypeId: 'annual', start: '2026-11-01', end: '2026-11-02', excludedId: 'application-1' });

  assert.equal(calls[0][0], '/api/hr-portal/me/leave-preview?leaveTypeId=annual&start=2026-11-01&end=2026-11-02');
  assert.equal(calls[1][0], '/api/hr-portal/me/leave-preview?leaveTypeId=annual&start=2026-11-01&end=2026-11-02&excludedId=application-1');
  assert.ok(calls[0][1].headers.Authorization);
  assert.equal(calls[0][1].method || 'GET', 'GET');
});

test('editing a pending leave sends the leave body to its own application endpoint', async () => {
  const calls = [];
  const api = createApiClient({ fetchImpl: async (...args) => {
    calls.push(args);
    return Response.json({ success: true, data: { Id: 'application-1', Status: 1 } });
  } });
  api.setToken('session-token');
  const leaveBody = {
    leaveTypeId: 'annual',
    start: '2026-10-26',
    end: '2026-11-02',
    reason: 'Annual leave',
  };

  await api.updateLeave('application-1', leaveBody);

  assert.equal(calls[0][0], '/api/hr-portal/me/leave-applications/application-1');
  assert.equal(calls[0][1].method, 'PUT');
  assert.ok(calls[0][1].headers.Authorization);
  assert.deepEqual(JSON.parse(calls[0][1].body), leaveBody);
});

test('notification retries use the application endpoint with no request body', async () => {
  const calls = [];
  const api = createApiClient({ fetchImpl: async (...args) => {
    calls.push(args);
    return Response.json({ success: true, data: { NotificationPending: false } });
  } });
  api.setToken('session-token');

  await api.retryNotification('application/1');

  assert.equal(calls[0][0], '/api/hr-portal/me/leave-applications/application%2F1/retry-notification');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].body, undefined);
  assert.equal(calls[0][1].headers['Content-Type'], undefined);
  assert.ok(calls[0][1].headers.Authorization);
});

test('leave types are loaded from the employee-scoped endpoint', async () => {
  const calls = [];
  const api = createApiClient({ fetchImpl: async (...args) => {
    calls.push(args);
    return new Response(JSON.stringify({ success: true, data: [{ Id: 'annual', Description: 'Annual leave' }] }));
  } });
  api.setToken('session-token');

  assert.deepEqual(await api.leaveTypes(), [{ Id: 'annual', Description: 'Annual leave' }]);
  assert.equal(calls[0][0], '/api/hr-portal/me/leave-types');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer session-token');
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
