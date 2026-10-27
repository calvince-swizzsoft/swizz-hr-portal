-- Avoid a PL/pgSQL variable/column name collision when creating leave types.
begin;

create or replace function public.portal_dev_create_leave_type(args jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $create_type$
declare
  actor portal_mirror_private.employees;
  requested_description text;
  type_id text;
  employee_count integer;
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
    return jsonb_build_object('success', false, 'status', 403, 'message', 'Your role cannot create leave types.',
      'error', jsonb_build_object('code', 'HR_PORTAL_ACCESS_DENIED'));
  end if;

  requested_description := btrim(args->>'Description');
  if requested_description is null or length(requested_description) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Leave type name must contain 1 to 100 characters.';
  end if;

  lock table public.leave_types_mirror in share row exclusive mode;
  if exists (
    select 1 from public.leave_types_mirror t
    where lower(btrim(t.description)) = lower(requested_description)
  ) then
    raise exception using errcode = '22023',
      message = 'A leave type with this name already exists. Select it under Leave types to set up its balance.';
  end if;

  select count(*) into employee_count
  from public.employee_mirror
  where not "IsLocked";

  if employee_count = 0 then
    raise exception using errcode = '22023', message = 'No unlocked employee records are available.';
  end if;

  type_id := gen_random_uuid()::text;

  insert into public.leave_types_mirror(erp_id, description, source_payload)
  values(type_id, requested_description, '{}'::jsonb);

  insert into public.portal_mirror_eligibility(employee_id, leave_type_id)
  select e."Id"::text, type_id
  from public.employee_mirror e
  where not e."IsLocked";

  return jsonb_build_object('success', true, 'message', 'Leave type created.',
    'data', jsonb_build_object(
      'Id', type_id,
      'Description', requested_description,
      'EmployeeCount', employee_count
    ));
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
  or invalid_parameter_value or numeric_value_out_of_range then
  return jsonb_build_object('success', false, 'status', 400,
    'message', case when sqlstate = '22023' then sqlerrm else 'Check the leave type name.' end,
    'error', jsonb_build_object('code', 'LEAVE_VALIDATION_FAILED'));
end;
$create_type$;

revoke all on function public.portal_dev_create_leave_type(jsonb) from public, anon;
grant execute on function public.portal_dev_create_leave_type(jsonb) to authenticated;

commit;
