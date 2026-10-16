# HR portal project guidance

This is a standalone React frontend for the Swift Financials ERP. WebApplication1 is the API backend; do not introduce a second employee database or duplicate leave calculations in the browser.

- Temporary exception: while the ERP HR portal APIs are being finished, `VITE_EMPLOYEE_DATA_SOURCE=supabase` signs in with a Supabase Auth development user and shows an editable employee list and profiles from the Supabase `employee_mirror` table (`supabase/migrations/`). It mirrors the `/api/hr-portal/me` response shape, holds development test data only and is not a source of truth. Test payslips and P9 forms (`payslip_mirror`, `p9_mirror`, `hr-documents` bucket) follow the same rule: figures are typed-in test data that is only displayed, and the portal never calculates pay or tax. Do not add leave calculations or other business logic to it; remove it once the ERP APIs are available.
- Keep browser session tokens in memory. Never commit credentials or put secrets in VITE environment variables.
- Preserve employee ownership through the `/api/hr-portal/me` API contracts. HR processing permissions are enforced by the ERP.
- Follow the indigo Operational visual language: white page cards, indigo title bars, gray list wrappers and row cards, centered pagination.
- Use `npm test` and `npm run check` for routine development verification. Do not generate production build/deployment artifacts unless requested.
- Do not submit live leave requests, withdraw records, change passwords or trigger notifications during verification without explicit authorization for those actions.
- Document API configuration and missing UI workflows honestly in README.md. Do not fill empty states with invented employee data.

## Theme and design source of truth

The HR portal must resemble the current reactfosa ERP app in theme, colors, typography, component styling and interaction patterns. This is an ongoing requirement for all new screens and subsequent edits.

The canonical design guidance is maintained in `C:\Users\ckoda\Desktop\workrepos\reactfosa\reactfosa\CLAUDE.md`. Read its Design Language section before changing portal UI and inspect a canonical reference screen there. Keep that file as the source of truth rather than creating a competing design system here.

Use the Operational pattern by default for employee profile, leave, dashboard and related portal screens:

- Indigo primary actions (`indigo-600`, hover `indigo-700`) and indigo navigation/title bars (`indigo-800` / `indigo-900`).
- Gray neutrals, white page cards, established rounded corners and shadows, and system UI typography.
- Operational list wrappers, row cards, loading/empty/error states, and centered pagination.
- Consistent status colors: green for success/approved, amber for pending/warning, blue for information, red for rejected/destructive, and gray for neutral states.

The ERP also has a separate Administration visual pattern. Use it only for portal administration screens intentionally matching that area; do not mix its slate/table styling into Operational screens. Responsive layouts may adapt to the portal, while preserving the ERP's visual identity. Do not introduce a new brand palette or dark theme without an explicit request.
