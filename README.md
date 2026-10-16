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

Included: login, ERP initial-password change, read-only profile, eligible leave
types, own application list/details, request submission, pending edits and
withdrawal, balance/history and preview screens. Supabase passwords are managed
through its dashboard; it does not simulate the ERP initial-password workflow.

Balances and previews in Supabase are fixed scenarios, not live calculations.
They do not change when requests are submitted or withdrawn. Unknown preview
dates cannot be submitted; unknown balance scenarios return a clear error.
Synthetic notifications are not sent. Payroll/P9/requisitions and HR processing
screens are not implemented. The source models are aligned to the local ERP
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
