-- OPTIONAL synthetic scenarios using the existing mirrors. Existing rows are retained.
-- Create both confirmed Auth accounts first; passwords are never seeded.
begin;
do $$ begin
  if (select count(*) from auth.users where email in ('employee.one@example.test','employee.two@example.test')) <> 2 then
    raise exception 'Create the two development Auth accounts before seeding';
  end if;
end $$;
insert into public.employee_mirror("Id","AuthUserId","CustomerFullName","CustomerIndividualFirstName",
  "CustomerIndividualPayrollNumbers","CustomerAddressEmail","EmploymentStartDate",
  "DepartmentDescription","DesignationDescription","BranchDescription","EmployeeTypeDescription")
select case email when 'employee.one@example.test' then '10000000-0000-4000-8000-000000000001'::uuid else '10000000-0000-4000-8000-000000000002'::uuid end,
  id, case email when 'employee.one@example.test' then 'Test Employee One' else 'Test Employee Two' end,
  'Test',case email when 'employee.one@example.test' then 'TEST-001' else 'TEST-002' end,
  email,'2025-01-01','Test Department','Test Designation','Test Branch','Test Employee'
from auth.users u where email in ('employee.one@example.test','employee.two@example.test')
  and not exists (select 1 from public.employee_mirror e where e."AuthUserId" = u.id)
on conflict ("Id") do nothing;

insert into public.leave_types_mirror(erp_id,description,source_payload)
values ('20000000-0000-4000-8000-000000000001','Annual leave',
  '{"Entitlement":21,"IsAccrued":false,"UnitType":3,"UnitTypeDescription":"Yearly","ExcludeHolidays":true,"ExcludeWeekends":true}')
on conflict (erp_id) do nothing;

insert into public.portal_mirror_eligibility
select "Id"::text,'20000000-0000-4000-8000-000000000001' from public.employee_mirror
where "Id" in ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002') on conflict do nothing;
insert into public.portal_mirror_preview_fixtures
select e."Id"::text,'20000000-0000-4000-8000-000000000001',s.starts,s.ends,
  jsonb_build_object('RequestedDays',s.days,'CanSubmit',s.allowed,'Error',case when s.allowed then null else 'Fixture example of insufficient leave.' end,
  'Cycles',jsonb_build_array(jsonb_build_object('Start','2027-01-01','End','2027-12-31','Entitlement',21,'Used',3,'Reserved',0,'Available',18,'Requested',s.days,'Remaining',18-s.days)))
from public.employee_mirror e cross join (values
  ('2027-01-11'::date,'2027-01-13'::date,3,true),
  ('2027-01-18'::date,'2027-01-19'::date,2,true),
  ('2027-02-01'::date,'2027-03-01'::date,21,false)
) s(starts,ends,days,allowed)
where e."Id" in ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002') on conflict do nothing;

insert into public.leave_application_mirror(erp_id,employee_erp_id,leave_type_erp_id,leave_type_description,
  start_date,end_date,reason,status,status_description,balance_snapshot,authorization_remarks,authorized_date)
select case e."Id" when '10000000-0000-4000-8000-000000000001'::uuid then '30000000-0000-4000-8000-000000000001' else '30000000-0000-4000-8000-000000000002' end,
  e."Id"::text,'20000000-0000-4000-8000-000000000001','Annual leave',
  '2027-01-04','2027-01-06','Synthetic approved history',2,'Approved',21,'Fixture decision','2026-10-16T10:00:00Z'
from public.employee_mirror e where e."Id" in ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002') on conflict (erp_id) do nothing;

insert into public.portal_mirror_balance_fixtures
select e."Id"::text,'20000000-0000-4000-8000-000000000001','2027-01-10',0,
  jsonb_build_object('AsAt','2027-01-10','Today','2027-01-10','LeaveTypeDescription','Annual leave','IsAccrued',false,
    'Balance',jsonb_build_object('Start','2027-01-01','End','2027-12-31','Entitlement',21,'Used',3,'Reserved',0,'Available',18,'Requested',0,'Remaining',18),
    'BalanceError',null,'TakenDays',3,'UpcomingDays',0,'HistoryCount',1,
    'History',jsonb_build_array(jsonb_build_object('Id',a.erp_id,'Start',a.start_date,'End',a.end_date,'Status',2,'ChargedDaysInYear',3,'EffectiveReturnDate',null,'Reason',a.reason,'AuthorizedBy','Test approver')))
from public.employee_mirror e join public.leave_application_mirror a on a.employee_erp_id = e."Id"::text
where a.erp_id in ('30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002') on conflict do nothing;
commit;
