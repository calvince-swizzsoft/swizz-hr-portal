# Swift HR Portal

Employee self-service for the Swift Financials ERP. React screens use one
`portalClient` contract, backed by either WebApplication1 or an authenticated
Supabase development model. WebApplication1 remains the production source of
truth; Supabase contains synthetic test scenarios only.

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

Use an active employee-linked ERP account. `API_PROXY_TARGET` is used only by
the Vite development server; the default example points to local WebApplication1.
For hosted production, serve API and frontend under one HTTPS origin or configure
approved CORS origins and an appropriate `VITE_API_BASE_URL` including `/api`.
Failed ERP requests never fall back to Supabase. Switching sources requires a
restart/rebuild and a new sign-in, not changes to screen code.

## Implementation and ownership

- [Client operations and response models](docs/PORTAL_CLIENT.md)
- [Supabase schema and development scenarios](supabase/README.md)
- [Dinah and Tess leave workflow assignments and SQL](docs/LEAVE_WORKFLOW_GUIDE.md)
- `src/lib/portalClient.js`: selects one adapter for the application session.
- `src/lib/api.js`: ERP HTTP transport and error handling.
- `src/lib/supabasePortalClient.js`: Supabase Auth and development RPC adapter
  backed by the existing employee and leave mirror tables.
- `src/App.jsx`: employee screens; no direct Supabase calls.

Dinah owns profile and application details/editing/status. Tess owns balances,
history, previews and their validation states. Both should extend the shared
contracts and migrations before adding screen-specific database access.

Included: login, ERP initial-password change, profile (employees can edit their
own name, email and mobile in Supabase mode; editing is hidden in ERP mode until
an ERP endpoint exists), eligible leave
types, own application list (status only: leave type, dates and status; reasons,
decision remarks and the details/edit page are not shown), request submission,
withdrawal of pending requests, balance/history and preview screens. Pending
requests cannot be edited; withdraw and request again instead. Supabase passwords are managed
through its dashboard; it does not simulate the ERP initial-password workflow.

Balances and previews in Supabase are fixed scenarios, not live calculations.
They do not change when requests are submitted or withdrawn. Unknown preview
dates cannot be submitted; unknown balance scenarios return a clear error.
The **Remaining** section summarizes, for every eligible leave type and a chosen
as-at date, the entitlement, days taken, days pending and days remaining, using
the existing balances operation (no browser calculation). A summary box adds up
the remaining and pending days shown; each type is labelled running low at 3 or
fewer days and "none left" at 0. In Supabase mode the
figures come from balance fixtures, so only fixture dates such as `2027-01-10`
show values; with the leave-workflow migration they switch as a request becomes
pending, approved, rejected or withdrawn.

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
