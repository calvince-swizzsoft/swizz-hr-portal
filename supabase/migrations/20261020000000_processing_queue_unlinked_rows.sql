-- Keep unlinked synthetic mirror rows from becoming null queue entries or
-- actionable processing records. Valid requests remain visible to approvers.
begin;

create or replace function public.portal_dev_request(operation text,args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor portal_mirror_private.employees;
  saved portal_mirror_private.applications;
  previous portal_mirror_private.applications;
  result jsonb; preview jsonb; required_permission integer;
  page integer; size integer; total integer; invalid_total integer; queue_status integer;
  state_name text;
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
      select count(*) filter(where portal_mirror_private.application_view(a) is not null),
        count(*) filter(where portal_mirror_private.application_view(a) is null)
        into total,invalid_total
        from portal_mirror_private.applications a where a.status=queue_status;
      select coalesce(jsonb_agg(q.dto order by q.created_date desc,q.id),'[]') into result
        from (
          select a.id,a.created_date,portal_mirror_private.application_view(a) as dto
          from portal_mirror_private.applications a
          where a.status=queue_status and portal_mirror_private.application_view(a) is not null
          order by a.created_date desc,a.id limit size offset page::bigint*size
        ) q;
      result:=jsonb_build_object('PageIndex',page,'PageSize',size,'TotalCount',total,
        'TotalPages',ceil(total::numeric/size),'PageCollection',result,'InvalidCount',invalid_total);
    else
      if saved.id is null or portal_mirror_private.application_view(saved) is null then
        return jsonb_build_object('success',false,'status',404,'message','Leave application or its employee profile was not found.','error',jsonb_build_object('code','RESOURCE_NOT_FOUND'));
      end if;
      if operation='processingApplication' then
        if saved.status not in (1,2) then raise exception using errcode='22023',message='Only pending or approved applications can be reviewed.'; end if;
        select payload into preview from public.portal_mirror_preview_fixtures where employee_id=saved.employee_id
          and leave_type_id=saved.leave_type_id and start_date=saved.start_date and end_date=saved.end_date;
        result:=jsonb_build_object('Application',portal_mirror_private.application_view(saved),'Preview',coalesce(preview,'{"RequestedDays":0,"CanSubmit":false,"Error":"No matching preview fixture","Cycles":[]}'));
      else
        if not exists(select 1 from public.employee_mirror e where e."Id"::text=saved.employee_id and not e."IsLocked" and e."AuthUserId" is not null) then
          raise exception using errcode='22023',message='The request is not linked to an active employee account and cannot be processed.';
        end if;
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
