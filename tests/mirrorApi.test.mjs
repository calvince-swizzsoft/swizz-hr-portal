import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/lib/api.js';
import { createMirrorApiClient } from '../src/lib/mirrorApi.js';

function fakeSupabase(result, signIn = { data: { session: { access_token: 'mirror-token' }, user: { email: 'admin@example.com' } }, error: null }) {
  const calls = [];
  const auth = {
    async signInWithPassword(credentials) { calls.push(['signIn', credentials]); return signIn; },
    async signOut(options) { calls.push(['signOut', options]); return { error: null }; },
  };
  const query = {
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
    abortSignal() { return query; },
    maybeSingle() { calls.push(['maybeSingle']); return query; },
  };
  for (const method of ['select', 'order', 'range', 'eq', 'update']) query[method] = (...args) => { calls.push([method, ...args]); return query; };
  const storage = {
    from(bucket) {
      return { async createSignedUrl(path, seconds) { calls.push(['signedUrl', bucket, path, seconds]); return result?.signedUrl ?? { data: { signedUrl: 'https://files/doc.pdf' }, error: null }; } };
    },
  };
  return { calls, auth, storage, from(table) { calls.push(['from', table]); return query; } };
}

test('all payslips are paged newest first with their employee', async () => {
  const supabase = fakeSupabase({ data: [{ Id: 'p', Year: 2026, Month: 10, NetPay: 85000 }], count: 21, error: null });
  const page = await createMirrorApiClient({ supabase }).payslips(1);
  assert.deepEqual(page, { PageCollection: [{ Id: 'p', Year: 2026, Month: 10, NetPay: 85000 }], ItemsCount: 21, TotalPages: 2 });
  assert.deepEqual(supabase.calls[0], ['from', 'payslip_mirror']);
  assert.match(supabase.calls[1][1], /Employee:employee_mirror\(Id,CustomerFullName,CustomerIndividualPayrollNumbers\)/);
  assert.equal(supabase.calls.some(call => call[0] === 'eq'), false);
  assert.deepEqual(supabase.calls.filter(call => call[0] === 'order').map(call => call[1]), ['Year', 'Month', 'Id']);
  assert.equal(supabase.calls.find(call => call[0] === 'order')[2].ascending, false);
  assert.deepEqual(supabase.calls.find(call => call[0] === 'range'), ['range', 20, 39]);
});

test('all P9 forms are paged newest year first with their employee', async () => {
  const supabase = fakeSupabase({ data: [{ Id: 'a', Year: 2025 }], count: 1, error: null });
  assert.deepEqual(await createMirrorApiClient({ supabase }).p9Forms(), { PageCollection: [{ Id: 'a', Year: 2025 }], ItemsCount: 1, TotalPages: 1 });
  assert.deepEqual(supabase.calls[0], ['from', 'p9_mirror']);
  assert.match(supabase.calls[1][1], /Employee:employee_mirror\(/);
  assert.deepEqual(supabase.calls.find(call => call[0] === 'range'), ['range', 0, 19]);
});

test('document downloads use a short-lived link from the private bucket', async () => {
  const supabase = fakeSupabase();
  assert.equal(await createMirrorApiClient({ supabase }).documentUrl('payslips/2026-10.pdf'), 'https://files/doc.pdf');
  assert.deepEqual(supabase.calls[0], ['signedUrl', 'hr-documents', 'payslips/2026-10.pdf', 300]);
});

test('a missing PDF is explained', async () => {
  const api = createMirrorApiClient({ supabase: fakeSupabase({ signedUrl: { data: null, error: { message: 'Object not found' } } }) });
  await assert.rejects(api.documentUrl('missing.pdf'), error => error instanceof ApiError && /missing\.pdf/.test(error.message));
});

test('login signs in with Supabase Auth using the email and returns the session', async () => {
  const supabase = fakeSupabase();
  const result = await createMirrorApiClient({ supabase }).login({ UserName: ' admin@example.com ', Password: 'secret1' });
  assert.deepEqual(result, { token: 'mirror-token', email: 'admin@example.com' });
  assert.deepEqual(supabase.calls[0], ['signIn', { email: 'admin@example.com', password: 'secret1' }]);
});

test('a plain username signs in as that name at example.com', async () => {
  const supabase = fakeSupabase();
  await createMirrorApiClient({ supabase }).login({ UserName: ' admin ', Password: 'secret1' });
  assert.deepEqual(supabase.calls[0], ['signIn', { email: 'admin@example.com', password: 'secret1' }]);
});

test('a wrong password is reported as an ApiError', async () => {
  const api = createMirrorApiClient({ supabase: fakeSupabase(null, { data: {}, error: { message: 'Invalid login credentials', status: 400 } }) });
  await assert.rejects(api.login({ UserName: 'admin@example.com', Password: 'wrong' }), error => error instanceof ApiError && error.status === 400 && /Invalid login/.test(error.message));
});

test('sign out ends the local Supabase session', async () => {
  const supabase = fakeSupabase();
  createMirrorApiClient({ supabase }).clearToken();
  assert.deepEqual(supabase.calls[0], ['signOut', { scope: 'local' }]);
});

test('employees are paged from the mirror table using ERP response field names', async () => {
  const supabase = fakeSupabase({ data: [{ Id: 'a', CustomerFullName: 'Name' }], count: 21, error: null });
  const page = await createMirrorApiClient({ supabase }).employees(1);
  assert.deepEqual(page, { PageCollection: [{ Id: 'a', CustomerFullName: 'Name' }], ItemsCount: 21, TotalPages: 2 });
  assert.deepEqual(supabase.calls[0], ['from', 'employee_mirror']);
  assert.match(supabase.calls[1][1], /^Id,CustomerFullName,.*NationalHospitalInsuranceFundNumber$/);
  assert.doesNotMatch(supabase.calls[1][1], /AuthUserId/);
  assert.deepEqual(supabase.calls.find(call => call[0] === 'range'), ['range', 20, 39]);
});

test('an empty table returns an empty first page', async () => {
  const page = await createMirrorApiClient({ supabase: fakeSupabase({ data: [], count: 0, error: null }) }).employees();
  assert.deepEqual(page, { PageCollection: [], ItemsCount: 0, TotalPages: 0 });
});

test('a single employee is read by id', async () => {
  const supabase = fakeSupabase({ data: { Id: 'a' }, error: null });
  assert.deepEqual(await createMirrorApiClient({ supabase }).employee('a'), { Id: 'a' });
  assert.deepEqual(supabase.calls.find(call => call[0] === 'eq'), ['eq', 'Id', 'a']);
});

test('missing and malformed employee ids are reported as not found', async () => {
  const notFound = error => error instanceof ApiError && error.status === 404;
  await assert.rejects(createMirrorApiClient({ supabase: fakeSupabase({ data: null, error: null }) }).employee('a'), notFound);
  await assert.rejects(createMirrorApiClient({ supabase: fakeSupabase({ data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } }) }).employee('x'), notFound);
});

test('a missing or expired session ends the sign-in', async () => {
  let ended = false;
  const api = createMirrorApiClient({ onUnauthorized: () => { ended = true; }, supabase: fakeSupabase({ data: null, status: 401, error: { code: '42501', message: 'permission denied' } }) });
  await assert.rejects(api.employees(), error => error instanceof ApiError && error.status === 401 && /session has ended/.test(error.message));
  assert.equal(ended, true);
});

test('a permission error while signed in is reported without signing out', async () => {
  let ended = false;
  const api = createMirrorApiClient({ onUnauthorized: () => { ended = true; }, supabase: fakeSupabase({ data: null, status: 403, error: { code: '42501', message: 'permission denied for table employee_mirror' } }) });
  await assert.rejects(api.employees(), error => error instanceof ApiError && error.status === 403 && /permission denied/.test(error.message));
  assert.equal(ended, false);
});

test('updates send editable fields trimmed, clear blanks, and never change the id', async () => {
  const supabase = fakeSupabase({ data: { Id: 'a' }, error: null });
  await createMirrorApiClient({ supabase }).updateEmployee('a', {
    Id: 'other', AuthUserId: 'user', CustomerFullName: ' Name ', CustomerAddressEmail: '  person@example.com ', CustomerAddressMobileLine: '   ', CustomerIndividualPayrollNumbers: 'P-1',
  });
  assert.deepEqual(supabase.calls.find(call => call[0] === 'update'), ['update', {
    CustomerFullName: 'Name', CustomerIndividualPayrollNumbers: 'P-1', CustomerAddressEmail: 'person@example.com', CustomerAddressMobileLine: null,
  }]);
  assert.deepEqual(supabase.calls.find(call => call[0] === 'eq'), ['eq', 'Id', 'a']);
});

test('invalid details are rejected before saving', async () => {
  const supabase = fakeSupabase({ data: { Id: 'a' }, error: null });
  const api = createMirrorApiClient({ supabase });
  await assert.rejects(api.updateEmployee('a', { CustomerFullName: '  ' }), /full name/);
  await assert.rejects(api.updateEmployee('a', { EmploymentStartDate: '16/10/2026' }), /valid start date/);
  await assert.rejects(api.updateEmployee('a', { CustomerAddressEmail: 'not-an-email' }), /valid email/);
  await assert.rejects(api.updateEmployee('a', { CustomerAddressMobileLine: 'call me' }), /valid mobile/);
  assert.equal(supabase.calls.some(call => call[0] === 'update'), false);
});

test('an update blocked by row-level security is not reported as saved', async () => {
  const api = createMirrorApiClient({ supabase: fakeSupabase({ data: null, error: null }) });
  await assert.rejects(api.updateEmployee('a', { CustomerAddressEmail: 'person@example.com' }), error => error.status === 403 && /not saved/.test(error.message));
});

test('missing Supabase configuration is explained', async () => {
  await assert.rejects(createMirrorApiClient({ supabase: null }).employees(), /Supabase is not configured/);
});
