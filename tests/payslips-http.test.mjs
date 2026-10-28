import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createApiClient } from '../src/lib/api.js';
import { createSupabasePortalClient } from '../src/lib/supabasePortalClient.js';

test('payslips use authenticated employee-owned GET routes over HTTP and propagate denied access', async () => {
  const calls = [];
  const slip = { Id: 'test-slip', SalaryPeriodMonthDescription: 'October', SalaryPeriodPostingPeriodDescription: 'Test period', NetPay: 1234.5 };
  const entries = [{ Id: 'test-entry', PaySlipId: slip.Id, Description: 'Test entry', Principal: 100, Interest: 0 }];
  const server = createServer((request, response) => {
    calls.push({ path: request.url, method: request.method, token: request.headers.authorization });
    response.setHeader('Content-Type', 'application/json');
    if (request.headers.authorization === 'Bearer expired') {
      response.statusCode = 401; response.end(JSON.stringify({ message: 'Session expired' })); return;
    }
    if (request.url.endsWith('/foreign/entries')) {
      response.statusCode = 404; response.end(JSON.stringify({ message: 'Payslip not found.', error: { code: 'RESOURCE_NOT_FOUND' } })); return;
    }
    if (request.url.endsWith('/locked')) {
      response.statusCode = 403; response.end(JSON.stringify({ message: 'Active employee required.' })); return;
    }
    let data;
    if (request.url === '/api/hr-portal/me/payslips?pageIndex=2&pageSize=20') data = { PageCollection: [slip], TotalPages: 3, TotalCount: 41, PageIndex: 2, PageSize: 20 };
    else if (request.url === '/api/hr-portal/me/payslips/test-slip') data = slip;
    else if (request.url === '/api/hr-portal/me/payslips/test-slip/entries') data = entries;
    else { response.statusCode = 501; response.end(JSON.stringify({ message: 'Unexpected route' })); return; }
    response.end(JSON.stringify({ success: true, data }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    let ended = 0;
    const api = createApiClient({ baseUrl: `http://127.0.0.1:${server.address().port}/api`, onUnauthorized: () => ended++ });
    api.setToken('in-memory-test-session');
    assert.equal(api.canViewPayslips, true);
    assert.deepEqual((await api.payslips(2)).PageCollection, [slip]);
    assert.deepEqual(await api.payslip('test-slip'), slip);
    assert.deepEqual(await api.payslipEntries('test-slip'), entries);
    assert.ok(calls.every(call => call.method === 'GET' && call.token === 'Bearer in-memory-test-session'));
    assert.ok(calls.every(call => call.path.startsWith('/api/hr-portal/me/payslips')));
    await assert.rejects(api.payslipEntries('foreign'), error => error.status === 404 && error.code === 'RESOURCE_NOT_FOUND');
    await assert.rejects(api.payslip('locked'), error => error.status === 403);
    const abort = new AbortController(); abort.abort();
    await assert.rejects(api.payslips(2, { signal: abort.signal }), { name: 'AbortError' });
    api.setToken('expired');
    await assert.rejects(api.payslips(2), error => error.status === 401);
    assert.equal(ended, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('development mode exposes no synthetic payroll and never calls Supabase for payslips', async () => {
  let calls = 0;
  const api = createSupabasePortalClient({ supabase: { rpc: () => { calls++; throw new Error('Payroll must not call Supabase'); } } });
  assert.equal(api.canViewPayslips, false);
  for (const run of [() => api.payslips(), () => api.payslip('test'), () => api.payslipEntries('test')])
    await assert.rejects(run(), error => error.status === 400 && /ERP/.test(error.message));
  assert.equal(calls, 0);
});
