# Swift HR Portal

Standalone React + Vite frontend for WebApplication1's HR portal APIs. Uses the ERP user store and database through the API; no separate backend or database.

## Theme and colors

The portal must resemble the current **reactfosa ERP app** in theme, colors and component styling. Its canonical design reference is `C:\Users\ckoda\Desktop\workrepos\reactfosa\reactfosa\CLAUDE.md` (Design Language section).

Employee-facing screens follow the ERP's Operational pattern: indigo branding and primary actions, gray neutrals, white page cards, matching typography, status colors, list rows and pagination. The separate Administration pattern is reserved for screens intentionally matching ERP administration. Detailed contributor requirements are recorded in [AGENTS.md](./AGENTS.md).

## Run locally

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Open http://127.0.0.1:5174. Start WebApplication1 separately. Its project config uses http://localhost:58240; change `API_PROXY_TARGET` in `.env` if your running API uses another address. The development proxy avoids browser cross-origin configuration. No credentials are included in this project.

## Included

- Existing ERP login and initial password-change flow.
- Employee linkage/access validation using `/api/hr-portal/me`.
- Read-only employee profile.
- Personal leave list with paging, withdrawal, submission and server-calculated balance previews.
- Memory-only bearer token, explicit sign out and return to login on 401. Reloading requires sign-in.
- Responsive indigo interface, loading/error/empty states and cancellation of obsolete preview requests.

This is an initial portal project. HR processing screens, application editing/detail screens, dedicated balance/history views and notification retry UI can be added using the existing backend contracts. No mock employee or leave data is used.

## Verify

```powershell
npm test
npm run check
```

`check` runs Vite development transforms; it does not produce production artifacts. No production build or hosting deployment is configured at this stage.

## API contracts

Backend specification: `C:\Users\ckoda\source\repos\Swift-Financials-FOSA\docs\api\hr-portal-api-spec.md`.

`VITE_API_BASE_URL` is the base prefix, including `/api`; it defaults to `/api`. Browser-exposed VITE variables must never contain secrets. For deployment, serve the portal and API under one HTTPS origin or explicitly configure the API's approved portal origin. Vite's proxy only applies in development.

## Supabase (optional)

`@supabase/supabase-js` is installed and `src/lib/supabase.js` exports a client that is `null` unless `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (or the legacy `VITE_SUPABASE_ANON_KEY`) are set in `.env`. Check `isSupabaseConfigured` before use. No screen uses it yet.

- Supabase is not a source of truth for employee, profile or leave data; those stay on WebApplication1 and its `/api/hr-portal/me` contracts.

### Temporary employee mirror

Until the ERP HR portal APIs are ready, the portal can show test employee records from a Supabase `employee_mirror` table whose columns use the `/api/hr-portal/me` response field names, so the profile screen needs no mapping.

1. Run `supabase/migrations/20261016000000_employee_mirror.sql`, then `supabase/migrations/20261016010000_employee_mirror_public_read.sql`, in the Supabase SQL editor.
2. Add test rows in Table Editor → `employee_mirror`.
3. Set `VITE_EMPLOYEE_DATA_SOURCE=supabase` in `.env` and restart `npm run dev`.

The portal then opens on an Employees list (20 per page) with a profile page per employee, and no sign-in. The second migration makes the table readable by anyone with the publishable key, so use test data only, never real employee records. Its header shows how to undo it.

Limitations: the ERP API currently has only the signed-in employee's `/me` profile, not an employee list, so the list screen has no matching ERP contract yet. A real directory would need a new ERP endpoint with HR permissions enforced by the ERP. Leave screens are not shown in this mode. The columns cover the fields the profile screen uses today; the full API specification was not available, so add columns from a real `/api/hr-portal/me` response as needed. Remove the mirror once the ERP API is available.
- Only the public publishable (or legacy anon) key may be used. It is visible in the browser, so access must be restricted with Row Level Security policies in Supabase. Never put a secret or `service_role` key in a VITE variable.
- Supabase sessions are not persisted to browser storage, matching the portal's memory-only token rule. Supabase auth is separate from ERP login.

Before public rollout, strengthen backend login lockout/session revocation as discussed. Browser sign out currently removes the local token; it does not revoke an issued ERP JWT. No live business records have been submitted during scaffold verification.
