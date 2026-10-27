-- Operator-only development test. All writes are rolled back.
begin;
do $$
declare
  employee_user uuid;
  approver_user uuid;
  response jsonb;
  created_type text;
  employee_count integer;
begin
  select "AuthUserId" into employee_user
  from public.employee_mirror where "Id" = '10000000-0000-4000-8000-000000000001';
  select "AuthUserId" into approver_user
  from public.employee_mirror where "Id" = '10000000-0000-4000-8000-000000000002';
  assert employee_user is not null and approver_user is not null;
  assert exists(select 1 from public.leave_types_mirror where description = 'Annual leave'),
    'The capitalized Annual leave row must be retained';
  assert not exists (
    select 1 from public.portal_mirror_eligibility e
    join public.leave_types_mirror t on t.erp_id = e.leave_type_id
    where t.description = 'annual leave'
  ), 'The lowercase duplicate must not be offered to employees';
  assert (
    select count(*) from public.leave_types_mirror
    where description in ('compassionate leave', 'maternity leave', 'paternity leave')
  ) = 3, 'All three requested leave types must be in the catalogue';
  assert (
    select count(*) from public.portal_mirror_eligibility e
    join public.leave_types_mirror t on t.erp_id = e.leave_type_id
    where t.description in ('compassionate leave', 'maternity leave', 'paternity leave')
  ) = 3 * (select count(*) from public.employee_mirror where not "IsLocked"),
    'Every unlocked employee must be eligible for all three new types';
  assert not exists (
    select 1
    from public.portal_mirror_eligibility e
    join public.leave_types_mirror t on t.erp_id = e.leave_type_id
    where lower(btrim(t.description)) in (
      'compassionate leave', 'maternity leave', 'paternity leave', 'annual leave'
    )
    group by e.employee_id, lower(btrim(t.description))
    having count(*) > 1
  ), 'Employees must not receive duplicate case-insensitive leave types';

  delete from public.portal_mirror_processing_permissions
  where employee_id = '10000000-0000-4000-8000-000000000001' and permission = 22017;
  perform set_config('request.jwt.claim.sub', employee_user::text, true);
  response := public.portal_dev_create_leave_type(jsonb_build_object('Description', 'Settings test leave'));
  assert (response->>'status')::integer = 403, 'Employees without approver permission cannot manage types';

  insert into public.portal_mirror_processing_permissions(employee_id, permission)
  values ('10000000-0000-4000-8000-000000000002', 22017)
  on conflict do nothing;
  perform set_config('request.jwt.claim.sub', approver_user::text, true);
  response := public.portal_dev_create_leave_type(jsonb_build_object('Description', 'Settings test leave'));
  assert (response->>'success')::boolean, response::text;
  created_type := response#>>'{data,Id}';
  employee_count := (response#>>'{data,EmployeeCount}')::integer;
  assert employee_count = (select count(*) from public.employee_mirror where not "IsLocked");
  assert (select count(*) from public.portal_mirror_eligibility where leave_type_id = created_type) = employee_count;
  assert (select source_payload ? 'Entitlement' from public.leave_types_mirror where erp_id = created_type) = false,
    'Creating a type must not create its balance metadata';

  response := public.portal_dev_create_leave_type(jsonb_build_object('Description', 'settings TEST leave'));
  assert (response->>'status')::integer = 400, 'Settings must reject duplicate case-insensitive names';
  assert (select count(*) from public.leave_types_mirror where lower(description) = 'settings test leave') = 1,
    'Duplicate creation must not add another type';

  response := public.portal_dev_configure_leave_type_balance(jsonb_build_object(
    'LeaveTypeId', created_type, 'Entitlement', 5, 'IsAccrued', false,
    'UnitType', 3, 'UnitTypeDescription', 'Yearly', 'ExcludeHolidays', true, 'ExcludeWeekends', true,
    'AsAt', '2999-01-02', 'CycleStart', '2999-01-01', 'CycleEnd', '2999-12-31',
    'Used', 1, 'Reserved', 1, 'Available', 3
  ));
  assert (response->>'success')::boolean, response::text;
  assert response#>>'{data,Id}' = created_type, 'Balance setup must configure the selected existing type';
  assert (select count(*) from public.leave_types_mirror where lower(description) = 'settings test leave') = 1,
    'Balance setup must not create another leave type';
  assert (select source_payload->>'Entitlement' from public.leave_types_mirror where erp_id = created_type) = '5';
  assert (select count(*) from public.portal_mirror_balance_fixtures
    where leave_type_id = created_type and as_at = '2999-01-02' and page_index = 0) = employee_count;
  assert (select payload#>>'{Balance,Start}' from public.portal_mirror_balance_fixtures
    where leave_type_id = created_type and employee_id = '10000000-0000-4000-8000-000000000001'
      and as_at = '2999-01-02' and page_index = 0) = '2999-01-01';
  update public.portal_mirror_balance_fixtures
  set payload = jsonb_set(payload, '{History}', '[{"Id":"preserved-history"}]'::jsonb)
  where leave_type_id = created_type and employee_id = '10000000-0000-4000-8000-000000000001'
    and as_at = '2999-01-02' and page_index = 0;
  response := public.portal_dev_configure_leave_type_balance(jsonb_build_object(
    'LeaveTypeId', created_type, 'Entitlement', 6, 'IsAccrued', true,
    'UnitType', 3, 'UnitTypeDescription', 'Yearly', 'ExcludeHolidays', false, 'ExcludeWeekends', true,
    'AsAt', '2999-01-02', 'CycleStart', '2999-01-01', 'CycleEnd', '2999-12-31',
    'Used', 2, 'Reserved', 1, 'Available', 3
  ));
  assert (response->>'success')::boolean, response::text;
  assert (select count(*) from public.portal_mirror_balance_fixtures
    where leave_type_id = created_type and as_at = '2999-01-02' and page_index = 0) = employee_count,
    'Editing the same as-at date must update fixtures instead of rejecting them';
  assert (select payload#>>'{Balance,Available}' from public.portal_mirror_balance_fixtures
    where leave_type_id = created_type and employee_id = '10000000-0000-4000-8000-000000000001'
      and as_at = '2999-01-02' and page_index = 0) = '3';
  assert (select payload#>>'{History,0,Id}' from public.portal_mirror_balance_fixtures
    where leave_type_id = created_type and employee_id = '10000000-0000-4000-8000-000000000001'
      and as_at = '2999-01-02' and page_index = 0) = 'preserved-history',
    'Editing balance values must preserve existing fixture history';

  response := public.portal_dev_manage_leave_type(jsonb_build_object('action', 'list'));
  assert (response->>'success')::boolean, response::text;
  assert exists(select 1 from jsonb_array_elements(response#>'{data,Types}') t where t->>'Id' = created_type);
  response := public.portal_dev_manage_leave_type(jsonb_build_object(
    'action', 'update', 'LeaveTypeId', created_type, 'Description', 'Settings renamed leave'
  ));
  assert (response->>'success')::boolean, response::text;
  assert (select description from public.leave_types_mirror where erp_id = created_type) = 'Settings renamed leave';
  response := public.portal_dev_manage_leave_type(jsonb_build_object('action', 'archive', 'LeaveTypeId', created_type));
  assert (response->>'success')::boolean, response::text;
  assert (select source_payload->>'PortalArchived' from public.leave_types_mirror where erp_id = created_type) = 'true';
  assert not exists(select 1 from public.portal_mirror_eligibility where leave_type_id = created_type),
    'Archiving must remove eligibility without deleting history or fixtures';
  assert exists(select 1 from public.portal_mirror_balance_fixtures where leave_type_id = created_type),
    'Archiving must preserve balance fixtures';
  response := public.portal_dev_manage_leave_type(jsonb_build_object('action', 'restore', 'LeaveTypeId', created_type));
  assert (response->>'success')::boolean, response::text;
  assert (select source_payload ? 'PortalArchived' from public.leave_types_mirror where erp_id = created_type) = false;
  assert (select count(*) from public.portal_mirror_eligibility where leave_type_id = created_type) = employee_count;

  response := public.portal_dev_configure_leave_type_balance(jsonb_build_object(
    'LeaveTypeId', '24000000-0000-4000-8000-000000000001',
    'Entitlement', 5, 'IsAccrued', false, 'UnitType', 3, 'UnitTypeDescription', 'Yearly',
    'ExcludeHolidays', true, 'ExcludeWeekends', true,
    'AsAt', '2998-01-02', 'CycleStart', '2998-01-01', 'CycleEnd', '2998-12-31',
    'Used', 0, 'Reserved', 0, 'Available', 5
  ));
  assert (response->>'success')::boolean, response::text;
  assert response#>>'{data,Id}' = '24000000-0000-4000-8000-000000000001',
    'An existing catalogue type must be configured by ID, not re-created';
  assert (select count(*) from public.leave_types_mirror where lower(description) = 'compassionate leave') = 1,
    'Configuring the existing type must not add a duplicate';
  assert (select source_payload->>'Entitlement' from public.leave_types_mirror
    where erp_id = '24000000-0000-4000-8000-000000000001') = '5';
  assert (select count(*) from public.portal_mirror_balance_fixtures
    where leave_type_id = '24000000-0000-4000-8000-000000000001'
      and as_at = '2998-01-02' and page_index = 0) = employee_count;

  perform set_config('request.jwt.claim.sub', employee_user::text, true);
  response := public.portal_dev_configure_leave_type_balance(jsonb_build_object(
    'LeaveTypeId', created_type, 'Entitlement', 5, 'IsAccrued', false,
    'UnitType', 3, 'UnitTypeDescription', 'Yearly',
    'ExcludeHolidays', true, 'ExcludeWeekends', true,
    'AsAt', '2997-01-02', 'CycleStart', '2997-01-01', 'CycleEnd', '2997-12-31',
    'Used', 0, 'Reserved', 0, 'Available', 5
  ));
  assert (response->>'status')::integer = 403, 'Employees cannot configure balance fixtures';
  response := public.portal_dev_request('leaveTypes', '{}');
  assert exists(select 1 from jsonb_array_elements(response#>'{data}') t where t->>'Description' = 'Annual leave');
  assert exists(select 1 from jsonb_array_elements(response#>'{data}') t where t->>'Id' = created_type);
  assert not exists(select 1 from jsonb_array_elements(response#>'{data}') t where t->>'Description' = 'annual leave');
  response := public.portal_dev_request('balances', jsonb_build_object(
    'leaveTypeId', created_type, 'asAt', '2999-01-02', 'pageIndex', 0
  ));
  assert (response#>>'{data,Balance,Available}')::numeric = 3, response::text;
end;
$$;
rollback;
