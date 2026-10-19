-- Operator-only synthetic test. All modifications are rolled back.
begin;
delete from public.portal_mirror_workflow_requests;
delete from public.leave_application_mirror where erp_id not in ('30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002');
insert into public.leave_application_mirror(erp_id,employee_erp_id,leave_type_erp_id,leave_type_description,
  start_date,end_date,reason,status,status_description)
values('90000000-0000-4000-8000-000000000001','missing-synthetic-employee',
  '20000000-0000-4000-8000-000000000001','Annual leave',
  '2027-01-11','2027-01-13','Unlinked queue regression row',1,'Pending')
on conflict(erp_id) do nothing;
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
  assert (public.portal_dev_processing_balance_fixture(jsonb_build_object(
    'action','get','applicationId','30000000-0000-4000-8000-000000000002','asAt','2027-01-10','pageIndex',0))->>'status')::integer=403,
    'Employees without processing permissions cannot edit another employee balance';
  delete from public.portal_mirror_processing_permissions where permission=22017;
  response:=public.portal_dev_request('submitLeave',body);
  assert (response->>'status')::integer=400 and response->>'message' like '%No other active%';
  insert into public.portal_mirror_processing_permissions values('10000000-0000-4000-8000-000000000002',22017);
  response:=public.portal_dev_request('submitLeave',body);
  assert (response->>'success')::boolean,response::text;
  saved_id:=response#>>'{data,Id}';
  response:=public.portal_dev_processing_balance_fixture(jsonb_build_object(
    'action','get','applicationId',saved_id,'asAt','2027-01-10','pageIndex',0));
  assert (response->>'status')::integer=403,'Employees cannot edit or load balance fixtures through processing tools';
  assert (public.portal_dev_request('balances',query)#>>'{data,Balance,Reserved}')::integer=3;
  response:=public.portal_dev_request('updateLeave',body||jsonb_build_object('id',saved_id,'start','2027-01-18','end','2027-01-19'));
  assert (response->>'success')::boolean,response::text;
  assert (public.portal_dev_request('balances',query)#>>'{data,Balance,Reserved}')::integer=2;
  perform set_config('request.jwt.claim.sub',approver_user::text,true);
  response:=public.portal_dev_request('processingApplications',jsonb_build_object('status',1,'pageIndex',0,'pageSize',20));
  assert (response#>>'{data,InvalidCount}')::integer=1,response::text;
  assert (response#>>'{data,TotalCount}')::integer=1,response::text;
  assert (response#>>'{data,PageCollection,0,Id}')=saved_id,response::text;
  assert (public.portal_dev_request('processingApplication',jsonb_build_object('id','90000000-0000-4000-8000-000000000001'))->>'status')::integer=404;
  assert (public.portal_dev_request('authorizeLeave',jsonb_build_object('id','90000000-0000-4000-8000-000000000001','decision','approve'))->>'status')::integer=404;
  response:=public.portal_dev_processing_balance_fixture(jsonb_build_object(
    'action','get','applicationId',saved_id,'asAt','2027-01-10','pageIndex',0));
  assert (response->>'success')::boolean and response#>>'{data,Balance,Available}'='16',response::text;
  response:=public.portal_dev_processing_balance_fixture(jsonb_build_object(
    'action','save','applicationId',saved_id,'asAt','2027-01-10','pageIndex',0,
    'Entitlement',24,'Used',4,'Reserved',1,'Available',19,'employeeId','10000000-0000-4000-8000-000000000002'));
  assert (response->>'success')::boolean,response::text;
  assert response#>>'{data,Balance,Available}'='19',response::text;
  assert (public.portal_dev_processing_balance_fixture(jsonb_build_object(
    'action','save','applicationId',saved_id,'asAt','2027-01-10','pageIndex',0,
    'Entitlement',-1,'Used',4,'Reserved',1,'Available',19))->>'status')::integer=400;
  response:=public.portal_dev_processing_balance_fixture(jsonb_build_object(
    'action','save','applicationId',saved_id,'asAt','2027-03-10','pageIndex',0,
    'CycleStart','2027-01-01','CycleEnd','2027-12-31','Entitlement',21,'Used',2,'Reserved',1,'Available',18));
  assert (response->>'success')::boolean,response::text;
  assert response#>>'{data,AsAt}'='2027-03-10';
  perform set_config('request.jwt.claim.sub',employee_user::text,true);
  assert (public.portal_dev_request('balances',query)#>>'{data,Balance,Available}')::integer=19,
    'Approver fixture changes must be visible on the employee balance page';
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
