begin;

create or replace function public.portal_dev_edit_balance_fixture(args jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  employee portal_mirror_private.employees;
  type_id text;
  fixture_date date;
  page integer;
  fixture_payload jsonb;
begin
  if args is null or jsonb_typeof(args) <> 'object' then
    raise exception using errcode = '22023', message = 'Object arguments are required.';
  end if;
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'status', 401, 'message', 'Sign in to continue.', 'error', jsonb_build_object('code', 'AUTHENTICATION_REQUIRED'));
  end if;
  select * into employee from portal_mirror_private.employees where auth_user_id = auth.uid() for update;
  if not found or employee.is_locked then
    return jsonb_build_object('success', false, 'status', 403, 'message', 'Your account must be linked to an active employee.', 'error', jsonb_build_object('code', 'HR_PORTAL_ACCESS_DENIED'));
  end if;

  type_id := args->>'leaveTypeId';
  fixture_date := (args->>'asAt')::date;
  page := (args->>'pageIndex')::integer;
  if type_id is null or fixture_date is null or page is null or page < 0 then
    raise exception using errcode = '22023', message = 'A leave type, fixture date and nonnegative page index are required.';
  end if;
  if not exists (
    select 1 from public.portal_mirror_eligibility
    where employee_id = employee.id and leave_type_id = type_id
  ) then
    raise exception using errcode = '22023', message = 'Select an eligible leave type.';
  end if;
  if not (
    jsonb_typeof(args->'Entitlement') = 'number'
    and jsonb_typeof(args->'Used') = 'number'
    and jsonb_typeof(args->'Reserved') = 'number'
    and jsonb_typeof(args->'Available') = 'number'
  ) then
    raise exception using errcode = '22023', message = 'All balance values must be numbers.';
  end if;
  if (args->>'Entitlement')::numeric < 0 or (args->>'Used')::numeric < 0
    or (args->>'Reserved')::numeric < 0 or (args->>'Available')::numeric < 0 then
    raise exception using errcode = '22023', message = 'Balance values cannot be negative.';
  end if;

  update public.portal_mirror_balance_fixtures
  set payload = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(payload, '{Balance,Entitlement}', args->'Entitlement'),
          '{Balance,Used}', args->'Used'
        ),
        '{Balance,Reserved}', args->'Reserved'
      ),
      '{Balance,Available}', args->'Available'
    ),
    '{Balance,Remaining}', args->'Available'
  ) || jsonb_build_object('TakenDays', args->'Used')
  where employee_id = employee.id and leave_type_id = type_id and as_at = fixture_date and page_index = page
    and jsonb_typeof(payload->'Balance') = 'object'
  returning payload into fixture_payload;
  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'message', 'No editable balance fixture matches this date and page.', 'error', jsonb_build_object('code', 'RESOURCE_NOT_FOUND'));
  end if;
  return jsonb_build_object('success', true, 'message', 'Balance fixture updated.', 'data', fixture_payload);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or invalid_parameter_value or numeric_value_out_of_range then
  return jsonb_build_object('success', false, 'status', 400, 'message', case when sqlstate = '22023' then sqlerrm else 'Check the balance fixture field formats.' end, 'error', jsonb_build_object('code', 'LEAVE_VALIDATION_FAILED'));
end;
$$;

revoke all on function public.portal_dev_edit_balance_fixture(jsonb) from public, anon;
grant execute on function public.portal_dev_edit_balance_fixture(jsonb) to authenticated;

commit;
