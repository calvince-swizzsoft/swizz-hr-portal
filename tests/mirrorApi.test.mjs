import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/lib/api.js';
import { createMirrorApiClient } from '../src/lib/mirrorApi.js';

function fakeSupabase(result) {
  const calls = [];
  const query = {
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
    abortSignal() { return query; },
    maybeSingle() { calls.push(['maybeSingle']); return query; },
  };
  for (const method of ['select', 'order', 'range', 'eq']) query[method] = (...args) => { calls.push([method, ...args]); return query; };
  return { calls, from(table) { calls.push(['from', table]); return query; } };
}

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

test('a blocked table read is reported as an ApiError', async () => {
  const api = createMirrorApiClient({ supabase: fakeSupabase({ data: null, status: 401, error: { code: '42501', message: 'permission denied' } }) });
  await assert.rejects(api.employees(), error => error instanceof ApiError && error.status === 401);
});

test('missing Supabase configuration is explained', async () => {
  await assert.rejects(createMirrorApiClient({ supabase: null }).employees(), /Supabase is not configured/);
});
