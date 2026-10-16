-- Apply AFTER seed.sql, in the separate synthetic project. No passwords.
-- Employee Two is the separate test approver. Employee One gets no processing grant.
begin;
do $$ begin
  if (select count(*) from public.employee_mirror where "Id" in
    ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002') and "AuthUserId" is not null)<>2 then
    raise exception 'Run seed.sql with both confirmed Auth users first';
  end if;
end $$;
insert into public.portal_mirror_processing_permissions values
('10000000-0000-4000-8000-000000000002',22017),
('10000000-0000-4000-8000-000000000002',22018) on conflict do nothing;

-- Explicit examples, not an entitlement or calendar calculator. Each date range
-- is an independent test scenario with a fixed opening balance from seed.sql.
insert into public.portal_mirror_workflow_fixtures
select p.employee_id,p.leave_type_id,p.start_date,p.end_date,
  jsonb_build_object(
    'pending',jsonb_set(jsonb_set(b.payload,'{Balance}',s.pending),'{UpcomingDays}',s.days),
    'approved',jsonb_set(jsonb_set(b.payload,'{Balance}',s.approved),'{UpcomingDays}',s.days),
    'rejected',b.payload,
    'withdrawn',b.payload)
from public.portal_mirror_preview_fixtures p
join public.portal_mirror_balance_fixtures b on b.employee_id=p.employee_id and b.leave_type_id=p.leave_type_id and b.as_at='2027-01-10' and b.page_index=0
join (values
  ('2027-01-11'::date, '3'::jsonb,
   '{"Start":"2027-01-01","End":"2027-12-31","Entitlement":21,"Used":3,"Reserved":3,"Available":15,"Requested":0,"Remaining":15}'::jsonb,
   '{"Start":"2027-01-01","End":"2027-12-31","Entitlement":21,"Used":6,"Reserved":0,"Available":15,"Requested":0,"Remaining":15}'::jsonb),
  ('2027-01-18'::date, '2'::jsonb,
   '{"Start":"2027-01-01","End":"2027-12-31","Entitlement":21,"Used":3,"Reserved":2,"Available":16,"Requested":0,"Remaining":16}'::jsonb,
   '{"Start":"2027-01-01","End":"2027-12-31","Entitlement":21,"Used":5,"Reserved":0,"Available":16,"Requested":0,"Remaining":16}'::jsonb)
) s(starts,days,pending,approved) on s.starts=p.start_date
where p.employee_id in ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002')
on conflict do nothing;
commit;
