-- OPTIONAL: give one existing development account leave types, opening balances and
-- leave-request scenarios. Use when a linked account shows "No leave types available",
-- "No balance fixture matches this date and page" or "No preview fixture matches these
-- dates". Run as the SQL operator in the synthetic development project after the adapter
-- and leave-workflow migrations. Change only the email below.
--
-- For that account's employee it adds:
--   * eligibility for every existing leave type;
--   * for each type with an Entitlement in source_payload, an opening balance fixture as at
--     2027-01-10 (entitlement from the leave type, nothing used or reserved);
--   * request scenarios 2027-01-11..2027-01-13 (3 days) and 2027-01-18..2027-01-19 (2 days):
--     a preview fixture plus pending/approved/rejected/withdrawn balance states, so the
--     account can request leave and an approver can decide it.
-- Rows that already exist are kept; nothing is updated or deleted. Fixture values are
-- synthetic examples, not ERP calculations.
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

-- Opening balance per eligible type with an entitlement; reused by the scenario states.
create temp table dev_user_balances on commit drop as
select s.employee_id, t.erp_id as leave_type_id, (t.source_payload->>'Entitlement')::numeric as entitlement,
  jsonb_build_object(
    'AsAt', '2027-01-10', 'Today', '2027-01-10', 'LeaveTypeDescription', t.description,
    'IsAccrued', coalesce((t.source_payload->>'IsAccrued')::boolean, false),
    'Balance', jsonb_build_object('Start', '2027-01-01', 'End', '2027-12-31',
      'Entitlement', (t.source_payload->>'Entitlement')::numeric, 'Used', 0, 'Reserved', 0,
      'Available', (t.source_payload->>'Entitlement')::numeric, 'Requested', 0,
      'Remaining', (t.source_payload->>'Entitlement')::numeric),
    'BalanceError', null, 'TakenDays', 0, 'UpcomingDays', 0, 'HistoryCount', 0, 'History', '[]'::jsonb) as payload
from dev_user_setup s
join public.portal_mirror_eligibility g on g.employee_id = s.employee_id
join public.leave_types_mirror t on t.erp_id = g.leave_type_id
where t.source_payload ? 'Entitlement';

insert into public.portal_mirror_balance_fixtures (employee_id, leave_type_id, as_at, page_index, payload)
select employee_id, leave_type_id, date '2027-01-10', 0, payload
from dev_user_balances
on conflict do nothing;

-- Request scenarios: weekday ranges after the opening balance date.
create temp table dev_user_scenarios on commit drop as
select b.employee_id, b.leave_type_id, b.entitlement, b.payload, s.starts, s.ends, s.days
from dev_user_balances b
cross join (values
  (date '2027-01-11', date '2027-01-13', 3),
  (date '2027-01-18', date '2027-01-19', 2)
) s(starts, ends, days);

insert into public.portal_mirror_preview_fixtures (employee_id, leave_type_id, start_date, end_date, payload)
select employee_id, leave_type_id, starts, ends,
  jsonb_build_object('RequestedDays', days, 'CanSubmit', entitlement >= days,
    'Error', case when entitlement >= days then null else 'Not enough leave remaining for these dates.' end,
    'Cycles', jsonb_build_array(jsonb_build_object('Start', '2027-01-01', 'End', '2027-12-31',
      'Entitlement', entitlement, 'Used', 0, 'Reserved', 0, 'Available', entitlement,
      'Requested', days, 'Remaining', entitlement - days))))
from dev_user_scenarios
on conflict do nothing;

-- Balance shown after each workflow transition; rejected/withdrawn return to the opening balance.
insert into public.portal_mirror_workflow_fixtures (employee_id, leave_type_id, start_date, end_date, states)
select employee_id, leave_type_id, starts, ends,
  jsonb_build_object(
    'pending', jsonb_set(jsonb_set(payload, '{Balance}', payload->'Balance'
      || jsonb_build_object('Reserved', days, 'Available', entitlement - days, 'Remaining', entitlement - days)), '{UpcomingDays}', to_jsonb(days)),
    'approved', jsonb_set(jsonb_set(payload, '{Balance}', payload->'Balance'
      || jsonb_build_object('Used', days, 'Available', entitlement - days, 'Remaining', entitlement - days)), '{UpcomingDays}', to_jsonb(days)),
    'rejected', payload,
    'withdrawn', payload)
from dev_user_scenarios
on conflict do nothing;

-- Summary shown in the SQL editor results.
select
  (select count(*) from public.portal_mirror_eligibility g join dev_user_setup s on s.employee_id = g.employee_id) as leave_types_available,
  (select count(*) from public.portal_mirror_balance_fixtures b join dev_user_setup s on s.employee_id = b.employee_id
     where b.as_at = date '2027-01-10' and b.page_index = 0) as balances_as_at_2027_01_10,
  (select count(*) from public.portal_mirror_preview_fixtures p join dev_user_setup s on s.employee_id = p.employee_id
     where p.start_date in (date '2027-01-11', date '2027-01-18')) as request_scenarios,
  (select count(*) from public.leave_types_mirror where not source_payload ? 'Entitlement') as types_skipped_without_entitlement,
  (select count(*) from public.portal_mirror_processing_permissions p join public.employee_mirror e on e."Id"::text = p.employee_id
     where p.permission = 22017 and not e."IsLocked" and e."AuthUserId" is not null
       and p.employee_id <> (select employee_id from dev_user_setup)) as other_approvers;

commit;
