-- OPTIONAL: give one existing development account leave types and opening balances.
-- Use when a linked account shows "No leave types available" or "No balance fixture
-- matches this date and page". Run as the SQL operator in the synthetic development
-- project after the adapter migration. Change only the email below.
--
-- For that account's employee it adds eligibility for every existing leave type and,
-- for each type with an Entitlement in source_payload, an opening balance fixture as at
-- 2027-01-10 (entitlement from the leave type, nothing used or reserved). Rows that
-- already exist are kept; nothing is updated or deleted. Fixture values are synthetic
-- examples, not ERP calculations. Leave-request previews are not added.
begin;

create temp table dev_user_setup on commit drop as
select e."Id"::text as employee_id
from public.employee_mirror e
join auth.users u on u.id = e."AuthUserId"
where lower(u.email) = lower(trim('YOUR-EMAIL'));   -- <-- change only this email

do $$
begin
  if (select count(*) from dev_user_setup) <> 1 then
    raise exception 'No employee is linked to that email. Copy the exact email from Authentication > Users and check the account is linked (see "Login using an existing employee" in supabase/README.md).';
  end if;
end $$;

insert into public.portal_mirror_eligibility (employee_id, leave_type_id)
select s.employee_id, t.erp_id
from dev_user_setup s cross join public.leave_types_mirror t
on conflict do nothing;

insert into public.portal_mirror_balance_fixtures (employee_id, leave_type_id, as_at, page_index, payload)
select s.employee_id, t.erp_id, date '2027-01-10', 0,
  jsonb_build_object(
    'AsAt', '2027-01-10', 'Today', '2027-01-10', 'LeaveTypeDescription', t.description,
    'IsAccrued', coalesce((t.source_payload->>'IsAccrued')::boolean, false),
    'Balance', jsonb_build_object('Start', '2027-01-01', 'End', '2027-12-31',
      'Entitlement', (t.source_payload->>'Entitlement')::numeric, 'Used', 0, 'Reserved', 0,
      'Available', (t.source_payload->>'Entitlement')::numeric, 'Requested', 0,
      'Remaining', (t.source_payload->>'Entitlement')::numeric),
    'BalanceError', null, 'TakenDays', 0, 'UpcomingDays', 0, 'HistoryCount', 0, 'History', '[]'::jsonb)
from dev_user_setup s
join public.portal_mirror_eligibility g on g.employee_id = s.employee_id
join public.leave_types_mirror t on t.erp_id = g.leave_type_id
where t.source_payload ? 'Entitlement'
on conflict do nothing;

-- Summary shown in the SQL editor results.
select
  (select count(*) from public.portal_mirror_eligibility g join dev_user_setup s on s.employee_id = g.employee_id) as leave_types_available,
  (select count(*) from public.portal_mirror_balance_fixtures b join dev_user_setup s on s.employee_id = b.employee_id
     where b.as_at = date '2027-01-10' and b.page_index = 0) as balances_as_at_2027_01_10,
  (select count(*) from public.leave_types_mirror where not source_payload ? 'Entitlement') as types_skipped_without_entitlement;

commit;
