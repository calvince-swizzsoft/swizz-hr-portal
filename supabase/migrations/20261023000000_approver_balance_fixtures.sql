begin;

drop function if exists public.portal_dev_edit_balance_fixture(jsonb);

create or replace function public.portal_dev_processing_balance_fixture(args jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor portal_mirror_private.employees;
  application portal_mirror_private.applications;
  leave_type portal_mirror_private.leave_types;
  required_permission integer;
  type_id text;
  fixture_date date;
  cycle_start date;
  cycle_end date;
  page integer;
  fixture_payload jsonb;
begin
  if args is null or jsonb_typeof(args) <> 'object' then
    raise exception using errcode = '22023', message = 'Object arguments are required.';
  end if;
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'status', 401, 'message', 'Sign in to continue.', 'error', jsonb_build_object('code', 'AUTHENTICATION_REQUIRED'));
  end if;
  select * into actor from portal_mirror_private.employees where auth_user_id = auth.uid();
  if not found or actor.is_locked then
    return jsonb_build_object('success', false, 'status', 403, 'message', 'An active employee linkage is required.', 'error', jsonb_build_object('code', 'HR_PORTAL_ACCESS_DENIED'));
  end if;

  select * into application from portal_mirror_private.applications where id = args->>'applicationId' for update;
  if not found or application.status not in (1, 2)
    or portal_mirror_private.application_view(application) is null then
    return jsonb_build_object('success', false, 'status', 404, 'message', 'Leave application or its employee profile was not found.', 'error', jsonb_build_object('code', 'RESOURCE_NOT_FOUND'));
  end if;
  if application.employee_id = actor.id then
    return jsonb_build_object('success', false, 'status', 403, 'message', 'You cannot edit the balance fixture for your own leave application.', 'error', jsonb_build_object('code', 'HR_PORTAL_ACCESS_DENIED'));
  end if;
  required_permission := case when application.status = 1 then 22017 else 22018 end;
  if not exists (
    select 1 from public.portal_mirror_processing_permissions
    where employee_id = actor.id and permission = required_permission
  ) then
    return jsonb_build_object('success', false, 'status', 403, 'message', 'Your role cannot edit this leave balance fixture.', 'error', jsonb_build_object('code', 'HR_PORTAL_ACCESS_DENIED'));
  end if;

  type_id := application.leave_type_id;
  fixture_date := (args->>'asAt')::date;
  page := coalesce((args->>'pageIndex')::integer, 0);
  if fixture_date is null or page < 0 then
    raise exception using errcode = '22023', message = 'A balance date and nonnegative page index are required.';
  end if;
  if args->>'action' = 'get' then
    select payload into fixture_payload from public.portal_mirror_balance_fixtures
    where employee_id = application.employee_id and leave_type_id = type_id and as_at = fixture_date and page_index = page;
    return jsonb_build_object('success', true, 'message', 'Balance fixture loaded.', 'data', fixture_payload);
  elsif args->>'action' is distinct from 'save' then
    raise exception using errcode = '22023', message = 'Choose get or save for the balance fixture.';
  end if;

  if jsonb_typeof(args->'Entitlement') is distinct from 'number'
    or jsonb_typeof(args->'Used') is distinct from 'number'
    or jsonb_typeof(args->'Reserved') is distinct from 'number'
    or jsonb_typeof(args->'Available') is distinct from 'number' then
    raise exception using errcode = '22023', message = 'All balance values must be numbers.';
  end if;
  if (args->>'Entitlement')::numeric < 0 or (args->>'Used')::numeric < 0
    or (args->>'Reserved')::numeric < 0 or (args->>'Available')::numeric < 0 then
    raise exception using errcode = '22023', message = 'Balance values cannot be negative.';
  end if;
  select * into leave_type from portal_mirror_private.leave_types t
  where t.id = type_id and exists (
    select 1 from public.portal_mirror_eligibility e
    where e.employee_id = application.employee_id and e.leave_type_id = t.id
  );
  if not found then
    raise exception using errcode = '22023', message = 'The employee is not eligible for this leave type.';
  end if;

  select payload into fixture_payload from public.portal_mirror_balance_fixtures
  where employee_id = application.employee_id and leave_type_id = type_id and as_at = fixture_date and page_index = page
  for update;
  if found then
    if jsonb_typeof(fixture_payload->'Balance') is distinct from 'object' then
      return jsonb_build_object('success', false, 'status', 400, 'message', 'The existing balance fixture is incomplete and cannot be edited.', 'error', jsonb_build_object('code', 'LEAVE_VALIDATION_FAILED'));
    end if;
    update public.portal_mirror_balance_fixtures
    set payload = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(fixture_payload, '{Balance,Entitlement}', args->'Entitlement'),
            '{Balance,Used}', args->'Used'
          ),
          '{Balance,Reserved}', args->'Reserved'
        ),
        '{Balance,Available}', args->'Available'
      ),
      '{Balance,Remaining}', args->'Available'
    ) || jsonb_build_object('TakenDays', args->'Used')
    where employee_id = application.employee_id and leave_type_id = type_id and as_at = fixture_date and page_index = page
    returning payload into fixture_payload;
  else
    cycle_start := (args->>'CycleStart')::date;
    cycle_end := (args->>'CycleEnd')::date;
    if cycle_start is null or cycle_end is null or cycle_end < cycle_start
      or fixture_date < cycle_start or fixture_date > cycle_end then
      raise exception using errcode = '22023', message = 'Provide a valid cycle containing the as-at date.';
    end if;
    if leave_type.payload->>'Description' is null
      or jsonb_typeof(leave_type.payload->'IsAccrued') is distinct from 'boolean' then
      raise exception using errcode = '22023', message = 'The selected leave type is missing fixture metadata.';
    end if;
    fixture_payload := jsonb_build_object(
      'AsAt', fixture_date,
      'Today', fixture_date,
      'LeaveTypeDescription', leave_type.payload->>'Description',
      'IsAccrued', leave_type.payload->'IsAccrued',
      'Balance', jsonb_build_object(
        'Start', cycle_start,
        'End', cycle_end,
        'Entitlement', args->'Entitlement',
        'Used', args->'Used',
        'Reserved', args->'Reserved',
        'Available', args->'Available',
        'Requested', 0,
        'Remaining', args->'Available'
      ),
      'BalanceError', null,
      'TakenDays', args->'Used',
      'UpcomingDays', 0,
      'HistoryCount', 0,
      'History', '[]'::jsonb
    );
    insert into public.portal_mirror_balance_fixtures(employee_id, leave_type_id, as_at, page_index, payload)
    values(application.employee_id, type_id, fixture_date, page, fixture_payload);
  end if;

  return jsonb_build_object('success', true, 'message', 'Balance fixture saved.', 'data', fixture_payload);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or invalid_parameter_value or numeric_value_out_of_range then
  return jsonb_build_object('success', false, 'status', 400, 'message', case when sqlstate = '22023' then sqlerrm else 'Check the balance fixture field formats.' end, 'error', jsonb_build_object('code', 'LEAVE_VALIDATION_FAILED'));
end;
$$;

revoke all on function public.portal_dev_processing_balance_fixture(jsonb) from public, anon;
grant execute on function public.portal_dev_processing_balance_fixture(jsonb) to authenticated;

commit;
