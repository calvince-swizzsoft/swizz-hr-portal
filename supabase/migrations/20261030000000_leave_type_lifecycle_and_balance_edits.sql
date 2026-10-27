-- Add reversible leave-type management and allow existing balance fixtures to be edited.
begin;

create or replace function public.portal_dev_manage_leave_type(args jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $manage_type$
declare
  actor portal_mirror_private.employees;
  action_name text;
  type_id text;
  requested_description text;
  current_description text;
  employee_count integer;
  result jsonb;
begin
  if args is null or jsonb_typeof(args) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Object arguments are required.';
  end if;
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'status', 401, 'message', 'Sign in to continue.',
      'error', jsonb_build_object('code', 'AUTHENTICATION_REQUIRED'));
  end if;
  select * into actor from portal_mirror_private.employees where auth_user_id = auth.uid();
  if not found or actor.is_locked then
    return jsonb_build_object('success', false, 'status', 403, 'message', 'An active employee linkage is required.',
      'error', jsonb_build_object('code', 'HR_PORTAL_ACCESS_DENIED'));
  end if;
  if not exists (
    select 1 from public.portal_mirror_processing_permissions
    where employee_id = actor.id and permission = 22017
  ) then
    return jsonb_build_object('success', false, 'status', 403, 'message', 'Your role cannot manage leave types.',
      'error', jsonb_build_object('code', 'HR_PORTAL_ACCESS_DENIED'));
  end if;

  action_name := args->>'action';
  if action_name = 'list' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'Id', t.erp_id,
      'Description', t.description,
      'Entitlement', t.source_payload->'Entitlement',
      'IsAccrued', t.source_payload->'IsAccrued',
      'UnitType', t.source_payload->'UnitType',
      'UnitTypeDescription', t.source_payload->'UnitTypeDescription',
      'ExcludeHolidays', t.source_payload->'ExcludeHolidays',
      'ExcludeWeekends', t.source_payload->'ExcludeWeekends',
      'Archived', coalesce(t.source_payload->>'PortalArchived' = 'true', false)
    ) order by lower(t.description), t.erp_id), '[]'::jsonb)
    into result from public.leave_types_mirror t;
    return jsonb_build_object('success', true, 'message', 'Leave types loaded.',
      'data', jsonb_build_object('Types', result));
  end if;

  type_id := nullif(args->>'LeaveTypeId', '');
  if type_id is null then
    raise exception using errcode = '22023', message = 'Select a leave type.';
  end if;
  select t.description into current_description
  from public.leave_types_mirror t
  where t.erp_id = type_id
  for update;
  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'message', 'Leave type not found.',
      'error', jsonb_build_object('code', 'RESOURCE_NOT_FOUND'));
  end if;

  if action_name = 'update' then
    requested_description := btrim(args->>'Description');
    if requested_description is null or length(requested_description) not between 1 and 100 then
      raise exception using errcode = '22023', message = 'Leave type name must contain 1 to 100 characters.';
    end if;
    lock table public.leave_types_mirror in share row exclusive mode;
    if exists (
      select 1 from public.leave_types_mirror t
      where t.erp_id <> type_id and lower(btrim(t.description)) = lower(requested_description)
    ) then
      raise exception using errcode = '22023', message = 'A leave type with this name already exists.';
    end if;
    update public.leave_types_mirror
    set description = requested_description, synced_at = now()
    where erp_id = type_id;
    update public.portal_mirror_balance_fixtures
    set payload = jsonb_set(payload, '{LeaveTypeDescription}', to_jsonb(requested_description), true)
    where leave_type_id = type_id;
    current_description := requested_description;
  elsif action_name = 'archive' then
    update public.leave_types_mirror
    set source_payload = coalesce(source_payload, '{}'::jsonb) || jsonb_build_object('PortalArchived', true),
        synced_at = now()
    where erp_id = type_id;
    delete from public.portal_mirror_eligibility where leave_type_id = type_id;
  elsif action_name = 'restore' then
    select count(*) into employee_count from public.employee_mirror where not "IsLocked";
    if employee_count = 0 then
      raise exception using errcode = '22023', message = 'No unlocked employee records are available.';
    end if;
    update public.leave_types_mirror
    set source_payload = coalesce(source_payload, '{}'::jsonb) - 'PortalArchived', synced_at = now()
    where erp_id = type_id;
    insert into public.portal_mirror_eligibility(employee_id, leave_type_id)
    select e."Id"::text, type_id from public.employee_mirror e where not e."IsLocked"
    on conflict do nothing;
  else
    raise exception using errcode = '22023', message = 'Choose list, update, archive or restore.';
  end if;

  return jsonb_build_object('success', true, 'message', 'Leave type updated.',
    'data', jsonb_build_object('Id', type_id, 'Description', current_description));
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
  or invalid_parameter_value or numeric_value_out_of_range then
  return jsonb_build_object('success', false, 'status', 400,
    'message', case when sqlstate = '22023' then sqlerrm else 'Check the leave type fields.' end,
    'error', jsonb_build_object('code', 'LEAVE_VALIDATION_FAILED'));
end;
$manage_type$;

create or replace function public.portal_dev_configure_leave_type_balance(args jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $balance_setup$
declare
  actor portal_mirror_private.employees;
  type_id text;
  type_description text;
  saved_payload jsonb;
  type_metadata jsonb;
  entitlement numeric;
  used_days numeric;
  reserved_days numeric;
  available_days numeric;
  as_at_date date;
  cycle_start date;
  cycle_end date;
  employee_count integer;
  fixture_count integer;
  fixture_payload jsonb;
begin
  if args is null or jsonb_typeof(args) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Object arguments are required.';
  end if;
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'status', 401, 'message', 'Sign in to continue.',
      'error', jsonb_build_object('code', 'AUTHENTICATION_REQUIRED'));
  end if;
  select * into actor from portal_mirror_private.employees where auth_user_id = auth.uid();
  if not found or actor.is_locked then
    return jsonb_build_object('success', false, 'status', 403, 'message', 'An active employee linkage is required.',
      'error', jsonb_build_object('code', 'HR_PORTAL_ACCESS_DENIED'));
  end if;
  if not exists (
    select 1 from public.portal_mirror_processing_permissions
    where employee_id = actor.id and permission = 22017
  ) then
    return jsonb_build_object('success', false, 'status', 403, 'message', 'Your role cannot manage leave balances.',
      'error', jsonb_build_object('code', 'HR_PORTAL_ACCESS_DENIED'));
  end if;

  type_id := args->>'LeaveTypeId';
  select t.description, coalesce(t.source_payload, '{}'::jsonb)
    into type_description, saved_payload
  from public.leave_types_mirror t
  where t.erp_id = type_id
  for update;
  if not found then
    return jsonb_build_object('success', false, 'status', 404, 'message', 'Select an existing leave type.',
      'error', jsonb_build_object('code', 'RESOURCE_NOT_FOUND'));
  end if;
  if saved_payload->>'PortalArchived' = 'true' then
    raise exception using errcode = '22023', message = 'Restore this leave type before editing its balance.';
  end if;
  if jsonb_typeof(args->'Entitlement') is distinct from 'number'
    or jsonb_typeof(args->'UnitType') is distinct from 'number'
    or jsonb_typeof(args->'IsAccrued') is distinct from 'boolean'
    or jsonb_typeof(args->'ExcludeHolidays') is distinct from 'boolean'
    or jsonb_typeof(args->'ExcludeWeekends') is distinct from 'boolean'
    or jsonb_typeof(args->'Used') is distinct from 'number'
    or jsonb_typeof(args->'Reserved') is distinct from 'number'
    or jsonb_typeof(args->'Available') is distinct from 'number' then
    raise exception using errcode = '22023', message = 'Leave metadata and balance values have invalid formats.';
  end if;
  entitlement := (args->>'Entitlement')::numeric;
  used_days := (args->>'Used')::numeric;
  reserved_days := (args->>'Reserved')::numeric;
  available_days := (args->>'Available')::numeric;
  if entitlement < 0 or used_days < 0 or reserved_days < 0 or available_days < 0
    or (args->>'UnitType')::numeric < 0 or (args->>'UnitType')::numeric <> trunc((args->>'UnitType')::numeric) then
    raise exception using errcode = '22023', message = 'Entitlement and balance values must be nonnegative; unit type must be a whole number.';
  end if;
  if nullif(btrim(args->>'UnitTypeDescription'), '') is null
    or length(btrim(args->>'UnitTypeDescription')) > 40 then
    raise exception using errcode = '22023', message = 'Enter a unit description of at most 40 characters.';
  end if;
  as_at_date := (args->>'AsAt')::date;
  cycle_start := (args->>'CycleStart')::date;
  cycle_end := (args->>'CycleEnd')::date;
  if cycle_start is null or cycle_end is null or as_at_date is null
    or cycle_end < cycle_start or as_at_date < cycle_start or as_at_date > cycle_end then
    raise exception using errcode = '22023', message = 'Choose a cycle range that includes the balance as-at date.';
  end if;

  select count(*) into employee_count from public.employee_mirror where not "IsLocked";
  if employee_count = 0 then
    raise exception using errcode = '22023', message = 'No unlocked employee records are available.';
  end if;
  type_metadata := jsonb_build_object(
    'Entitlement', entitlement,
    'IsAccrued', (args->>'IsAccrued')::boolean,
    'UnitType', (args->>'UnitType')::integer,
    'UnitTypeDescription', btrim(args->>'UnitTypeDescription'),
    'ExcludeHolidays', (args->>'ExcludeHolidays')::boolean,
    'ExcludeWeekends', (args->>'ExcludeWeekends')::boolean
  );
  update public.leave_types_mirror
  set source_payload = saved_payload || type_metadata, synced_at = now()
  where erp_id = type_id;

  fixture_payload := jsonb_build_object(
    'AsAt', as_at_date, 'Today', as_at_date,
    'LeaveTypeDescription', type_description,
    'IsAccrued', (args->>'IsAccrued')::boolean,
    'Balance', jsonb_build_object(
      'Start', cycle_start, 'End', cycle_end,
      'Entitlement', entitlement, 'Used', used_days,
      'Reserved', reserved_days, 'Available', available_days,
      'Requested', 0, 'Remaining', available_days
    ),
    'BalanceError', null, 'TakenDays', used_days, 'UpcomingDays', 0,
    'HistoryCount', 0, 'History', '[]'::jsonb
  );
  insert into public.portal_mirror_eligibility(employee_id, leave_type_id)
  select e."Id"::text, type_id from public.employee_mirror e where not e."IsLocked"
  on conflict do nothing;
  insert into public.portal_mirror_balance_fixtures as existing_fixture(employee_id, leave_type_id, as_at, page_index, payload)
  select e."Id"::text, type_id, as_at_date, 0, fixture_payload
  from public.employee_mirror e where not e."IsLocked"
  on conflict (employee_id, leave_type_id, as_at, page_index) do update
  set payload = (
    existing_fixture.payload
      || (excluded.payload - 'History' - 'HistoryCount')
  )
    || jsonb_build_object(
      'Balance',
      coalesce(existing_fixture.payload->'Balance', '{}'::jsonb)
        || (excluded.payload->'Balance' - 'Requested')
    )
    || case when existing_fixture.payload ? 'History'
      then jsonb_build_object('History', existing_fixture.payload->'History')
      else '{}'::jsonb end
    || case when existing_fixture.payload ? 'HistoryCount'
      then jsonb_build_object('HistoryCount', existing_fixture.payload->'HistoryCount')
      else '{}'::jsonb end;
  get diagnostics fixture_count = row_count;
  return jsonb_build_object('success', true, 'message', 'Leave type balance saved.',
    'data', jsonb_build_object('Id', type_id, 'Description', type_description,
      'EmployeeCount', fixture_count, 'AsAt', as_at_date));
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
  or invalid_parameter_value or numeric_value_out_of_range then
  return jsonb_build_object('success', false, 'status', 400,
    'message', case when sqlstate = '22023' then sqlerrm else 'Check the balance fixture field formats.' end,
    'error', jsonb_build_object('code', 'LEAVE_VALIDATION_FAILED'));
end;
$balance_setup$;

revoke all on function public.portal_dev_manage_leave_type(jsonb) from public, anon;
grant execute on function public.portal_dev_manage_leave_type(jsonb) to authenticated;
revoke all on function public.portal_dev_configure_leave_type_balance(jsonb) from public, anon;
grant execute on function public.portal_dev_configure_leave_type_balance(jsonb) to authenticated;

commit;
