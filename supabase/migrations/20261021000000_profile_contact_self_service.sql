-- Contact-only counterpart of PUT /api/hr-portal/me. Apply after the mirror adapter.
-- Also replaces the earlier feature-branch function that allowed name edits.
begin;
create or replace function public.portal_dev_update_profile(changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare employee_id uuid; locked boolean; field text;
  email text := nullif(btrim(changes->>'CustomerAddressEmail'),'');
  mobile text := nullif(btrim(changes->>'CustomerAddressMobileLine'),'');
begin
  if auth.uid() is null then
    return jsonb_build_object('success',false,'status',401,'message','Sign in to continue.','error',jsonb_build_object('code','AUTHENTICATION_REQUIRED'));
  end if;
  select "Id","IsLocked" into employee_id,locked from public.employee_mirror where "AuthUserId"=auth.uid() for update;
  if not found or locked then
    return jsonb_build_object('success',false,'status',403,'message','Your account must be linked to an active employee.','error',jsonb_build_object('code','HR_PORTAL_ACCESS_DENIED'));
  end if;
  if changes is null or jsonb_typeof(changes)<>'object' or changes='{}'::jsonb then
    return jsonb_build_object('success',false,'status',400,'message','Provide email and/or mobile.','error',jsonb_build_object('code','PROFILE_VALIDATION_FAILED'));
  end if;
  for field in select jsonb_object_keys(changes) loop
    if field not in ('CustomerAddressEmail','CustomerAddressMobileLine') or jsonb_typeof(changes->field) not in ('string','null') then
      return jsonb_build_object('success',false,'status',400,'message','Provide email and/or mobile as strings or null. Other details are HR-controlled.','error',jsonb_build_object('code','PROFILE_VALIDATION_FAILED'));
    end if;
  end loop;
  if email is not null and (length(email)>254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    return jsonb_build_object('success',false,'status',400,'message','Enter a valid email address of at most 254 characters.','error',jsonb_build_object('code','PROFILE_VALIDATION_FAILED'));
  end if;
  if mobile is not null and mobile !~ '^\+?[0-9 ()-]{7,20}$' then
    return jsonb_build_object('success',false,'status',400,'message','Enter a valid mobile number, using digits and an optional leading +.','error',jsonb_build_object('code','PROFILE_VALIDATION_FAILED'));
  end if;
  update public.employee_mirror set
    "CustomerAddressEmail"=case when changes ? 'CustomerAddressEmail' then email else "CustomerAddressEmail" end,
    "CustomerAddressMobileLine"=case when changes ? 'CustomerAddressMobileLine' then mobile else "CustomerAddressMobileLine" end
  where "Id"=employee_id;
  return public.portal_dev_request('profile');
end $$;
revoke all on function public.portal_dev_update_profile(jsonb) from public,anon;
grant execute on function public.portal_dev_update_profile(jsonb) to authenticated;
commit;
