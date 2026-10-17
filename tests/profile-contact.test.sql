-- Synthetic development database only. Changes roll back.
begin;
do $$
declare first_user uuid; second_user uuid; response jsonb; second_email text;
begin
  select "AuthUserId" into first_user from public.employee_mirror where "Id"='10000000-0000-4000-8000-000000000001';
  select "AuthUserId","CustomerAddressEmail" into second_user,second_email from public.employee_mirror where "Id"='10000000-0000-4000-8000-000000000002';
  assert first_user is not null and second_user is not null;
  assert not has_function_privilege('anon','public.portal_dev_update_profile(jsonb)','EXECUTE');
  perform set_config('request.jwt.claim.sub','',true);
  assert (public.portal_dev_update_profile('{"CustomerAddressEmail":"new@example.test"}')->>'status')::integer=401;
  perform set_config('request.jwt.claim.sub',first_user::text,true);
  response:=public.portal_dev_update_profile('{"CustomerAddressEmail":" contact@example.test ","CustomerAddressMobileLine":" +254 700 123456 "}');
  assert (response->>'success')::boolean,response::text;
  assert response#>>'{data,CustomerAddressEmail}'='contact@example.test';
  assert response#>>'{data,CustomerAddressMobileLine}'='+254 700 123456';
  assert (select "CustomerAddressEmail" from public.employee_mirror where "AuthUserId"=second_user) is not distinct from second_email;
  assert (select email from auth.users where id=first_user)='employee.one@example.test','Contact email must not alter login identity';
  assert (public.portal_dev_update_profile('{"Id":"10000000-0000-4000-8000-000000000002","CustomerAddressEmail":"foreign@example.test"}')->>'status')::integer=400;
  assert (public.portal_dev_update_profile('{"CustomerFullName":"Changed"}')->>'status')::integer=400;
  assert (public.portal_dev_update_profile('{"CustomerAddressEmail":123}')->>'status')::integer=400;
  assert (public.portal_dev_update_profile('{"CustomerAddressEmail":"bad"}')->>'status')::integer=400;
  assert (public.portal_dev_update_profile('{"CustomerAddressMobileLine":"letters"}')->>'status')::integer=400;
  assert (public.portal_dev_update_profile('{}')->>'status')::integer=400;
  response:=public.portal_dev_update_profile('{"CustomerAddressEmail":null}');
  assert response#>'{data,CustomerAddressEmail}'='null'::jsonb;
  assert response#>>'{data,CustomerAddressMobileLine}'='+254 700 123456','Omitted fields must be preserved';
  update public.employee_mirror set "IsLocked"=true where "AuthUserId"=first_user;
  assert (public.portal_dev_update_profile('{"CustomerAddressMobileLine":null}')->>'status')::integer=403;
end $$;
rollback;
