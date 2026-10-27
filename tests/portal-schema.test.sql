-- Run as the SQL operator in the synthetic development project after seed.sql.
begin;
delete from public.leave_application_mirror where erp_id not in
  ('30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002');
do $$
declare
  first_user uuid;
  second_user uuid;
  response jsonb;
  saved_id uuid;
  body jsonb := '{"leaveTypeId":"20000000-0000-4000-8000-000000000001","start":"2027-01-11","end":"2027-01-13","reason":"SQL fixture test"}';
begin
  select "AuthUserId" into first_user from public.employee_mirror where "Id" = '10000000-0000-4000-8000-000000000001';
  select "AuthUserId" into second_user from public.employee_mirror where "Id" = '10000000-0000-4000-8000-000000000002';
  assert first_user is not null and second_user is not null, 'Run seed.sql first';
  assert not has_table_privilege('authenticated','public.leave_application_mirror','UPDATE'), 'Direct update must be denied';
  assert not has_table_privilege('anon','public.employee_mirror','SELECT'), 'Anonymous profiles must be denied';
  assert not has_function_privilege('anon','public.portal_dev_request(text,jsonb)','EXECUTE'), 'Anonymous RPC must be denied';
  perform set_config('request.jwt.claim.sub', '', true);
  assert (public.portal_dev_request('profile')->>'status')::integer = 401;
  perform set_config('request.jwt.claim.sub', first_user::text, true);
  response := public.portal_dev_request('profile');
  assert response #>> '{data,Id}' = '10000000-0000-4000-8000-000000000001';
  assert not ((response->'data') ? 'auth_user_id');
  assert (public.portal_dev_request('applications','{"pageIndex":-1}')->>'status')::integer = 400;
  response := public.portal_dev_request('balances','{"leaveTypeId":"20000000-0000-4000-8000-000000000001","asAt":"2027-01-10"}');
  assert (response #>> '{data,Balance,Available}')::integer = 18;
  response := public.portal_dev_request('submitLeave',body || '{"EmployeeId":"10000000-0000-4000-8000-000000000002","status":2}');
  assert (response->>'success')::boolean, response::text;
  assert response #>> '{data,EmployeeId}' = '10000000-0000-4000-8000-000000000001';
  assert (response #>> '{data,Status}')::integer = 1;
  assert response #>> '{data,StatusDescription}' = 'Pending';
  assert (public.portal_dev_request('authorize',body)->>'status')::integer = 400, 'No employee approval operation is exposed';
  saved_id := (response #>> '{data,Id}')::uuid;
  assert (public.portal_dev_request('submitLeave',body)->>'status')::integer = 400, 'Overlap must be blocked';
  response := public.portal_dev_request('preview', body || jsonb_build_object('excludedId',saved_id));
  assert (response #>> '{data,CanSubmit}')::boolean, 'Own edit preview must exclude itself';
  response := public.portal_dev_request('updateLeave', body || jsonb_build_object('id',saved_id,'start','2027-01-18','end','2027-01-19'));
  assert (response->>'success')::boolean, response::text;
  perform set_config('request.jwt.claim.sub', second_user::text, true);
  assert (public.portal_dev_request('application',jsonb_build_object('id',saved_id))->>'status')::integer = 404;
  assert (public.portal_dev_request('withdraw',jsonb_build_object('id',saved_id))->>'status')::integer = 404;
  assert (public.portal_dev_request('updateLeave',body || jsonb_build_object('id',saved_id))->>'status')::integer = 404;
  assert (public.portal_dev_request('preview',body || jsonb_build_object('excludedId',saved_id))->>'status')::integer = 403;
  response := public.portal_dev_request('applications');
  assert (response #>> '{data,TotalCount}')::integer = 1, 'Second user must see only their seeded application';
  perform set_config('request.jwt.claim.sub', first_user::text, true);
  response := public.portal_dev_request('withdraw',jsonb_build_object('id',saved_id));
  assert (response #>> '{data,Status}')::integer = 16;
  assert (public.portal_dev_request('updateLeave',body || jsonb_build_object('id',saved_id))->>'status')::integer = 400;
  response := public.portal_dev_request('preview',body || '{"start":"2027-05-01","end":"2027-05-02"}');
  assert (response #>> '{data,CanSubmit}')::boolean, 'A missing preview fixture does not block requests';
  assert not (response #>> '{data,PreviewAvailable}')::boolean, 'Unknown dates have no calculated preview';
  assert (public.portal_dev_request('submitLeave',body || '{"reason":""}')->>'status')::integer = 400;
  assert (public.portal_dev_request('application','{"id":"not-a-guid"}')->>'status')::integer = 404;
  update public.employee_mirror set "IsLocked" = true where "AuthUserId" = first_user;
  assert (public.portal_dev_request('profile')->>'status')::integer = 403;
end $$;
rollback;
