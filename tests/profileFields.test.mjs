import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortalClient } from '../src/lib/portalClient.js';
import { pickProfileChanges } from '../src/lib/profileFields.js';

test('contact updates accept only nonempty email/mobile objects and nullable strings', () => {
  assert.deepEqual(pickProfileChanges({ CustomerAddressEmail:null }),{ CustomerAddressEmail:null });
  for (const input of [null, [], {}, { Id:'forged' }, { CustomerFullName:'Changed' }, { CustomerAddressMobileLine:123 }]) {
    assert.throws(()=>pickProfileChanges(input),/HR-controlled/);
  }
});
test('ERP sends contact updates to the authenticated own-profile endpoint', async () => {
  const calls=[];
  const api=createPortalClient({ source:'erp',fetchImpl:async (...args)=>{calls.push(args);return Response.json({success:true,data:{Id:'self',CustomerAddressEmail:'new@example.test'}});} });
  api.setToken('memory-token');
  assert.equal(api.canEditProfile,true);
  const result=await api.updateProfile({CustomerAddressEmail:'new@example.test'});
  assert.equal(result.Id,'self'); assert.equal(calls[0][0],'/api/hr-portal/me');
  assert.equal(calls[0][1].method,'PUT'); assert.equal(calls[0][1].headers.Authorization,'Bearer memory-token');
  assert.deepEqual(JSON.parse(calls[0][1].body),{CustomerAddressEmail:'new@example.test'});
  await assert.rejects(api.updateProfile({CustomerFullName:'Changed'}),e=>e.status===400);
  assert.equal(calls.length,1);
});
test('Supabase sends the same update body to its contact-only RPC', async () => {
  const calls=[];
  const supabase={auth:{signInWithPassword:async()=>({data:{user:{email:'employee.one@example.test'},session:{access_token:'test',expires_at:Math.floor(Date.now()/1000)+3600}}})},
    rpc:async(name,args)=>{calls.push([name,args]);return {data:{success:true,data:{Id:'self',CustomerAddressMobileLine:null}}};}};
  const api=createPortalClient({source:'supabase',supabase});
  await api.login({UserName:'employee.one@example.test',Password:'test-only'});
  assert.equal(api.canEditProfile,true);
  assert.equal((await api.updateProfile({CustomerAddressMobileLine:null})).Id,'self');
  assert.deepEqual(calls,[['portal_dev_update_profile',{changes:{CustomerAddressMobileLine:null}}]]);
  await assert.rejects(api.updateProfile({EmployeeId:'foreign'}),e=>e.status===400);
  assert.equal(calls.length,1);
});
