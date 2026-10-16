-- Development employee self-service: the signed-in employee can update their own name and contact details.
-- Apply after 20261018000000_existing_mirror_adapter.sql. Run as SQL operator in a synthetic development project.
-- Identity comes from auth.uid(); the browser never supplies an employee ID. Only the four allowlisted fields
-- can change; payroll, statutory and employment details stay HR-controlled. The ERP has no equivalent
-- endpoint yet, so this is the development side of the portalClient updateProfile contract only.
-- Safe to run more than once.
begin;
create or replace function public.portal_dev_update_profile(changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  allowed constant text[] := array['CustomerFullName', 'CustomerIndividualFirstName', 'CustomerAddressEmail', 'CustomerAddressMobileLine'];
  employee_id uuid;
  locked boolean;
  field text;
  full_name text := nullif(btrim(changes->>'CustomerFullName'), '');
  first_name text := nullif(btrim(changes->>'CustomerIndividualFirstName'), '');
  email text := nullif(btrim(changes->>'CustomerAddressEmail'), '');
  mobile text := nullif(btrim(changes->>'CustomerAddressMobileLine'), '');
  invalid text;
begin
  if changes is null or jsonb_typeof(changes) <> 'object' then
    return jsonb_build_object('success', false, 'status', 400, 'message', 'Profile changes must be an object.', 'error', jsonb_build_object('code', 'PROFILE_VALIDATION_FAILED'));
  end if;
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'status', 401, 'message', 'Sign in to continue.', 'error', jsonb_build_object('code', 'AUTHENTICATION_REQUIRED'));
  end if;
  -- Lock serializes this employee's writes, as portal_dev_request does.
  select "Id", "IsLocked" into employee_id, locked from public.employee_mirror where "AuthUserId" = auth.uid() for update;
  if not found or locked then
    return jsonb_build_object('success', false, 'status', 403, 'message', 'Your account must be linked to an active employee.', 'error', jsonb_build_object('code', 'HR_PORTAL_ACCESS_DENIED'));
  end if;

  for field in select jsonb_object_keys(changes) loop
    if not field = any(allowed) then
      invalid := 'This detail can only be changed by HR: ' || field || '.';
    elsif jsonb_typeof(changes->field) not in ('string', 'null') then
      invalid := 'Check the request field formats.';
    end if;
    exit when invalid is not null;
  end loop;
  if invalid is null and changes ? 'CustomerFullName' and full_name is null then invalid := 'Enter your full name.';
  elsif invalid is null and (length(full_name) > 200 or length(first_name) > 100) then invalid := 'Names must be at most 200 characters (first name 100).';
  elsif invalid is null and (length(email) > 254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then invalid := 'Enter a valid email address.';
  elsif invalid is null and mobile !~ '^\+?[0-9 ()-]{7,20}$' then invalid := 'Enter a valid mobile number, using digits and an optional leading +.';
  end if;
  if invalid is not null then
    return jsonb_build_object('success', false, 'status', 400, 'message', invalid, 'error', jsonb_build_object('code', 'PROFILE_VALIDATION_FAILED'));
  end if;

  -- Fields that were not sent keep their current values; a blank optional field is cleared.
  update public.employee_mirror set
    "CustomerFullName" = case when changes ? 'CustomerFullName' then full_name else "CustomerFullName" end,
    "CustomerIndividualFirstName" = case when changes ? 'CustomerIndividualFirstName' then first_name else "CustomerIndividualFirstName" end,
    "CustomerAddressEmail" = case when changes ? 'CustomerAddressEmail' then email else "CustomerAddressEmail" end,
    "CustomerAddressMobileLine" = case when changes ? 'CustomerAddressMobileLine' then mobile else "CustomerAddressMobileLine" end
  where "Id" = employee_id;

  -- Return the saved profile through the existing allowlisted profile operation.
  return public.portal_dev_request('profile');
end;
$$;
revoke all on function public.portal_dev_update_profile(jsonb) from public, anon;
grant execute on function public.portal_dev_update_profile(jsonb) to authenticated;
commit;
