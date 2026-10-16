# Leave workflow implementation guide

Dinah and Tess will deliver one employee request and second-user decision
workflow. Build against `portalClient` so the same screens work with Supabase
development data and the ERP API. No direct Supabase calls belong in screens.

## Assignments

### Dinah owns My Leave Request

Extend the existing profile, My Leave, request form, detail/edit and balance
screens. Do not build a parallel set of screens.

1. Show the signed-in employee's leave types and current balance.
2. Preview selected dates, requested days, validation and remaining balance.
3. Submit a request; display pending status and the saved application details.
4. Allow date/reason edits and withdrawal while pending only.
5. Show the approver's decision remarks and date on the details screen.
6. Refetch application/balance/history on manual refresh and when returning to
   the screen. A decision from another browser must become visible without
   signing out. Do not leave a stale balance after a local mutation.
7. Handle loading, empty states, missing access, invalid dates, failed requests
   and expired sessions. Disable duplicate submissions while saving.

Deliverable: Employee One can request leave, see it pending, then see Employee
Two's decision and the corresponding balance/history.

### Tess owns Leave Approval Inbox

Build a separate routed processing screen using the existing Operational
indigo page/header and gray list pattern, with centered pagination.

1. Fetch pending requests and display employee, type, dates and status.
2. Open details showing `Application` and `Preview` from processingApplication.
3. Provide approve/reject actions and a remarks field of at most 256 characters.
4. Refetch the queue after a decision; a processed request leaves Pending.
5. Provide an Approved view only when the backend allows it. Handle 403 without
   exposing records or offering a fake permission toggle.
6. Prevent self-approval in the UI for usability; SQL/ERP must enforce it too.
7. Refresh balance/history in the employee journey after the decision. Verify
   the supplied scenario values rather than adding leave calculations.

Deliverable: Employee Two can approve or reject Employee One's request. Employee
One cannot access processing by default; even a permitted user cannot decide
their own request. Decisions and fixture balance changes succeed or fail together.

## Client operations and ERP routes

Host: `https://fosa-api.ngrok.dev`. All protected ERP requests use a Bearer
token. Supabase mode instead signs in with Supabase Auth, with memory-only
sessions. Switch using `VITE_DATA_SOURCE=erp|supabase`, then restart/rebuild.

| Owner | Client operation | ERP endpoint relative to `/api` |
| --- | --- | --- |
| Dinah | `profile()` | GET `hr-portal/me` |
| Dinah | `leaveTypes()` | GET `hr-portal/me/leave-types` |
| Dinah | `applications(pageIndex)` | GET `hr-portal/me/leave-applications?pageIndex=0&pageSize=20` |
| Dinah | `application(id)` | GET `hr-portal/me/leave-applications/{id}` |
| Dinah | `balances({leaveTypeId, asAt, pageIndex})` | GET `hr-portal/me/leave-balances` with query fields |
| Dinah | `preview({leaveTypeId,start,end,excludedId?})` | GET `hr-portal/me/leave-preview` with query fields |
| Dinah | `submitLeave(body)` | POST `hr-portal/me/leave-applications` |
| Dinah | `updateLeave(id,body)` | PUT `hr-portal/me/leave-applications/{id}` |
| Dinah | `withdraw(id)` | POST `hr-portal/me/leave-applications/{id}/withdraw` |
| Tess | `processingApplications({status:1,pageIndex:0,pageSize:20})` | GET `hr-portal/processing/leave-applications` with query fields |
| Tess | `processingApplication(id)` | GET `hr-portal/processing/leave-applications/{id}` |
| Tess | `authorizeLeave(id,{decision,remarks})` | POST `hr-portal/processing/leave-applications/{id}/authorize` |

All three processing client methods are now implemented in both adapters. The
approval inbox UI remains Tess's work. Employee screens already exist and need
the refinements and acceptance checks above. See [full client models](PORTAL_CLIENT.md).

```js
const request = await portalClient.submitLeave({
  leaveTypeId: '20000000-0000-4000-8000-000000000001',
  start: '2027-01-11', end: '2027-01-13', reason: 'Development scenario',
});
// In the separately signed-in approver session:
const review = await portalClient.processingApplication(request.Id);
const saved = await portalClient.authorizeLeave(request.Id, {
  decision: 'approve', // or 'reject'
  remarks: 'Reviewed in the development workflow',
});
```

Do not share session tokens between users. Client methods return unwrapped DTOs.
Processing lists return `PageIndex`, `PageSize`, `TotalCount`, `TotalPages`,
`PageCollection`. Processing detail returns `{Application, Preview}`. A decision
returns the saved application, including `Status`, `AuthorizationRemarks` and
`AuthorizedDate`. Use `status:2` for the approved queue.

Status values: Pending 1, Approved 2, Rejected 4, Recalled 8, Withdrawn 16.
Employee transitions are pending edit/withdraw. Decisions are pending approve
or reject. Recall is outside this milestone.

## Supabase installation order

Use only the separate synthetic development project. Back up current test data.
These scripts have not been applied to your hosted project by the coding agent.

1. If not already applied, run
   [existing mirror adapter](../supabase/migrations/20261018000000_existing_mirror_adapter.sql).
   It retains mirror rows but changes direct-access grants. If already installed,
   do not rerun it after installing the workflow wrapper below.
2. Create confirmed Auth users `employee.one@example.test` and
   `employee.two@example.test` with privately assigned passwords.
3. Run [base seed](../supabase/seed.sql) if those fixed-ID test employees and
   fixtures do not already exist. It does not overwrite existing rows or links.
4. Run [leave workflow migration](../supabase/migrations/20261019000000_leave_workflow.sql)
   once. It wraps the existing RPC, adds operator-controlled processing grants,
   workflow fixtures and request-to-scenario links. It does not change payroll/P9.
5. Run [workflow seed](../supabase/seed-leave-workflow.sql). It grants Employee
   Two permissions 22017 and 22018; Employee One remains a requester only.
6. Run `NOTIFY pgrst, 'reload schema';`, then refresh the portal.

Do not execute migration files repeatedly as reset scripts. The workflow seed
is rerunnable and does not overwrite fixtures, grants or existing requests.
The seeded fixed-ID employees must exist; if Auth users are linked to different
existing employee rows, adapt the seed explicitly rather than reassigning them.

For existing profiles, set `employee_mirror.AuthUserId` to the correct Auth UUID.
`leave_application_mirror.employee_erp_id` must match employee `Id` as text. The
workflow migration's extra tables do not duplicate employee or application data.

For custom development identities, the SQL operator can grant permission:

```sql
-- Replace with the approver employee's Id, NOT the Supabase Auth user Id.
insert into public.portal_mirror_processing_permissions(employee_id,permission)
values ('APPROVER_EMPLOYEE_UUID',22017),
       ('APPROVER_EMPLOYEE_UUID',22018)
on conflict do nothing;
```

22017 permits the pending queue/decisions; 22018 permits the approved queue.
These are synthetic counterparts of ERP permissions, not Supabase login roles.
Users cannot assign these grants from the browser. ERP uses its own existing
role model. Processing is HR-wide, not scoped to manager teams.

## Balance scenarios

Select annual leave and **as-at 2027-01-10** in the balance screen. Both accounts
have an opening fixture: entitlement 21, used 3, reserved 0, available 18.

| Action | Used | Reserved | Available | Request status |
| --- | --- | --- | --- | --- |
| Opening | 3 | 0 | 18 | None |
| Request 11 to 13 January 2027 | 3 | 3 | 15 | Pending |
| Approve that request | 6 | 0 | 15 | Approved |
| Reject that request instead | 3 | 0 | 18 | Rejected |
| Withdraw while pending | 3 | 0 | 18 | Withdrawn |
| Edit pending dates to 18 to 19 January | 3 | 2 | 16 | Pending |
| Approve edited two-day request | 5 | 0 | 16 | Approved |

These explicit examples match the ERP balance shape and pending-reservation
semantics. They are not a general leave engine. SQL selects the matching full
snapshot and records it in the same transaction as the request/decision.
History includes the actual test request ID/status/reason plus seeded history;
charged day counts are taken from preview fixtures. Decision audit fields are
stored on the application. No emails or notifications are sent.
Submission/editing also requires another active employee-linked development
user with permission 22017, matching the ERP's separate-approver prerequisite.

### Deliberate fixture limits

- One active workflow request per employee and leave type, including an approved
  request. Do not test multiple concurrent allocations with this fixture set.
- Only the two successful seeded date ranges support the complete workflow.
  Other ranges need explicit workflow and preview fixtures.
- Editing stays within the same leave type in this development scenario.
- Balances update for the configured as-at date/page, not arbitrary dates/pages.
- History snapshots represent the configured scenario, not an accumulated ledger
  of every repeated test. The application list retains the saved request records.
- Preview fixtures remain fixed; they do not become a fresh calculation engine
  after approval. Use the balance endpoint to assert the decision outcome.
- Old mirror requests without a workflow link can be read in the queue but
  cannot be decided until the operator prepares a matching scenario.
- An approved scenario must be reset using disposable development records or
  another isolated test identity before a second successful scenario is run.
  Never manually reset a real ERP approval to repeat a test.

When extending scenarios, modify `portal_mirror_workflow_fixtures.states` with
complete pending/approved/rejected/withdrawn EmployeeLeaveStatistics payloads.
Do not derive annual entitlements, holidays or chargeable days in UI/SQL. Validate
the expected results against ERP before claiming real business-rule parity.

## Joint acceptance checklist

1. Use separate browser sessions for Employee One and Employee Two.
2. Check opening balance 18; submit the three-day request as Employee One.
3. Confirm pending status and reserved 3/available 15.
4. Confirm Employee One receives 403 when requesting the processing queue.
5. As Employee Two, review and approve with remarks. Confirm the request leaves
   the pending queue and appears in Approved.
6. Refresh Employee One's details/balance/history: approved, remarks/date,
   used 6/reserved 0/available 15. Confirm edit/withdraw are unavailable.
7. In a reset isolated scenario, reject instead: rejected, available 18.
8. Test pending edits and withdrawal with their expected snapshot values.
9. Test self-approval, unauthorized processing, repeated decisions and API errors.
10. Run `npm test` and `npm run check`, then submit separate PRs with screenshots,
    tested accounts/scenarios (no passwords), and remaining limitations.

The operator can run [SQL regression tests](../tests/leave-workflow.test.sql)
after seeding in the synthetic project. They roll back all test writes, including
temporary resets and permissions. Tests include rollback of a decision when its
balance fixture is incomplete. Do not run them against live employee records.

## Merge responsibilities

Dinah owns employee screens; Tess owns processing screens. Coordinate changes
to shared navigation, portalClient, SQL and fixtures before editing those files.
Do not implement a separate transport, approve through unrestricted table
updates, or add payslip/P9/requisitions to this milestone.

Before switching to ERP, verify real authenticated responses, separate approver
availability, ownership, transitions, balance calculations, concurrency and
notification behaviour using authorized test records. Passing fixture tests is
not evidence of live ERP integration.
