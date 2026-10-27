# Supabase development model

Contact updates use the optional
`migrations/20261021000000_profile_contact_self_service.sql` migration, applied
after the mirror adapter. It permits only own email/mobile updates and replaces
any earlier feature-branch profile function that allowed names. Run
`tests/profile-contact.test.sql` in the synthetic project for rollback-only
ownership and validation checks. Passwords/login email remain in Auth and are
not changed by contact updates.

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

These `.sql` files use PostgreSQL syntax for Supabase. If VS Code's MSSQL
extension reports SQL Server syntax errors in them, those diagnostics are false
positives; the workspace disables MSSQL IntelliSense error checking for this
reason. Run migrations in the Supabase SQL Editor, not against a SQL Server
connection.

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

After applying the optional leave workflow migration, also apply
`migrations/20261020000000_processing_queue_unlinked_rows.sql`. It excludes
processing rows whose employee profile is missing from the actionable queue,
reports their count, and prevents opening or deciding an unlinked request.

### Integrated migration order

Apply migrations in this order (skip already-applied versions):

1. `20261018000000_existing_mirror_adapter.sql`
2. `20261019000000_leave_workflow.sql`
3. `20261020000000_processing_queue_unlinked_rows.sql`
4. `20261020000001_profile_self_service.sql`
5. `20261021000000_profile_contact_self_service.sql`
6. `20261021000001_balance_fixture_edit.sql`
7. `20261022000000_balance_fixture_create.sql`
8. `20261023000000_approver_balance_fixtures.sql`
9. `20261024000000_leave_type_management.sql`
10. `20261025000000_leave_type_balance_dedup.sql`
11. `20261026000000_leave_type_settings.sql`
12. `20261027000000_allow_leave_requests_without_preview.sql`
13. `20261028000000_allow_requests_without_workflow_scenario.sql`
14. `20261029000000_fix_leave_type_creation_ambiguity.sql`
15. `20261030000000_leave_type_lifecycle_and_balance_edits.sql`

The contact self-service migration enforces email/mobile-only updates. The earlier profile
migration has been assigned a distinct version to avoid collision with the
queue migration. If your project already recorded version `20261020000000`,
inspect which of the two old branch scripts you applied: the version alone is
ambiguous. Run the missing queue/profile script manually as appropriate, then
the final contact-only migration; both old branch functions are replaceable.
Do not delete migration history or rerun the base wrapper migration as a reset.
No existing rows are deleted by these profile/queue upgrade scripts.

To enable approver editing and adding of employee balance fixtures, apply
`migrations/20261021000001_balance_fixture_edit.sql`,
`migrations/20261022000000_balance_fixture_create.sql`, then
`migrations/20261023000000_approver_balance_fixtures.sql` after the base adapter
and leave-workflow migrations. The final migration removes employee access to
the earlier fixture editor and restricts fixture changes to the approver
permissions for the selected request. The fixture editor version was moved to `20261021000001` to avoid a collision
with contact self-service. If the old fixture version was already applied,
inspect the applied scripts before recording the corrected version; preserve
existing migration history and mirror rows. The portal asks for cycle start/end dates
when adding a fixture.

The leave type management migration adds lowercase `compassionate leave`,
`maternity leave`, and `paternity leave` to the catalogue. The follow-up removes
duplicate eligibility links only, retaining type rows and all history. The
settings migration separates type creation (Settings) from balance setup
(Leave types): the approver creates a type without balances, then configures an
existing type by ID with explicit metadata, chosen as-at/cycle dates and
employee balance fixtures. The lifecycle migration lets approvers rename,
archive and restore types. Archiving removes eligibility so a type is no
longer offered for new requests, while preserving its mirror row, applications
and balance fixtures. Restoring re-enables it for unlocked employees. The same
migration allows an approver to edit a fixture for an existing as-at date;
fixture history and requested-day values are preserved. Duplicate names are
rejected during creation and rename; balance setup never attempts to create a
type. The migrations retain existing mirror rows, including capitalized
`Annual leave`, and fabricate no balance values. Give Tess the existing 22017
permission if she does not already have it; do not grant direct mirror-table
writes.
The no-preview migration allows submitting without a matching preview fixture.
The final migration also allows dates without workflow scenarios; leave-day and
balance/history transitions are not calculated when such scenario fixtures are
absent. Existing overlap, ownership, approver and self-approval checks remain.

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
In Supabase development mode, a permitted approver can edit an existing balance
fixture or add one for the request's employee/type from approval details. Apply
the migrations listed above. The RPC derives the target employee and leave
type from the selected application and checks the approver's 22017/22018 grant;
employees cannot call the fixture editor, and direct table writes remain
denied. The editor does not update ERP data.

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
| Balances | Annual leave, as-at `2027-01-10`, page 0 | Entitlement 21, used 3, available 18; one approved history row. Balance fixtures are date-specific; choose this fixture date in the balance screen. |
| Edit balance fixture | Authorized approver opens an employee's request | Edit entitlement, used, reserved and available for the request's employee and leave type. |
| Add balance fixture | Authorized approver opens a request with no fixture for the selected date | Create a fixture with explicit cycle dates and values for that employee and leave type. |
| New request | `2027-01-11` to `2027-01-13` | 3 fixture days; allowed unless overlapping |
| Pending edit | `2027-01-18` to `2027-01-19` | 2 fixture days |
| Insufficient balance | A range with a configured preview | CanSubmit false |
| Other dates | Unconfigured range | Request may be submitted; no preview or balance transition is calculated |
| Foreign application | Read/edit/withdraw | 404 and no mutation |
| Withdraw | Own pending request | Status 16; further editing denied |

## Set up your own development account

A newly linked account starts with no eligibility or fixtures, so the portal
shows "No leave types available", "No balance fixture matches this date and
page" and "No preview fixture matches these dates". To give one account usable
data, open `dev-user-setup.sql`, replace `YOUR-EMAIL` with the account's exact
email from Authentication > Users, and run the whole file in a new SQL Editor
query. Apply the adapter and leave-workflow migrations first.

For that account's employee it grants every existing leave type and, for each
type whose `source_payload` has an `Entitlement`, adds:

| Fixture | Value |
| --- | --- |
| Opening balance | As at `2027-01-10`: the type's entitlement, nothing used or reserved |
| Request `2027-01-11` to `2027-01-13` | 3 days; submittable if the entitlement covers it |
| Request `2027-01-18` to `2027-01-19` | 2 days; submittable if the entitlement covers it |
| After each request | Pending reserves the days, approved uses them, rejected or withdrawn returns to the opening balance |

Existing rows are kept; nothing is updated or deleted. If no linked employee
matches the email, it stops with an error and changes nothing. The result row
shows leave types, opening balances, request scenarios, types skipped for lacking
an entitlement, and `other_approvers`: leave requests can only be submitted when
at least one other active account has permission 22017. As with the seed, each
employee can have one active request per leave type, other dates cannot be
submitted, and balances are shown as at `2027-01-10`.

## Security and verification

Browser users cannot edit table rows directly. The security-definer RPC pins
its search path, derives identity from auth.uid(), allowlists profile/type
output, restricts mutations to own pending requests, and checks eligibility,
dates, reason length and overlap. Employee row locks serialize mutations. No
approval operation or notification delivery is provided; an operator prepares
approved/rejected synthetic scenarios separately.

Run `npm test` and `npm run check`. After optional seeding and applying the
base adapter, workflow, queue, no-preview and no-workflow-scenario migrations,
the SQL operator can run `tests/portal-schema.test.sql` in the development
project. Run `tests/leave-workflow.test.sql` only after the workflow,
approver-balance and no-workflow-scenario migrations are applied. Run
`tests/leave-type-management.test.sql` after all three leave type migrations
and the leave-type creation fix migration.
The SQL tests check identity,
ownership and transitions within a transaction and roll back all test writes.
They do not prove your hosted project's current policies or Auth configuration.

Reference: [client models](../docs/PORTAL_CLIENT.md), Supabase
[functions](https://supabase.com/docs/guides/database/functions) and
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
