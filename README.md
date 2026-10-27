# Swift HR Portal

Employee self-service for the Swift Financials ERP. React screens use one
`portalClient` contract, backed by either WebApplication1 or an authenticated
Supabase development model. WebApplication1 remains the source of truth; the
Supabase adapter contains synthetic test scenarios only. API mode is the
default.

## Start

Requires Node >=22.12.0.

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

Open http://127.0.0.1:5174. Choose exactly one data source in `.env` and restart
Vite after changes. Never put credentials, service-role keys, or signing secrets
in browser-exposed `VITE_` variables.

### Supabase development

```dotenv
VITE_DATA_SOURCE=supabase
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_KEY
```

Follow [Supabase setup](supabase/README.md) to execute migrations, create test Auth
users, and load the synthetic seed. Sign in using a test user's email/password.
There is no anonymous development login or unrestricted employee directory.
Sessions stay in memory; reloading requires signing in again.

### ERP integration

```dotenv
VITE_DATA_SOURCE=erp
VITE_API_BASE_URL=/api
API_PROXY_TARGET=https://fosa-api.ngrok.dev
```

The login screen calls `POST /api/auth/login`; email confirmation calls
`POST /api/auth/confirm-email`; initial and signed-in password changes call
`POST /api/auth/change-initial-password`. The browser sends the documented
camelCase JSON request fields. After a successful password change, the portal
signs in again with the new password to obtain a fresh session token. Use an
active employee-linked ERP account.
`API_PROXY_TARGET` is used only by the Vite development server.
For hosted production, serve API and frontend under one HTTPS origin or configure
approved CORS origins and an appropriate `VITE_API_BASE_URL` including `/api`.
Failed ERP requests never fall back to Supabase. Switching sources requires a
restart/rebuild and a new sign-in, not changes to screen code.

### Testing the ERP API in Postman

Import `docs/postman/swift-hr-portal-erp.postman_collection.json` into Postman.
It contains core ERP requests for the portal, against
`https://fosa-api.ngrok.dev/api`. In the collection's Variables tab, enter
`username` and `password` as local, unshared values, then run
**1. Auth > Sign in**: it stores the session token
for all other requests. A temporary password returns `requiresPasswordChange`;
set `newPassword` and run **Change initial password**. Accounts whose email is
not yet confirmed cannot sign in until an ERP administrator confirms them.

| Folder | Requests | Changes data? |
| --- | --- | --- |
| 1. Auth | Sign in, change initial password | Change password only |
| 2. My profile | Get my profile | No |
| 3. My leave | Leave types, applications, one application, balance, preview | No |
| 4. LIVE CHANGES | Update contact details, submit, edit, withdraw leave | **Yes – live ERP** |
| 5a. Approvals | Pending (22017), approved (22018), one request | No |
| 5b. LIVE APPROVAL & RECALL | Approve or reject, recall approved leave | **Yes – live ERP** |

Run **Change initial password**, folder 4, and folder 5b only with explicit
authorization for that action. Do not run the entire collection against live ERP.
Clear passwords and tokens before exporting or sharing the collection; never
commit populated credentials.

## Implementation and ownership

- [Client operations and response models](docs/PORTAL_CLIENT.md)
- [Supabase schema and development scenarios](supabase/README.md)
- [Dinah and Tess leave workflow assignments and SQL](docs/LEAVE_WORKFLOW_GUIDE.md)
- `src/lib/portalClient.js`: selects one adapter for the application session.
- `src/lib/api.js`: ERP HTTP transport and error handling.
- `src/lib/supabasePortalClient.js`: optional Supabase Auth and development RPC adapter
  backed by the existing employee and leave mirror tables.
- `src/App.jsx`: employee screens; no direct Supabase calls.

The employee self-service screens and leave application inbox use the shared
portal client. Approvers use `/processing/leave-applications` for pending and
approved requests and `/processing/leave-applications/{id}` for application
details and preview. Processing access and decisions are enforced by the ERP
or the synthetic Supabase development RPC; the UI does not grant approval
permissions.

The employee sidebar provides Dashboard, My Profile, Leave Management, Apply
for Leave and My Leaves. Apply for Leave is a separate form;
only My Leaves displays the employee's request list and statuses. Dashboard shortcuts use the
signed-in employee's own profile; the leave application list uses the
employee-scoped API.

Settings includes an authenticated ERP password change with show/hide controls,
password-match validation and a non-authoritative strength estimate; the HR
authentication API applies its own password policy. Theme (Light, Dark or
System) is stored in the browser. Account preferences (language, display name
and accessibility options) are stored locally per sign-in name and do not sync
across devices. Employee
account details in Settings come from the authenticated `/api/hr-portal/me`
profile; email and phone edits use the existing contact-only profile API.
Session management, two-factor setup, last-login data, password recovery links,
privacy/terms URLs and support contacts are not provided by the configured
services, so Settings does not simulate them.

The dashboard provides quick access to leave requests, My Profile and
**Help & Support**. Help & Support provides guidance for current portal
workflows. Other employee tools are not currently included in the portal.
Payslip/P9 remain outside the shared client until their ownership and ERP
contracts are defined.

Included: login, ERP initial and signed-in password changes, contact-only profile editing in both
data sources, eligible leave types, own application list showing leave type,
dates and status, request submission, withdrawal of pending requests,
balance/history and preview screens, and pending/approved approvals with details
and decisions. The employee details/edit page is hidden; withdraw a pending
request and request again instead. Supabase passwords are managed through its
dashboard; it does not simulate the ERP initial-password workflow.

Both adapters now support contact-only `updateProfile` (email/mobile) matching
ERP `PUT /api/hr-portal/me`. Names and employment details remain HR-controlled.
Deploy the updated backend assemblies before using ERP editing on a hosted API.
See the client contract for validation, deployment and migration requirements.

Balances and previews in Supabase use fixed scenarios, not live calculations.
The workflow migration selects predefined balance snapshots on request/decision
changes; preview fixtures remain fixed. Approvers can edit or add employee balance fixtures from approval details after applying the fixture migrations; employees cannot edit fixtures, and fixture edits never update ERP data. Unknown preview
dates cannot be submitted; unknown balance scenarios return a clear error.
The **Remaining** section summarizes, for every eligible leave type and a chosen
as-at date, the entitlement, days taken, days pending and days remaining, using
the existing balances operation (no browser calculation). A summary box adds up
the remaining and pending days shown; each type is labelled running low at 3 or
fewer days and "none left" at 0. In Supabase mode the
figures come from balance fixtures, so only fixture dates such as `2027-01-10`
show values; with the leave-workflow migration they switch as a request becomes
pending, approved, rejected or withdrawn.

In Supabase development mode, an approver with permission 22017 creates
synthetic leave types in **Settings**. **Leave types** lists each type once and
provides the separate **Set up balance** action for existing types. The
development migration adds **compassionate leave**, **maternity leave**, and
**paternity leave** to the catalogue and makes them eligible for unlocked
employees. Balance setup requires explicit metadata, an as-at date, cycle
start/end and balance values; no numeric entitlement is invented. Dates are
selectable and are not fixed to January 2027; employees choose the fixture's
as-at date to view it. Approvers can set up another balance fixture for any
existing type and chosen date, including types that already have entitlement
metadata. Existing fixtures for a chosen date can be edited by saving the
updated values; balance history is retained. Settings also allows approvers to
rename, archive and restore leave types. Archiving prevents new requests while
preserving existing applications and fixtures. Settings is available to every
signed-in user for account preferences and password changes; Supabase
development password changes remain managed in Supabase Auth. Theme is
browser-persisted; language, display name and accessibility preferences are
saved per sign-in name on the current device. The balances screen initially selects today's date; if no fixture
exists for it, choose the fixture's as-at date or ask an approver to set one up
from **Leave types**. This does not affect ERP data.
The existing **Annual leave** development fixture remains 21 days and the
leave-types list shows its yearly entitlement.

Apply the new type and balance migrations in order:
[`20261024000000_leave_type_management.sql`](supabase/migrations/20261024000000_leave_type_management.sql),
[`20261025000000_leave_type_balance_dedup.sql`](supabase/migrations/20261025000000_leave_type_balance_dedup.sql),
[`20261026000000_leave_type_settings.sql`](supabase/migrations/20261026000000_leave_type_settings.sql),
[`20261027000000_allow_leave_requests_without_preview.sql`](supabase/migrations/20261027000000_allow_leave_requests_without_preview.sql),
[`20261028000000_allow_requests_without_workflow_scenario.sql`](supabase/migrations/20261028000000_allow_requests_without_workflow_scenario.sql),
[`20261029000000_fix_leave_type_creation_ambiguity.sql`](supabase/migrations/20261029000000_fix_leave_type_creation_ambiguity.sql),
[`20261030000000_leave_type_lifecycle_and_balance_edits.sql`](supabase/migrations/20261030000000_leave_type_lifecycle_and_balance_edits.sql),
then [`20261031000000_restore_explicit_fixture_guards.sql`](supabase/migrations/20261031000000_restore_explicit_fixture_guards.sql),
after the existing-mirror, workflow and approver-balance migrations. These keep
the capitalized **Annual leave** mirror row and history; duplicate
case-insensitive type rows are removed from employee eligibility without
deleting their underlying records. The final migration installs separate
Settings/create and existing-type balance operations and removes the old
combined operation. The lifecycle migration supports type renaming, reversible
archiving, restoring, and editing balance fixtures for an existing date. The
final fixture-guard migration supersedes the permissive no-preview/no-workflow
migrations: requests require explicit preview and workflow scenarios.

Tess must have the existing `22017` leave-approver permission to manage
development leave types and balances in Settings. General account settings are
available to all signed-in users. The SQL migration must be run in Supabase; the
portal does not apply migrations automatically.

On the leave form, employees can select start and end dates independently of
balance fixtures; changing the leave type no longer clears those dates. In
Supabase mode, submission requires matching preview and workflow fixtures.
Unknown dates are blocked without inventing leave days or balance transitions;
overlap checks still apply.
Existing balance fixtures are preserved.

The leave form also has a draft-only work handover section. The coworker
directory and supporting-document upload are not connected to the HR service,
so handover notes and selected files are not saved or sent. Submitting a leave
request is blocked while handover notes or a file are present; clear them to
submit without handover details.

Approver accounts: after sign-in the portal asks whether the user may read the
pending processing queue (permission 22017). If so, the sidebar adds a
**Leave approvals** section with **Approvals** next to the employee pages, and
the user lands on Approvals after sign-in. Approvers never see their own requests
in the queue; page counts still include them because the server counts them.
Everyone else gets the employee pages without Approvals.
This only selects screens; the ERP or development RPC enforces all permissions.

Synthetic notifications are not sent. The **Approvals** section lists pending and
approved leave and lets a permitted approver approve or reject with remarks. It
uses the existing processing operations: permission (22017 pending, 22018
approved) and self-approval are enforced by the ERP or the leave-workflow
migration, and users without permission see a denial with no records. In
Supabase mode, apply `supabase/migrations/20261019000000_leave_workflow.sql` and
grant permissions as in the [workflow guide](docs/LEAVE_WORKFLOW_GUIDE.md).
Payroll/P9/requisitions screens are not implemented. The source models are aligned to the local ERP
controller/DTO definitions, but live authenticated integration must still be
verified before rollout.

## Verify

```powershell
npm test
npm run check
```

Tests cover HTTP/Supabase adapter contracts and failure handling without live
business writes. The Supabase setup guide includes isolated SQL tests for
ownership and mutation constraints. `check` runs development transforms, not a
production build. Never verify against live submissions, withdrawals, password
changes or notifications without explicit authorization.

## Theme

Follow the reactfosa Operational design language in
`C:\Users\ckoda\Desktop\workrepos\reactfosa\reactfosa\CLAUDE.md`:
indigo navigation/title bars/actions, white page cards, gray list wrappers,
consistent status colors, system typography and centered pagination. Details
are in [AGENTS.md](AGENTS.md).
