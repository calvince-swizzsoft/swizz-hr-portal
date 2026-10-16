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
- Leave types screen reading the `public.leave_types_mirror` mirror from Supabase.
- Submit, view, edit, and accept/reject synthetic rows in `public.leave_application_mirror`, including source payload and sync time.
- In Vite development mode, **Continue without signing in** opens profile, leave, leave types, and application screens without creating an ERP session. Personal profile/leave screens show empty states; the application form is not submitted.
- Personal leave list with paging, withdrawal, submission and server-calculated balance previews.
- Memory-only bearer token, explicit sign out and return to login on 401. Reloading requires sign-in.
- Responsive indigo interface, loading/error/empty states and cancellation of obsolete preview requests.

This is an initial portal project. HR processing screens, application editing/detail screens, dedicated balance/history views and notification retry UI can be added using the existing backend contracts. No employee identity is fabricated and no employee data is shown without authentication.

## Verify

```powershell
npm test
npm run check
```

`check` runs Vite development transforms; it does not produce production artifacts. No production build or hosting deployment is configured at this stage.

## API contracts

Backend specification: `C:\Users\ckoda\source\repos\Swift-Financials-FOSA\docs\api\hr-portal-api-spec.md`.

`VITE_API_BASE_URL` is the base prefix, including `/api`; it defaults to `/api`. Browser-exposed VITE variables must never contain secrets. For deployment, serve the portal and API under one HTTPS origin or explicitly configure the API's approved portal origin. Vite's proxy only applies in development.

The leave types screen reads `erp_id` and `description` from `public.leave_types_mirror` using `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Enable row-level security and grant the browser's `anon` role read-only access only if leave type names are intended to be public. Never use a Supabase service-role key in the browser.

The Vite development-only no-sign-in button is a UI shortcut only; it creates no employee identity and makes no employee profile or leave-list API calls. The application form inserts a clearly synthetic row into the Supabase mirror only (demo employee ID `DEMO`, pending status); it does not submit to the ERP, check balances, or notify HR. Production still requires ERP sign-in; the ERP remains authoritative for real leave requests and balance calculations.

The **Applications** screen reads, inserts, edits, and accepts/rejects `public.leave_application_mirror` rows using the Supabase anonymous/publishable key. Run [leave-application-mirror-test-access.sql](./supabase/leave-application-mirror-test-access.sql) only in a separate non-production project containing synthetic rows. The script permits anonymous select/update and inserts marked as `DEMO`; anyone with the project URL/key can read or edit every row. Never use this policy with real employee data or production. Accept/reject updates only the Supabase mirror (`2`/`Accepted`, `4`/`Rejected`); it does not update the ERP or perform an official approval workflow.

Before public rollout, strengthen backend login lockout/session revocation as discussed. Browser sign out currently removes the local token; it does not revoke an issued ERP JWT. No live business records have been submitted during scaffold verification.
