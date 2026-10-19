import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortalClient } from '../src/lib/portalClient.js';
import { ApiError } from '../src/lib/api.js';

const employee = { Id: '10000000-0000-4000-8000-000000000001', CustomerFullName: 'Test Employee' };
const application = { Id: '30000000-0000-4000-8000-000000000001', EmployeeId: employee.Id, Status: 1, StatusDescription: 'Pending' };
const values = {
  profile: employee, leaveTypes: [{ Id: 'annual', Description: 'Annual leave' }],
  applications: { PageIndex: 0, PageSize: 20, TotalCount: 1, TotalPages: 1, PageCollection: [application] },
  application, balances: { AsAt: '2027-01-01', Balance: { Available: 18 }, History: [], HistoryCount: 0 },
  preview: { RequestedDays: 3, CanSubmit: true, Error: null, Cycles: [] },
  submitLeave: application, updateLeave: application, withdraw: { ...application, Status: 16, StatusDescription: 'Withdrawn' },
};
values.processingApplications = values.applications;
values.processingApplication = { Application: application, Preview: values.preview };
values.authorizeLeave = { ...application, Status: 2, StatusDescription: 'Approved' };
function fakeSupabase(reply = (operation) => ({ success: true, data: values[operation] })) {
  const calls = []; let signedOut = false;
  return {
    calls, get signedOut() { return signedOut; },
    auth: {
      async signInWithPassword(body) { calls.push(['login',body]); return { data: { user: { email: body.email }, session: { access_token: 'test-token', expires_at: Math.floor(Date.now()/1000)+3600 } } }; },
      async signOut() { signedOut = true; return {}; },
    },
    rpc(name, params) {
      calls.push([name,params]);
      const query = { abortSignal(signal) { calls.push(['signal',signal]); return query; },       then(resolve, reject) { return Promise.resolve({ data: reply(params.operation, name, params), error: null }).then(resolve,reject); } };
      return query;
    },
  };
}
const cases = [
  ['processingApplications', [{ status:1,pageIndex:0,pageSize:20 }], '/api/hr-portal/processing/leave-applications?status=1&pageIndex=0&pageSize=20','GET'],
  ['processingApplication', [application.Id], `/api/hr-portal/processing/leave-applications/${application.Id}`,'GET'],
  ['authorizeLeave', [application.Id,{ decision:'approve',remarks:'Test' }], `/api/hr-portal/processing/leave-applications/${application.Id}/authorize`,'POST'],
  ['profile', [], '/api/hr-portal/me','GET'], ['leaveTypes', [], '/api/hr-portal/me/leave-types','GET'],
  ['applications', [0], '/api/hr-portal/me/leave-applications?pageIndex=0&pageSize=20','GET'],
  ['application', [application.Id], `/api/hr-portal/me/leave-applications/${application.Id}`,'GET'],
  ['balances', [{ leaveTypeId:'annual',asAt:'2027-01-01',pageIndex:0 }], '/api/hr-portal/me/leave-balances?leaveTypeId=annual&asAt=2027-01-01&pageIndex=0','GET'],
  ['preview', [{ leaveTypeId:'annual',start:'2027-01-11',end:'2027-01-13' }], '/api/hr-portal/me/leave-preview?leaveTypeId=annual&start=2027-01-11&end=2027-01-13','GET'],
  ['submitLeave', [{ leaveTypeId:'annual',start:'2027-01-11',end:'2027-01-13',reason:'Test' }], '/api/hr-portal/me/leave-applications','POST'],
  ['updateLeave', [application.Id,{ reason:'Changed' }], `/api/hr-portal/me/leave-applications/${application.Id}`,'PUT'],
  ['withdraw', [application.Id], `/api/hr-portal/me/leave-applications/${application.Id}/withdraw`,'POST'],
];
for (const [operation,args,path,method] of cases) {
  test(`both adapters preserve the ${operation} result contract`, async () => {
    const calls = []; const supabase = fakeSupabase();
    const erp = createPortalClient({ source:'erp', fetchImpl: async (url, options) => { calls.push([url,options]); return Response.json({ success:true,data:values[operation] }); } });
    const dev = createPortalClient({ source:'supabase',supabase });
    await dev.login({ UserName:'employee.one@example.test', Password:'test-only' }); erp.setToken('erp-token');
    assert.deepEqual(await dev[operation](...args), await erp[operation](...args));
    assert.equal(calls[0][0],path); assert.equal(calls[0][1].method || 'GET',method);
    assert.equal(calls[0][1].headers.Authorization,'Bearer erp-token');
    assert.equal(supabase.calls[1][0],'portal_dev_request'); assert.equal(supabase.calls[1][1].operation,operation);
    if (operation === 'updateLeave') assert.deepEqual(supabase.calls[1][1].args,{ ...args[1],id:args[0] });
  });
}
test('Supabase requires login, propagates contract errors and clears expired identity', async () => {
  let ended = 0; const supabase = fakeSupabase(() => ({success:false,status:401,message:'Expired',error:{code:'AUTHENTICATION_REQUIRED'}}));
  const api = createPortalClient({source:'supabase',supabase,onUnauthorized:()=>ended++});
  await assert.rejects(api.profile(),e=>e instanceof ApiError && e.status===401);
  assert.equal(supabase.calls.length,0);
  await api.login({UserName:'employee.one@example.test',Password:'test-only'});
  await assert.rejects(api.profile(),e=>e.status===401 && e.code==='AUTHENTICATION_REQUIRED');
  await api.clearToken(); assert.equal(supabase.signedOut,true); assert.equal(ended,2);
});
test('Supabase read cancellation remains AbortError', async () => {
  const api = createPortalClient({source:'supabase',supabase:fakeSupabase()});
  await api.login({UserName:'employee.one@example.test',Password:'test-only'});
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.profile({signal:controller.signal}),{name:'AbortError'});
});
test('processing balance fixture updates use the approver RPC and ERP refuses them', async () => {
  const fixture = { AsAt: '2027-01-10', Balance: { Entitlement: 24, Used: 4, Reserved: 1, Available: 19 } };
  const supabase = fakeSupabase((operation, name) => name === 'portal_dev_processing_balance_fixture'
    ? { success: true, data: fixture }
    : { success: true, data: values[operation] });
  const dev = createPortalClient({ source: 'supabase', supabase });
  await dev.login({ UserName: 'employee.one@example.test', Password: 'test-only' });
  const args = { action: 'get', applicationId: application.Id, asAt: '2027-01-10', pageIndex: 0 };
  assert.deepEqual(await dev.processingBalanceFixture(args), fixture);
  assert.deepEqual(supabase.calls[1], ['portal_dev_processing_balance_fixture', { args }]);
  const erp = createPortalClient({ source: 'erp' });
  await assert.rejects(erp.processingBalanceFixture(args), /only in Supabase development mode/);
});
test('invalid source fails closed and ERP errors never call Supabase', async () => {
  assert.throws(()=>createPortalClient({source:'unknown'}),/Unsupported/);
  const supabase = fakeSupabase();
  const api = createPortalClient({source:'erp',supabase,fetchImpl:async()=>Response.json({success:false,message:'Unavailable'},{status:503})});
  await assert.rejects(api.submitLeave({}),e=>e.status===503); assert.equal(supabase.calls.length,0);
});

test('Supabase profile edits send only self-service fields to the profile function', async () => {
  const saved = { ...employee, CustomerAddressEmail: 'new@example.test' };
  const supabase = fakeSupabase(() => ({ success: true, data: saved }));
  const api = createPortalClient({ source: 'supabase', supabase });
  await api.login({ UserName: 'employee.one@example.test', Password: 'test-only' });
  assert.equal(api.canEditProfile, true);
  await assert.rejects(api.updateProfile({ CustomerAddressEmail: 'new@example.test', Id: 'other', CustomerIndividualPayrollNumbers: 'P-9' }), e => e.status === 400);
  assert.deepEqual(await api.updateProfile({ CustomerAddressEmail: 'new@example.test', CustomerAddressMobileLine: '' }), saved);
  assert.deepEqual(supabase.calls[1], ['portal_dev_update_profile', { changes: { CustomerAddressEmail: 'new@example.test', CustomerAddressMobileLine: '' } }]);
});

test('Supabase profile validation errors and a missing profile function are reported safely', async () => {
  const supabase = fakeSupabase(() => ({ success: false, status: 400, message: 'Enter a valid email address.', error: { code: 'PROFILE_VALIDATION_FAILED' } }));
  const api = createPortalClient({ source: 'supabase', supabase });
  await api.login({ UserName: 'employee.one@example.test', Password: 'test-only' });
  await assert.rejects(api.updateProfile({ CustomerAddressEmail: 'bad' }), e => e instanceof ApiError && e.status === 400 && e.code === 'PROFILE_VALIDATION_FAILED' && /valid email/.test(e.message));
  supabase.rpc = () => Promise.resolve({ data: null, status: 404, error: { code: 'PGRST202', message: 'Raw database details must stay hidden' } });
  await assert.rejects(api.updateProfile({ CustomerAddressEmail: 'a@example.test' }), e => e.code === 'PGRST202' && /contact self-service migration/.test(e.message));
});

test('ERP mode enables contact editing against the own-profile endpoint', async () => {
  const calls = [];
  const api = createPortalClient({ source: 'erp', fetchImpl: async (...args) => { calls.push(args); return Response.json({ success: true, data: employee }); } });
  assert.equal(api.canEditProfile, true);
  assert.deepEqual(await api.updateProfile({ CustomerAddressEmail: 'new@example.test' }), employee);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/hr-portal/me');
  assert.equal(calls[0][1].method, 'PUT');
});

test('Supabase setup failures report a safe actionable code without raw database details', async () => {
  const supabase = fakeSupabase();
  supabase.rpc = () => Promise.resolve({ data: null, status: 404, error: { code: 'PGRST202', message: 'Raw database details must stay hidden' } });
  const api = createPortalClient({ source: 'supabase', supabase });
  await api.login({ UserName: 'employee.one@example.test', Password: 'test-only' });
  await assert.rejects(api.profile(), error => error.code === 'PGRST202'
    && /adapter migration/.test(error.message) && !/Raw database/.test(error.message));
  await assert.rejects(api.processingBalanceFixture({ action: 'get', applicationId: application.Id, asAt: '2027-01-10', pageIndex: 0 }),
    error => error.code === 'PGRST202' && /approver balance fixture migration/.test(error.message));
});
