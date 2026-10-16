-- Synthetic development workflow only. Requires the existing-mirror adapter.
begin;
create table public.portal_mirror_processing_permissions (
  employee_id text not null,
  permission integer not null check(permission in (22017,22018)),
  primary key(employee_id,permission)
);
create table public.portal_mirror_workflow_fixtures (
  employee_id text not null,
  leave_type_id text not null,
  start_date date not null,
  end_date date not null,
  -- Full EmployeeLeaveStatistics payloads, prepared explicitly by the operator.
  states jsonb not null check(states ?& array['pending','approved','rejected','withdrawn']),
  primary key(employee_id,leave_type_id,start_date,end_date)
);
create table public.portal_mirror_workflow_requests (
  application_id text primary key references public.leave_application_mirror(erp_id),
  employee_id text not null,
  leave_type_id text not null,
  start_date date not null,
  end_date date not null,
  foreign key(employee_id,leave_type_id,start_date,end_date)
    references public.portal_mirror_workflow_fixtures(employee_id,leave_type_id,start_date,end_date)
);
alter table public.portal_mirror_processing_permissions enable row level security;
alter table public.portal_mirror_workflow_fixtures enable row level security;
alter table public.portal_mirror_workflow_requests enable row level security;
revoke all on public.portal_mirror_processing_permissions,public.portal_mirror_workflow_fixtures,
  public.portal_mirror_workflow_requests from anon,authenticated;

-- Keep the tested employee implementation private; the wrapper adds atomic
-- scenario transitions and the ERP-compatible processing operations.
alter function public.portal_dev_request(text,jsonb) set schema portal_mirror_private;
alter function portal_mirror_private.portal_dev_request(text,jsonb) rename to employee_request;
revoke all on function portal_mirror_private.employee_request(text,jsonb) from public,anon,authenticated;

create function portal_mirror_private.apply_workflow_balance(request_id text, state_name text)
returns void language plpgsql set search_path = '' as $$
declare payload jsonb; request public.portal_mirror_workflow_requests;
  application public.leave_application_mirror; charged_days numeric;
begin
  select * into strict request from public.portal_mirror_workflow_requests where application_id=request_id;
  select states->state_name into payload from public.portal_mirror_workflow_fixtures
    where employee_id=request.employee_id and leave_type_id=request.leave_type_id
      and start_date=request.start_date and end_date=request.end_date;
  if payload is null or jsonb_typeof(payload->'History') <> 'array' or payload->>'AsAt' is null then
    raise exception using errcode='22023',message='The workflow balance fixture is incomplete.';
  end if;
  select * into strict application from public.leave_application_mirror where erp_id=request_id;
  select (f.payload->>'RequestedDays')::numeric into charged_days from public.portal_mirror_preview_fixtures f
    where f.employee_id=request.employee_id and f.leave_type_id=request.leave_type_id
      and f.start_date=request.start_date and f.end_date=request.end_date;
  -- Insert actual request identity/audit into the predefined history example.
  -- Day counts come from the matching fixture, never calendar calculations.
  payload:=jsonb_set(payload,'{History}',jsonb_build_array(jsonb_build_object(
    'Id',application.erp_id,'Start',application.start_date,'End',application.end_date,
    'Status',application.status,'ChargedDaysInYear',case when application.status in (1,2,8) then coalesce(charged_days,0) else 0 end,
    'EffectiveReturnDate',application.effective_return_date,'Reason',application.reason,'AuthorizedBy',null)) || (payload->'History'));
  payload:=jsonb_set(payload,'{HistoryCount}',to_jsonb(jsonb_array_length(payload->'History')));
  insert into public.portal_mirror_balance_fixtures(employee_id,leave_type_id,as_at,page_index,payload)
    values(request.employee_id,request.leave_type_id,(payload->>'AsAt')::date,0,payload)
    on conflict(employee_id,leave_type_id,as_at,page_index) do update set payload=excluded.payload;
end $$;
revoke all on function portal_mirror_private.apply_workflow_balance(text,text) from public,anon,authenticated;

create function public.portal_dev_request(operation text,args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor portal_mirror_private.employees;
  saved portal_mirror_private.applications;
  previous portal_mirror_private.applications;
  result jsonb; preview jsonb; required_permission integer;
  page integer; size integer; total integer; queue_status integer;
  state_name text; subject_id text;
begin
  if operation is null or args is null or jsonb_typeof(args)<>'object' then
    raise exception using errcode='22023',message='An operation and object arguments are required.';
  end if;
  if auth.uid() is null then
    return jsonb_build_object('success',false,'status',401,'message','Sign in to continue.','error',jsonb_build_object('code','AUTHENTICATION_REQUIRED'));
  end if;
  select * into actor from portal_mirror_private.employees where auth_user_id=auth.uid();
  if not found or actor.is_locked then
    return jsonb_build_object('success',false,'status',403,'message','An active employee linkage is required.','error',jsonb_build_object('code','HR_PORTAL_ACCESS_DENIED'));
  end if;
  if operation in ('processingApplications','processingApplication','authorizeLeave') then
    if operation='processingApplications' then
      queue_status:=coalesce((args->>'status')::integer,1);
    else
      select * into saved from portal_mirror_private.applications where id=args->>'id';
      queue_status:=saved.status;
    end if;
    required_permission:=case when operation='authorizeLeave' or queue_status=1 then 22017 else 22018 end;
    if not exists(select 1 from public.portal_mirror_processing_permissions where employee_id=actor.id and permission=required_permission) then
      return jsonb_build_object('success',false,'status',403,'message','Your role cannot process this leave queue.','error',jsonb_build_object('code','HR_PORTAL_ACCESS_DENIED'));
    end if;
    if operation='processingApplications' then
      if queue_status not in (1,2) then raise exception using errcode='22023',message='Only pending or approved processing queues are supported.'; end if;
      page:=coalesce((args->>'pageIndex')::integer,0); size:=coalesce((args->>'pageSize')::integer,20);
      if page<0 or size not between 1 and 100 then raise exception using errcode='22023',message='Invalid paging.'; end if;
      select count(*) into total from portal_mirror_private.applications where status=queue_status;
      select coalesce(jsonb_agg(portal_mirror_private.application_view(a) order by a.created_date desc,a.id),'[]') into result
        from (select * from portal_mirror_private.applications where status=queue_status order by created_date desc,id limit size offset page::bigint*size) a;
      result:=jsonb_build_object('PageIndex',page,'PageSize',size,'TotalCount',total,'TotalPages',ceil(total::numeric/size),'PageCollection',result);
    else
      if saved.id is null then return jsonb_build_object('success',false,'status',404,'message','Leave application not found.','error',jsonb_build_object('code','RESOURCE_NOT_FOUND')); end if;
      if operation='processingApplication' then
        if saved.status not in (1,2) then raise exception using errcode='22023',message='Only pending or approved applications can be reviewed.'; end if;
        select payload into preview from public.portal_mirror_preview_fixtures where employee_id=saved.employee_id
          and leave_type_id=saved.leave_type_id and start_date=saved.start_date and end_date=saved.end_date;
        result:=jsonb_build_object('Application',portal_mirror_private.application_view(saved),'Preview',coalesce(preview,'{"RequestedDays":0,"CanSubmit":false,"Error":"No matching preview fixture","Cycles":[]}'));
      else
        -- Lock subject before application, matching employee write lock order.
        perform 1 from public.employee_mirror where "Id"::text=saved.employee_id for update;
        select * into saved from portal_mirror_private.applications where id=args->>'id' for update;
        if saved.employee_id=actor.id then raise exception using errcode='22023',message='You cannot approve or reject your own application.'; end if;
        if saved.status<>1 then raise exception using errcode='22023',message='Only pending applications can be processed.'; end if;
        if args->>'decision' is null or args->>'decision' not in ('approve','reject') or length(coalesce(args->>'remarks',''))>256 then
          raise exception using errcode='22023',message='Use approve or reject and remarks of at most 256 characters.';
        end if;
        if not exists(select 1 from public.portal_mirror_workflow_requests where application_id=saved.id) then
          raise exception using errcode='22023',message='No workflow scenario is attached to this request. Configure a synthetic scenario before processing.';
        end if;
        state_name:=case args->>'decision' when 'approve' then 'approved' else 'rejected' end;
        update public.leave_application_mirror set status=case state_name when 'approved' then 2 else 4 end,
          status_description=case state_name when 'approved' then 'Approved' else 'Rejected' end,
          authorization_remarks=args->>'remarks',authorized_date=now() where erp_id=saved.id;
        perform portal_mirror_private.apply_workflow_balance(saved.id,state_name);
        select * into saved from portal_mirror_private.applications where id=saved.id;
        result:=portal_mirror_private.application_view(saved);
      end if;
    end if;
  else
    if operation in ('submitLeave','updateLeave','withdraw') then
      perform 1 from public.employee_mirror where "Id"::text=actor.id for update;
      if operation in ('submitLeave','updateLeave') and not exists(
        select 1 from public.portal_mirror_processing_permissions p
        join public.employee_mirror e on e."Id"::text=p.employee_id
        where p.permission=22017 and p.employee_id<>actor.id and not e."IsLocked" and e."AuthUserId" is not null
      ) then
        raise exception using errcode='22023',message='No other active employee user is authorized to approve leave. Contact HR.';
      end if;
      if operation='submitLeave' and exists(select 1 from public.portal_mirror_workflow_requests w
        join public.leave_application_mirror a on a.erp_id=w.application_id
        where w.employee_id=actor.id and w.leave_type_id=args->>'leaveTypeId' and a.status in (1,2,8)) then
        raise exception using errcode='22023',message='This fixture supports one active request per employee and leave type. Reset the scenario before another request.';
      end if;
      if operation='updateLeave' then
        select * into previous from portal_mirror_private.applications where id=args->>'id' and employee_id=actor.id;
        if previous.id is not null and previous.leave_type_id is distinct from args->>'leaveTypeId' then
          raise exception using errcode='22023',message='This development scenario supports date/reason edits within the same leave type.';
        end if;
      end if;
      if operation in ('submitLeave','updateLeave') and not exists(select 1 from public.portal_mirror_workflow_fixtures where employee_id=actor.id
        and leave_type_id=args->>'leaveTypeId' and start_date=(args->>'start')::date and end_date=(args->>'end')::date) then
        raise exception using errcode='22023',message='No workflow scenario matches these dates.';
      end if;
    end if;
    result:=portal_mirror_private.employee_request(operation,args);
    if coalesce((result->>'success')::boolean,false) and operation in ('submitLeave','updateLeave','withdraw') then
      if operation in ('submitLeave','updateLeave') then
        insert into public.portal_mirror_workflow_requests values(result#>>'{data,Id}',actor.id,args->>'leaveTypeId',(args->>'start')::date,(args->>'end')::date)
        on conflict(application_id) do update set start_date=excluded.start_date,end_date=excluded.end_date;
        perform portal_mirror_private.apply_workflow_balance(result#>>'{data,Id}','pending');
      elsif exists(select 1 from public.portal_mirror_workflow_requests where application_id=args->>'id') then
        perform portal_mirror_private.apply_workflow_balance(args->>'id','withdrawn');
      end if;
    end if;
    return result;
  end if;
  return jsonb_build_object('success',true,'message','Request completed.','data',result);
exception when invalid_parameter_value or invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  return jsonb_build_object('success',false,'status',400,'message',case when sqlstate='22023' then sqlerrm else 'Check request field formats.' end,'error',jsonb_build_object('code','LEAVE_VALIDATION_FAILED'));
end $$;
revoke all on function public.portal_dev_request(text,jsonb) from public,anon;
grant execute on function public.portal_dev_request(text,jsonb) to authenticated;
commit;
