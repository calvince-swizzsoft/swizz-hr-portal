-- Operator-only synthetic test. All modifications are rolled back.
begin;
delete from public.portal_mirror_workflow_requests;
delete from public.leave_application_mirror where erp_id not in ('30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002');
do $$
declare employee_user uuid; approver_user uuid; response jsonb; saved_id text;
  body jsonb:='{"leaveTypeId":"20000000-0000-4000-8000-000000000001","start":"2027-01-11","end":"2027-01-13","reason":"Workflow test"}';
  query jsonb:='{"leaveTypeId":"20000000-0000-4000-8000-000000000001","asAt":"2027-01-10"}';
begin
  select "AuthUserId" into employee_user from public.employee_mirror where "Id"='10000000-0000-4000-8000-000000000001';
  select "AuthUserId" into approver_user from public.employee_mirror where "Id"='10000000-0000-4000-8000-000000000002';
  assert employee_user is not null and approver_user is not null;
  assert not has_table_privilege('authenticated','public.portal_mirror_processing_permissions','INSERT');
  perform set_config('request.jwt.claim.sub',employee_user::text,true);
  assert (public.portal_dev_request('processingApplications')->>'status')::integer=403;
  delete from public.portal_mirror_processing_permissions where permission=22017;
  response:=public.portal_dev_request('submitLeave',body);
  assert (response->>'status')::integer=400 and response->>'message' like '%No other active%';
  insert into public.portal_mirror_processing_permissions values('10000000-0000-4000-8000-000000000002',22017);
  response:=public.portal_dev_request('submitLeave',body);
  assert (response->>'success')::boolean,response::text;
  saved_id:=response#>>'{data,Id}';
  assert (public.portal_dev_request('balances',query)#>>'{data,Balance,Reserved}')::integer=3;
  response:=public.portal_dev_request('updateLeave',body||jsonb_build_object('id',saved_id,'start','2027-01-18','end','2027-01-19'));
  assert (response->>'success')::boolean,response::text;
  assert (public.portal_dev_request('balances',query)#>>'{data,Balance,Reserved}')::integer=2;
  perform set_config('request.jwt.claim.sub',approver_user::text,true);
  response:=public.portal_dev_request('processingApplication',jsonb_build_object('id',saved_id));
  assert response#>>'{data,Application,EmployeeId}'='10000000-0000-4000-8000-000000000001';
  response:=public.portal_dev_request('authorizeLeave',jsonb_build_object('id',saved_id,'decision','approve','remarks','Approved in test'));
  assert (response#>>'{data,Status}')::integer=2,response::text;
  assert response#>>'{data,AuthorizationRemarks}'='Approved in test';
  assert (public.portal_dev_request('authorizeLeave',jsonb_build_object('id',saved_id,'decision','reject'))->>'status')::integer=400;
  perform set_config('request.jwt.claim.sub',employee_user::text,true);
  assert (public.portal_dev_request('balances',query)#>>'{data,Balance,Used}')::integer=5;
  assert (public.portal_dev_request('balances',query)#>>'{data,Balance,Reserved}')::integer=0;
  assert (public.portal_dev_request('balances',query)#>>'{data,Balance,Available}')::integer=16;
  response:=public.portal_dev_request('balances',query);
  assert response#>>'{data,History,0,Id}'=saved_id;
  assert (response#>>'{data,History,0,Status}')::integer=2;
  -- Reset ONLY the disposable request in this rollback transaction to test rejection.
  update public.leave_application_mirror set status=1,status_description='Pending' where erp_id=saved_id;
  perform set_config('request.jwt.claim.sub',approver_user::text,true);
  response:=public.portal_dev_request('authorizeLeave',jsonb_build_object('id',saved_id,'decision','reject','remarks','Rejected in test'));
  assert (response#>>'{data,Status}')::integer=4,response::text;
  perform set_config('request.jwt.claim.sub',employee_user::text,true);
  assert (public.portal_dev_request('balances',query)#>>'{data,Balance,Available}')::integer=18;
  response:=public.portal_dev_request('submitLeave',body);
  assert (response->>'success')::boolean,response::text;
  saved_id:=response#>>'{data,Id}';
  perform public.portal_dev_request('withdraw',jsonb_build_object('id',saved_id));
  assert (public.portal_dev_request('balances',query)#>>'{data,Balance,Available}')::integer=18;
  -- Grant the requester permission inside the rollback test to prove self-approval
  -- is independently blocked even when the caller has approval permission.
  insert into public.portal_mirror_processing_permissions values('10000000-0000-4000-8000-000000000001',22017);
  response:=public.portal_dev_request('submitLeave',body); saved_id:=response#>>'{data,Id}';
  response:=public.portal_dev_request('authorizeLeave',jsonb_build_object('id',saved_id,'decision','approve'));
  assert (response->>'status')::integer=400 and response->>'message' like '%own application%';
  -- A missing fixture must roll back the decision as well as the balance write.
  update public.portal_mirror_workflow_fixtures set states=jsonb_set(states,'{approved}','null') where start_date='2027-01-11';
  perform set_config('request.jwt.claim.sub',approver_user::text,true);
  response:=public.portal_dev_request('authorizeLeave',jsonb_build_object('id',saved_id,'decision','approve'));
  assert (response->>'status')::integer=400,response::text;
  assert (select status from public.leave_application_mirror where erp_id=saved_id)=1,'Decision must roll back with fixture failure';
end $$;
rollback;
