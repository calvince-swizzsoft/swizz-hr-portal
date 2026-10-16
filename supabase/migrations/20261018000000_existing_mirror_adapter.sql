-- Development adapter for the existing mirror tables. No employee/leave copies.
-- Run as SQL operator in a synthetic development project. Existing rows remain.
begin;
create schema if not exists portal_mirror_private;
revoke all on schema portal_mirror_private from public, anon, authenticated;

-- CREATE IF NOT EXISTS supports a clean project; existing schemas are retained.
create table if not exists public.employee_mirror (
  "Id" uuid primary key default gen_random_uuid(),
  "AuthUserId" uuid references auth.users(id) on delete set null,
  "CustomerFullName" text, "CustomerIndividualFirstName" text,
  "CustomerIndividualPayrollNumbers" text, "CustomerAddressEmail" text,
  "CustomerAddressMobileLine" text, "EmploymentStartDate" date,
  "DepartmentDescription" text, "DesignationDescription" text,
  "BranchDescription" text, "EmployeeTypeDescription" text,
  "NationalSocialSecurityFundNumber" text, "NationalHospitalInsuranceFundNumber" text
);
create table if not exists public.leave_types_mirror (
  erp_id text primary key, description text not null, synced_at timestamptz not null default now()
);
create table if not exists public.leave_application_mirror (
  erp_id text primary key, employee_erp_id text not null, leave_type_erp_id text,
  leave_type_description text not null, start_date date not null, end_date date not null,
  reason text, status integer not null, status_description text,
  source_payload jsonb not null default '{}', synced_at timestamptz not null default now()
);
alter table public.employee_mirror add column if not exists "IsLocked" boolean not null default false;
alter table public.leave_types_mirror add column if not exists source_payload jsonb not null default '{}';
alter table public.leave_application_mirror
  add column if not exists balance_snapshot numeric not null default 0,
  add column if not exists created_date timestamptz not null default now(),
  add column if not exists authorization_remarks text,
  add column if not exists authorized_date timestamptz,
  add column if not exists recall_remarks text,
  add column if not exists recalled_date timestamptz,
  add column if not exists effective_return_date date,
  add column if not exists notification_pending boolean not null default false;

-- Abort on duplicate identity links/IDs instead of guessing an employee or deleting rows.
create unique index if not exists portal_mirror_unique_auth on public.employee_mirror("AuthUserId") where "AuthUserId" is not null;
create unique index if not exists portal_mirror_unique_employee on public.employee_mirror("Id");
create unique index if not exists portal_mirror_unique_type on public.leave_types_mirror(erp_id);
create unique index if not exists portal_mirror_unique_application on public.leave_application_mirror(erp_id);
create index if not exists portal_mirror_application_owner on public.leave_application_mirror(employee_erp_id, created_date desc, erp_id);

-- Compatibility views are private and contain no copied records.
create or replace view portal_mirror_private.employees as
  select "Id"::text as id, "AuthUserId" as auth_user_id,
    jsonb_build_object('CustomerIndividualLastName',null,'BranchId',null,'DepartmentId',null,
      'DesignationId',null,'EmployeeTypeId',null,'EmployeeTypeCategoryDescription',null)
      || (to_jsonb(e) - array['AuthUserId','IsLocked']) as profile, "IsLocked" as is_locked
  from public.employee_mirror e;
create or replace view portal_mirror_private.leave_types as
  select erp_id as id, jsonb_build_object('Description', description,
    'Entitlement',source_payload->'Entitlement','IsAccrued',source_payload->'IsAccrued',
    'UnitType',source_payload->'UnitType','UnitTypeDescription',source_payload->'UnitTypeDescription',
    'ExcludeHolidays',source_payload->'ExcludeHolidays','ExcludeWeekends',source_payload->'ExcludeWeekends') as payload
  from public.leave_types_mirror;
-- This is a simple updatable view: mutations write straight into the existing mirror.
create or replace view portal_mirror_private.applications as
  select erp_id as id, employee_erp_id as employee_id, leave_type_erp_id as leave_type_id,
    start_date, end_date, reason, status, balance_snapshot, created_date,
    authorization_remarks, authorized_date, recall_remarks, recalled_date,
    effective_return_date, notification_pending
  from public.leave_application_mirror;

create table if not exists public.portal_mirror_eligibility (
  employee_id text not null, leave_type_id text not null references public.leave_types_mirror(erp_id),
  primary key(employee_id, leave_type_id)
);
create table if not exists public.portal_mirror_balance_fixtures (
  employee_id text not null, leave_type_id text not null references public.leave_types_mirror(erp_id),
  as_at date not null, page_index integer not null check(page_index >= 0),
  payload jsonb not null check(jsonb_typeof(payload) = 'object'),
  primary key(employee_id, leave_type_id, as_at, page_index)
);
create table if not exists public.portal_mirror_preview_fixtures (
  employee_id text not null, leave_type_id text not null references public.leave_types_mirror(erp_id),
  start_date date not null, end_date date not null check(end_date >= start_date),
  payload jsonb not null check(jsonb_typeof(payload) = 'object' and payload ? 'CanSubmit' and payload ? 'Cycles'),
  primary key(employee_id, leave_type_id, start_date, end_date)
);

alter table public.employee_mirror enable row level security;
alter table public.leave_types_mirror enable row level security;
alter table public.leave_application_mirror enable row level security;
alter table public.portal_mirror_eligibility enable row level security;
alter table public.portal_mirror_balance_fixtures enable row level security;
alter table public.portal_mirror_preview_fixtures enable row level security;
drop policy if exists "TEMPORARY signed-in edit of test employee data" on public.employee_mirror;
drop policy if exists "TEMPORARY signed-in read of test employee data" on public.employee_mirror;
drop policy if exists "TEMPORARY public read of test employee data" on public.employee_mirror;
-- Existing broad policies cannot bypass these revoked direct table privileges.
-- Apply only after reviewing any other consumers of these synthetic tables.
revoke all on public.employee_mirror, public.leave_types_mirror, public.leave_application_mirror,
  public.portal_mirror_eligibility, public.portal_mirror_balance_fixtures,
  public.portal_mirror_preview_fixtures from anon, authenticated;
create or replace function public.portal_dev_request(operation text, args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  employee portal_mirror_private.employees;
  application portal_mirror_private.applications;
  leave_type portal_mirror_private.leave_types;
  result jsonb;
  preview jsonb;
  item_id text;
  type_id text;
  starts date;
  ends date;
  page integer;
  size integer;
  total integer;
begin
  if operation is null or args is null or jsonb_typeof(args) <> 'object' then
    raise exception using errcode = '22023', message = 'An operation and object arguments are required.';
  end if;
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'status', 401, 'message', 'Sign in to continue.', 'error', jsonb_build_object('code', 'AUTHENTICATION_REQUIRED'));
  end if;
  -- Lock serializes writes and status checks for the same synthetic employee.
  select * into employee from portal_mirror_private.employees where auth_user_id = auth.uid() for update;
  if not found or employee.is_locked then
    return jsonb_build_object('success', false, 'status', 403, 'message', 'Your account must be linked to an active employee.', 'error', jsonb_build_object('code', 'HR_PORTAL_ACCESS_DENIED'));
  end if;
  if operation = 'profile' then
    -- Allowlist matches PortalProfileController. Never expose auth_user_id.
    select jsonb_object_agg(key, value) into result from jsonb_each(employee.profile)
    where key = any(array['CustomerFullName','CustomerIndividualFirstName','CustomerIndividualLastName',
      'CustomerIndividualPayrollNumbers','CustomerAddressEmail','CustomerAddressMobileLine','EmploymentStartDate',
      'BranchId','BranchDescription','DepartmentId','DepartmentDescription','DesignationId','DesignationDescription',
      'EmployeeTypeId','EmployeeTypeDescription','EmployeeTypeCategoryDescription',
      'NationalSocialSecurityFundNumber','NationalHospitalInsuranceFundNumber']);
    result := coalesce(result, '{}'::jsonb) || jsonb_build_object('Id', employee.id);
  elsif operation = 'leaveTypes' then
    select coalesce(jsonb_agg(t.payload || jsonb_build_object('Id', t.id) order by t.payload->>'Description', t.id), '[]'::jsonb)
    into result from portal_mirror_private.leave_types t join public.portal_mirror_eligibility e on e.leave_type_id = t.id where e.employee_id = employee.id;
  elsif operation = 'applications' then
    page := coalesce((args->>'pageIndex')::integer, 0); size := coalesce((args->>'pageSize')::integer, 20);
    if page < 0 or size not between 1 and 100 then raise exception using errcode = '22023', message = 'Invalid paging.'; end if;
    select count(*) into total from portal_mirror_private.applications where employee_id = employee.id;
    select coalesce(jsonb_agg(portal_mirror_private.application_view(a) order by a.created_date desc, a.id), '[]'::jsonb) into result
    from (select * from portal_mirror_private.applications where employee_id = employee.id order by created_date desc, id limit size offset page::bigint * size) a;
    result := jsonb_build_object('PageIndex', page, 'PageSize', size, 'TotalCount', total, 'TotalPages', ceil(total::numeric / size), 'PageCollection', result);
  elsif operation in ('application', 'updateLeave', 'withdraw') then
    item_id := (args->>'id');
    select * into application from portal_mirror_private.applications where id = item_id and employee_id = employee.id for update;
    if not found then
      return jsonb_build_object('success', false, 'status', 404, 'message', 'Leave application not found.', 'error', jsonb_build_object('code', 'RESOURCE_NOT_FOUND'));
    end if;
    if operation <> 'application' and application.status <> 1 then raise exception using errcode = '22023', message = 'Only pending applications can be changed.'; end if;
    if operation = 'withdraw' then
      update public.leave_application_mirror set status = 16, status_description = 'Withdrawn', notification_pending = false where erp_id = item_id;
      select * into application from portal_mirror_private.applications where id = item_id;
    end if;
    result := portal_mirror_private.application_view(application);
  elsif operation not in ('balances', 'preview', 'submitLeave') then
    raise exception using errcode = '22023', message = 'Unsupported portal operation.';
  end if;

  if operation in ('balances', 'preview', 'submitLeave', 'updateLeave') then
    type_id := (args->>'leaveTypeId');
    select * into leave_type from portal_mirror_private.leave_types t where t.id = type_id
      and exists (select 1 from public.portal_mirror_eligibility e where e.employee_id = employee.id and e.leave_type_id = t.id);
    if not found then raise exception using errcode = '22023', message = 'Select an eligible leave type.'; end if;
    if operation = 'balances' then
      page := coalesce((args->>'pageIndex')::integer, 0);
      if page < 0 or args->>'asAt' is null then raise exception using errcode = '22023', message = 'An asAt date and nonnegative pageIndex are required.'; end if;
      select payload into result from public.portal_mirror_balance_fixtures where employee_id = employee.id and leave_type_id = type_id and as_at = (args->>'asAt')::date and page_index = page;
      if not found then raise exception using errcode = '22023', message = 'No balance fixture matches this date and page. See the development scenarios.'; end if;
    else
      starts := (args->>'start')::date; ends := (args->>'end')::date;
      if starts is null or ends is null or ends < starts then raise exception using errcode = '22023', message = 'Valid start and end dates are required.'; end if;
      if operation = 'preview' and args->>'excludedId' is not null then
        item_id := (args->>'excludedId');
        if not exists (select 1 from portal_mirror_private.applications where id = item_id and employee_id = employee.id) then
          return jsonb_build_object('success', false, 'status', 403, 'message', 'You cannot preview another employee application.', 'error', jsonb_build_object('code', 'HR_PORTAL_ACCESS_DENIED'));
        end if;
      end if;
      select payload into preview from public.portal_mirror_preview_fixtures where employee_id = employee.id and leave_type_id = type_id and start_date = starts and end_date = ends;
      if not found then preview := jsonb_build_object('RequestedDays', 0, 'CanSubmit', false, 'Error', 'No preview fixture matches these dates. See the development scenarios.', 'Cycles', '[]'::jsonb); end if;
      if exists (select 1 from portal_mirror_private.applications a where a.employee_id = employee.id and a.status in (1, 2, 8) and a.start_date <= ends and a.end_date >= starts and (item_id is null or a.id <> item_id)) then
        preview := preview || jsonb_build_object('CanSubmit', false, 'Error', 'The dates overlap an existing leave application.');
      end if;
      result := preview;
      if operation in ('submitLeave', 'updateLeave') then
        if coalesce(length(btrim(args->>'reason')), 0) not between 1 and 256 then raise exception using errcode = '22023', message = 'Reason must contain 1 to 256 characters.'; end if;
        if not coalesce((preview->>'CanSubmit')::boolean, false) then raise exception using errcode = '22023', message = coalesce(preview->>'Error', 'The request cannot be submitted.'); end if;
        if operation = 'submitLeave' then
          insert into public.leave_application_mirror(erp_id, employee_erp_id, leave_type_erp_id, leave_type_description, start_date, end_date, reason, status, status_description, balance_snapshot)
          values(gen_random_uuid()::text, employee.id, type_id, leave_type.payload->>'Description', starts, ends, btrim(args->>'reason'), 1, 'Pending', coalesce((preview #>> '{Cycles,0,Available}')::numeric, 0)) returning erp_id, employee_erp_id, leave_type_erp_id, start_date, end_date, reason, status, balance_snapshot, created_date, authorization_remarks, authorized_date, recall_remarks, recalled_date, effective_return_date, notification_pending into application;
        else
          update portal_mirror_private.applications set leave_type_id = type_id, start_date = starts, end_date = ends, reason = btrim(args->>'reason'),
            balance_snapshot = coalesce((preview #>> '{Cycles,0,Available}')::numeric, 0)
          where id = item_id and employee_id = employee.id and status = 1 returning * into application;
        end if;
        update public.leave_application_mirror set leave_type_description = leave_type.payload->>'Description' where erp_id = application.id;
        result := portal_mirror_private.application_view(application);
      end if;
    end if;
  end if;
  return jsonb_build_object('success', true, 'message', 'Request completed.', 'data', result);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or invalid_parameter_value or numeric_value_out_of_range then
  return jsonb_build_object('success', false, 'status', 400, 'message', case when sqlstate = '22023' then sqlerrm else 'Check the request field formats.' end, 'error', jsonb_build_object('code', 'LEAVE_VALIDATION_FAILED'));
end;
$$;

create or replace function portal_mirror_private.application_view(a portal_mirror_private.applications)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('Id', a.id, 'EmployeeId', a.employee_id, 'EmployeeName', e.profile->>'CustomerFullName',
    'LeaveTypeId', a.leave_type_id, 'LeaveTypeDescription', coalesce(t.payload->>'Description', (select leave_type_description from public.leave_application_mirror where erp_id = a.id)), 'Start', a.start_date, 'End', a.end_date,
    'Reason', a.reason, 'Status', a.status, 'StatusDescription', case a.status when 1 then 'Pending' when 2 then 'Approved' when 4 then 'Rejected' when 8 then 'Recalled' when 16 then 'Withdrawn' end,
    'BalanceSnapshot', a.balance_snapshot, 'CreatedDate', a.created_date, 'AuthorizationRemarks', a.authorization_remarks,
    'AuthorizedDate', a.authorized_date, 'RecallRemarks', a.recall_remarks, 'RecalledDate', a.recalled_date,
    'EffectiveReturnDate', a.effective_return_date, 'NotificationPending', a.notification_pending)
  from portal_mirror_private.employees e left join portal_mirror_private.leave_types t on t.id = a.leave_type_id where e.id = a.employee_id;
$$;
revoke all on function portal_mirror_private.application_view(portal_mirror_private.applications) from public, anon, authenticated;
revoke all on function public.portal_dev_request(text, jsonb) from public, anon;
grant execute on function public.portal_dev_request(text, jsonb) to authenticated;
commit;
