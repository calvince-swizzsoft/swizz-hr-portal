-- Run as the SQL operator in the synthetic development project after seed.sql and
-- all integrated migrations including 20261021000000_profile_contact_self_service.sql.
-- All test writes are rolled back.
begin;
do $$
declare
  first_user uuid;
  second_user uuid;
  response jsonb;
  original_payroll text;
begin
  select "AuthUserId", "CustomerIndividualPayrollNumbers" into first_user, original_payroll
    from public.employee_mirror where "Id" = '10000000-0000-4000-8000-000000000001';
  select "AuthUserId" into second_user from public.employee_mirror where "Id" = '10000000-0000-4000-8000-000000000002';
  assert first_user is not null and second_user is not null, 'Run seed.sql first';
  assert not has_function_privilege('anon', 'public.portal_dev_update_profile(jsonb)', 'EXECUTE'), 'Anonymous profile edits must be denied';
  assert not has_table_privilege('authenticated', 'public.employee_mirror', 'UPDATE'), 'Direct profile updates must be denied';

  perform set_config('request.jwt.claim.sub', '', true);
  assert (public.portal_dev_update_profile('{"CustomerAddressEmail":"a@example.test"}')->>'status')::integer = 401;

  perform set_config('request.jwt.claim.sub', first_user::text, true);
  response := public.portal_dev_update_profile('{"CustomerAddressEmail":"edited@example.test","CustomerAddressMobileLine":""}');
  assert (response->>'success')::boolean, response::text;
  assert response #>> '{data,Id}' = '10000000-0000-4000-8000-000000000001';
  assert response #>> '{data,CustomerFullName}' = 'Test Employee One';
  assert response #>> '{data,CustomerAddressEmail}' = 'edited@example.test';
  assert response #> '{data,CustomerAddressMobileLine}' = 'null'::jsonb, 'Blank optional fields are cleared';
  assert not ((response->'data') ? 'AuthUserId');

  -- HR-controlled fields and identity cannot be changed, and nothing is saved when one is sent.
  response := public.portal_dev_update_profile('{"CustomerAddressEmail":"other@example.test","CustomerIndividualPayrollNumbers":"HACK"}');
  assert (response->>'status')::integer = 400 and response->>'message' like '%HR-controlled%', response::text;
  assert (public.portal_dev_update_profile('{"Id":"10000000-0000-4000-8000-000000000002"}')->>'status')::integer = 400;
  assert (select "CustomerAddressEmail" from public.employee_mirror where "AuthUserId" = first_user) = 'edited@example.test';
  assert (select "CustomerIndividualPayrollNumbers" from public.employee_mirror where "AuthUserId" = first_user) is not distinct from original_payroll;

  assert (public.portal_dev_update_profile('{"CustomerFullName":"   "}')->>'status')::integer = 400, 'Full name is required';
  assert (public.portal_dev_update_profile('{"CustomerAddressEmail":"not-an-email"}')->>'status')::integer = 400;
  assert (public.portal_dev_update_profile('{"CustomerAddressMobileLine":"call me"}')->>'status')::integer = 400;
  assert (public.portal_dev_update_profile('{"CustomerAddressEmail":42}')->>'status')::integer = 400;
  assert (public.portal_dev_update_profile('[]')->>'status')::integer = 400;

  -- The second employee only ever changes their own record.
  perform set_config('request.jwt.claim.sub', second_user::text, true);
  response := public.portal_dev_update_profile('{"CustomerAddressEmail":"second@example.test"}');
  assert response #>> '{data,Id}' = '10000000-0000-4000-8000-000000000002', response::text;
  assert (select "CustomerAddressEmail" from public.employee_mirror where "AuthUserId" = first_user) = 'edited@example.test';

  update public.employee_mirror set "IsLocked" = true where "AuthUserId" = second_user;
  assert (public.portal_dev_update_profile('{"CustomerAddressEmail":"locked@example.test"}')->>'status')::integer = 403;
end $$;
rollback;
