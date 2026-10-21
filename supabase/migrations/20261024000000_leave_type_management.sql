-- Approver-managed synthetic leave types and explicit all-employee balances.
-- Existing leave type, application and balance rows are retained.
begin;

-- Hide only the exact lowercase duplicate from employee selections. Keep the
-- type and all related history/fixtures intact; retain "Annual leave".
delete from public.portal_mirror_eligibility e
using public.leave_types_mirror t
where e.leave_type_id = t.erp_id
  and t.description = 'annual leave';

insert into public.leave_types_mirror(erp_id, description, source_payload)
values
  ('24000000-0000-4000-8000-000000000001', 'compassionate leave', '{}'::jsonb),
  ('24000000-0000-4000-8000-000000000002', 'maternity leave', '{}'::jsonb),
  ('24000000-0000-4000-8000-000000000003', 'paternity leave', '{}'::jsonb)
on conflict (erp_id) do nothing;

insert into public.portal_mirror_eligibility(employee_id, leave_type_id)
select e."Id"::text, t.erp_id
from public.employee_mirror e
cross join public.leave_types_mirror t
where not e."IsLocked"
  and t.erp_id in (
    '24000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000002',
    '24000000-0000-4000-8000-000000000003'
  )
on conflict do nothing;

create or replace function public.portal_dev_create_leave_type_with_fixtures(args jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor portal_mirror_private.employees;
  type_id text;
  type_description text;
  entitlement numeric;
  used_days numeric;
  reserved_days numeric;
  available_days numeric;
  as_at_date date;
  cycle_start date;
  cycle_end date;
  employee_count integer;
  fixture_count integer;
  existing_type boolean := false;
  type_payload jsonb;
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
    return jsonb_build_object('success', false, 'status', 403, 'message', 'Your role cannot manage leave types.',
      'error', jsonb_build_object('code', 'HR_PORTAL_ACCESS_DENIED'));
  end if;

  type_description := btrim(args->>'Description');
  if type_description is null or length(type_description) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Leave type name must contain 1 to 100 characters.';
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

  -- Serialize names so concurrent approver submissions cannot create duplicates.
  lock table public.leave_types_mirror in share row exclusive mode;
  type_payload := jsonb_build_object(
    'Entitlement', entitlement,
    'IsAccrued', (args->>'IsAccrued')::boolean,
    'UnitType', (args->>'UnitType')::integer,
    'UnitTypeDescription', btrim(args->>'UnitTypeDescription'),
    'ExcludeHolidays', (args->>'ExcludeHolidays')::boolean,
    'ExcludeWeekends', (args->>'ExcludeWeekends')::boolean
  );
  select t.erp_id into type_id
  from public.leave_types_mirror t
  where lower(btrim(t.description)) = lower(type_description)
  for update;
  if found then
    if type_id not in (
      '24000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000002',
      '24000000-0000-4000-8000-000000000003'
    ) or (select description from public.leave_types_mirror where erp_id = type_id) <> type_description then
      raise exception using errcode = '22023', message = 'A leave type with this name already exists.';
    end if;
    existing_type := true;
    if exists (
      select 1 from public.portal_mirror_balance_fixtures
      where leave_type_id = type_id and as_at = as_at_date and page_index = 0
    ) then
      raise exception using errcode = '22023', message = 'A balance fixture already exists for that as-at date. Choose another date to preserve it.';
    end if;
    update public.leave_types_mirror
    set source_payload = type_payload, synced_at = now()
    where erp_id = type_id;
  else
    type_id := gen_random_uuid()::text;
    insert into public.leave_types_mirror(erp_id, description, source_payload)
    values(type_id, type_description, type_payload);
  end if;

  fixture_payload := jsonb_build_object(
    'AsAt', as_at_date,
    'Today', as_at_date,
    'LeaveTypeDescription', type_description,
    'IsAccrued', (args->>'IsAccrued')::boolean,
    'Balance', jsonb_build_object(
      'Start', cycle_start,
      'End', cycle_end,
      'Entitlement', entitlement,
      'Used', used_days,
      'Reserved', reserved_days,
      'Available', available_days,
      'Requested', 0,
      'Remaining', available_days
    ),
    'BalanceError', null,
    'TakenDays', used_days,
    'UpcomingDays', 0,
    'HistoryCount', 0,
    'History', '[]'::jsonb
  );
  insert into public.portal_mirror_eligibility(employee_id, leave_type_id)
  select e."Id"::text, type_id
  from public.employee_mirror e
  where not e."IsLocked"
  on conflict do nothing;
  select count(*) into employee_count from public.employee_mirror where not "IsLocked";
  if employee_count = 0 then
    raise exception using errcode = '22023', message = 'No unlocked employee records are available for leave type eligibility.';
  end if;
  insert into public.portal_mirror_balance_fixtures(employee_id, leave_type_id, as_at, page_index, payload)
  select e."Id"::text, type_id, as_at_date, 0, fixture_payload
  from public.employee_mirror e
  where not e."IsLocked";
  get diagnostics fixture_count = row_count;
  if fixture_count <> employee_count then
    raise exception using errcode = '22023', message = 'Not every unlocked employee received a balance fixture.';
  end if;

  return jsonb_build_object('success', true,
    'message', case when existing_type then 'Leave type balance fixtures configured.' else 'Leave type and balance fixtures created.' end,
    'data', jsonb_build_object('Id', type_id, 'Description', type_description, 'EmployeeCount', fixture_count, 'AsAt', as_at_date));
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
  or invalid_parameter_value or numeric_value_out_of_range then
  return jsonb_build_object('success', false, 'status', 400,
    'message', case when sqlstate = '22023' then sqlerrm else 'Check the leave type and balance field formats.' end,
    'error', jsonb_build_object('code', 'LEAVE_VALIDATION_FAILED'));
end;
$$;

revoke all on function public.portal_dev_create_leave_type_with_fixtures(jsonb) from public, anon;
grant execute on function public.portal_dev_create_leave_type_with_fixtures(jsonb) to authenticated;

commit;
