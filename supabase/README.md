# Supabase development model

For second-user approval/rejection and balance snapshots, follow the optional
[leave workflow guide](../docs/LEAVE_WORKFLOW_GUIDE.md) after installing this base
adapter. It includes the additional migration, seed and acceptance tests.

The client uses your existing `employee_mirror`, `leave_types_mirror` and
`leave_application_mirror` tables. No second employee or leave database is
created. Use synthetic development data only. The existing `payslip_mirror` and
`p9_mirror` tables are preserved but are not yet exposed by portalClient.

## Apply the adapter migration

Run `migrations/20261018000000_existing_mirror_adapter.sql` as the project SQL
operator. It works with the supplied mirror schema and also creates those
three tables if missing in a clean development project. It adds metadata
columns, private compatibility views, eligibility/fixture tables, and the
`portal_dev_request` RPC used by the frontend. Existing rows are not copied or
deleted. Duplicate AuthUserId links or duplicate record IDs abort the migration
instead of guessing which record to use.

Review other consumers before applying: this migration enables RLS and revokes
direct anon/authenticated table grants on employee and leave tables. The portal
uses the authenticated RPC instead of those old public policies. Other apps
reading the tables directly may need changes. The supplied schema export did
not include policies, foreign keys or storage rules; verify those separately.
No migration has been applied to your hosted project by the coding agent.
The supplied policies include broad authenticated employee SELECT/UPDATE rules;
the migration removes those named temporary policies, retaining the existing
own-record policy while routing portal operations through the RPC. Supplied
payslip and P9 policies also allow every signed-in user to read all rows. Those
tables are not changed here; keep them synthetic until payroll ownership and
private file access have been implemented.

If you already applied the earlier `20261017000000_portal_contract.sql`, simply
apply the new migration. Its old `portal_dev_*` tables remain intact but unused.
Do not delete them until any useful synthetic data has been reviewed. That
superseded creation script is no longer part of the repository's setup.

## Login using an existing employee

1. Create a confirmed email/password user in Supabase Authentication > Users,
   or use one already created. Set passwords privately, never in SQL or Git.
2. Link that Auth user's UUID to the selected existing employee's `AuthUserId`.
   Copy the two actual UUIDs from the dashboards and run this as the operator:

```sql
update public.employee_mirror
set "AuthUserId" = 'ACTUAL_AUTH_USER_UUID'::uuid
where "Id" = 'ACTUAL_EMPLOYEE_UUID'::uuid
  and "AuthUserId" is null;
```

The placeholders must be replaced first. Confirm exactly one row was changed.
Do not overwrite an existing employee linkage without reviewing it.

3. Configure `.env`, restart Vite and sign in using the Auth user's email and
   password. The employee table stores profile data, not login passwords.

```dotenv
VITE_DATA_SOURCE=supabase
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_KEY
```

Sessions stay in memory. Reloading requires signing in again. An unlinked or
locked employee receives 403; there is no anonymous profile browsing.

## Existing field mapping

| Source | Client output |
| --- | --- |
| `employee_mirror.Id` | EmployeeProfile.Id |
| `employee_mirror.AuthUserId` | Server-side ownership only; never returned |
| PascalCase employee columns | Matching EmployeeProfile fields |
| `employee_mirror.IsLocked` added | Blocks access when true |
| `leave_types_mirror.erp_id`, `description` | LeaveType.Id, Description |
| `leave_types_mirror.source_payload` added | Explicit type metadata: Entitlement, IsAccrued, UnitType, UnitTypeDescription, ExcludeHolidays, ExcludeWeekends |
| `leave_application_mirror.erp_id` | LeaveApplication.Id |
| `employee_erp_id` | EmployeeId; must equal employee_mirror.Id as text |
| `leave_type_erp_id`, `leave_type_description` | LeaveTypeId, LeaveTypeDescription |
| `start_date`, `end_date`, `reason`, `status` | Start, End, Reason, Status |
| Added snapshot/audit/decision columns | BalanceSnapshot, CreatedDate, authorization/recall fields and NotificationPending |

Mirror text IDs are kept as text, including legacy values; use ERP UUIDs for new
fixtures intended to resemble ERP requests. `DEMO` employee rows do not belong to
a real UUID-linked profile and are not shown. Missing type metadata is returned
as null; populate it explicitly rather than inferring entitlement from names.
Added CreatedDate and BalanceSnapshot defaults are development defaults, not
historical ERP facts. Populate them from known synthetic source data as needed.
Existing source_payload and synced_at values are preserved and not shown as
employee-editable fields.

## Eligibility and fixtures

Grant an existing employee access to an existing leave type explicitly:

```sql
insert into public.portal_mirror_eligibility(employee_id, leave_type_id)
values ('ACTUAL_EMPLOYEE_UUID', 'ACTUAL_LEAVE_TYPE_ERP_ID')
on conflict do nothing;
```

`portal_mirror_balance_fixtures` is keyed by employee/type/as-at/page and holds
an EmployeeLeaveStatistics JSON payload. `portal_mirror_preview_fixtures` is
keyed by employee/type/start/end and holds a LeavePreview JSON payload. These
support the existing tables, not copied employee or application records.
They are static and do not recalculate when applications change.

## Optional synthetic seed

Create confirmed Auth users `employee.one@example.test` and
`employee.two@example.test` first, then run `seed.sql`. Passwords are chosen
privately. This adds two synthetic employees only if those Auth users are not
already linked, and never overwrites existing rows. If a user is already linked
to a different employee, configure eligibility/fixtures for that employee
explicitly instead of expecting the fixed-ID seed to change their linkage.

Both seeded employees receive leave type `20000000-0000-4000-8000-000000000001`.

| Scenario | Selection | Expected result |
| --- | --- | --- |
| Profile | Sign in as either employee | Own synthetic profile only |
| Balances | Annual leave, as-at `2027-01-10`, page 0 | Entitlement 21, used 3, available 18; one approved history row |
| New request | `2027-01-11` to `2027-01-13` | 3 fixture days; allowed unless overlapping |
| Pending edit | `2027-01-18` to `2027-01-19` | 2 fixture days |
| Insufficient balance | `2027-02-01` to `2027-03-01` | CanSubmit false |
| Other dates | Unconfigured range | CanSubmit false; no invented calculation |
| Foreign application | Read/edit/withdraw | 404 and no mutation |
| Withdraw | Own pending request | Status 16; further editing denied |

## Security and verification

Browser users cannot edit table rows directly. The security-definer RPC pins
its search path, derives identity from auth.uid(), allowlists profile/type
output, restricts mutations to own pending requests, and checks eligibility,
dates, reason length and overlap. Employee row locks serialize mutations. No
approval operation or notification delivery is provided; an operator prepares
approved/rejected synthetic scenarios separately.

Run `npm test` and `npm run check`. After optional seeding, the SQL operator can
run `tests/portal-schema.test.sql` in the development project. It checks identity,
ownership and transitions within a transaction and rolls back all test writes.
The automated local SQL checks use an isolated PostgreSQL-compatible runtime;
they do not prove your hosted project's current policies or Auth configuration.

Reference: [client models](../docs/PORTAL_CLIENT.md), Supabase
[functions](https://supabase.com/docs/guides/database/functions) and
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
