# Portal client contract

Screens obtain a client from `createPortalClient` and do not import Supabase or
construct HTTP URLs. `VITE_DATA_SOURCE=erp|supabase` selects the complete source.
No per-operation fallback or automatic synchronization is supported.

## Operations

All methods return promises. Read methods accept `{ signal }` as the final
argument. Responses below are unwrapped values, not HTTP success envelopes.
IDs are UUID strings; dates use `YYYY-MM-DD`, timestamps use ISO strings.
Preserve PascalCase DTO field names and numeric status values across adapters.

| Operation | Input | Result | ERP path relative to `/api` |
| --- | --- | --- | --- |
| `login(body)` | `{ UserName, Password }`; sent as `{ userName, password }` | `{ token, userName, roles }` or ERP `requiresPasswordChange` result | POST `auth/login` |
| `confirmEmail(body)` | `{ UserId, Code }`; sent as `{ userId, code }` | API confirmation result | POST `auth/confirm-email` |
| `setToken(token)` | Login token | void; Supabase already holds its session | None |
| `clearToken()` | None | void or promise; callers may await | Local session cleanup |
| `changePassword(body)` | `{ UserName, CurrentPassword, NewPassword, ConfirmPassword }`; sent as `{ userName, currentPassword, newPassword, confirmPassword }` | Changes the password, then signs in with the new password and returns the login result; unsupported in synthetic mode | POST `auth/change-initial-password`, then `auth/login` |
| `changeInitialPassword(body)` | Same as `changePassword(body)` | Backward-compatible alias used by the first-login password flow | Same as `changePassword(body)` |
| `profile(options)` | None | EmployeeProfile | GET `hr-portal/me` |
| `updateProfile(changes)` | Nonempty object containing CustomerAddressEmail and/or CustomerAddressMobileLine | Saved EmployeeProfile | PUT `hr-portal/me` |
| `leaveTypes(options)` | None | LeaveType[] | GET `hr-portal/me/leave-types` |
| `applications(pageIndex=0, options)` | Zero-based page, fixed pageSize 20 | ApplicationPage | GET `hr-portal/me/leave-applications` |
| `application(id, options)` | Own application ID | LeaveApplication | GET `hr-portal/me/leave-applications/{id}` |
| `balances(query, options)` | `{ leaveTypeId, asAt, pageIndex=0 }` | EmployeeLeaveStatistics | GET `hr-portal/me/leave-balances` |
| `preview(query, options)` | `{ leaveTypeId, start, end, excludedId? }` | LeavePreview | GET `hr-portal/me/leave-preview` |
| `submitLeave(body)` | LeaveRequest | Saved LeaveApplication | POST `hr-portal/me/leave-applications` |
| `updateLeave(id, body)` | Own pending ID and LeaveRequest (`leaveTypeId`, `start`, `end`, `reason`); only pending applications can be edited. The edit form changes dates and reason while retaining the original leave type. | Saved LeaveApplication | PUT `/api/hr-portal/me/leave-applications/{id}` |
| `withdraw(id)` | Own pending ID | Saved LeaveApplication | POST `hr-portal/me/leave-applications/{id}/withdraw` |
| `retryNotification(id)` | Own application ID with `NotificationPending=true` | Updated notification/application result | POST `hr-portal/me/leave-applications/{id}/retry-notification`; no body |
| `processingApplications(query, options)` | `{ status:1 or 2, pageIndex:0, pageSize:20 }` | ApplicationPage; permission checked server-side | GET `hr-portal/processing/leave-applications` |
| `processingApplication(id, options)` | Processing application ID | `{ Application, Preview }` | GET `hr-portal/processing/leave-applications/{id}` |
| `processingBalanceFixture(args, options)` | `{ action:'get' or 'save', applicationId, asAt, pageIndex, Entitlement?, Used?, Reserved?, Available?, CycleStart?, CycleEnd? }` | EmployeeLeaveStatistics fixture; processing permission required, Supabase development only | None |
| `createLeaveType(args)` | `{ Description }` | `{ Id, Description, EmployeeCount }`; permission 22017 required, Supabase development only | None |
| `configureLeaveTypeBalance(args)` | `{ LeaveTypeId, Entitlement, IsAccrued, UnitType, UnitTypeDescription, ExcludeHolidays, ExcludeWeekends, AsAt, CycleStart, CycleEnd, Used, Reserved, Available }` | `{ Id, Description, EmployeeCount, AsAt }`; permission 22017 required, Supabase development only | None |
| `authorizeLeave(id, body)` | `{ decision:'approve' or 'reject', remarks }` | Saved LeaveApplication | POST `hr-portal/processing/leave-applications/{id}/authorize` |

`source`, `loginLabel` and `canEditProfile` are presentation metadata; screens
hide profile editing when `canEditProfile` is false. Both current adapters support
contact-only editing. In Supabase mode login uses an Auth email; ERP accepts its normal username.
Email confirmation and password changes are available through the ERP adapter
only. Supabase development passwords are managed in Supabase Auth. Do not
persist tokens in storage. No real credentials are supplied in code or seed SQL.

## Models

`EmployeeProfile`: `Id`, `CustomerFullName`, `CustomerIndividualFirstName`,
`CustomerIndividualLastName`, `CustomerIndividualPayrollNumbers`,
`CustomerAddressEmail`, `CustomerAddressMobileLine`, `EmploymentStartDate`,
`BranchId`, `BranchDescription`, `DepartmentId`, `DepartmentDescription`,
`DesignationId`, `DesignationDescription`, `EmployeeTypeId`,
`EmployeeTypeDescription`, `EmployeeTypeCategoryDescription`,
`NationalSocialSecurityFundNumber`, `NationalHospitalInsuranceFundNumber`.
Employment descriptions, contacts, statutory numbers and optional IDs can be null.

### Self service contact updates

Both adapters support `updateProfile` and expose `canEditProfile=true`. Only
`CustomerAddressEmail` and `CustomerAddressMobileLine` may be supplied. Names,
employee IDs, payroll, statutory and employment fields are HR-controlled; extra
fields cause 400 instead of being silently dropped. Values must be strings or
null; omitted fields stay unchanged. Null or blank/whitespace clears the selected
optional contact. The server trims strings. Email has a maximum length of 254
and requires a non-whitespace local part and dotted domain. Mobile must match
`^\+?[0-9 ()-]{7,20}$` after trimming.

```js
await portalClient.updateProfile({
  CustomerAddressEmail: 'contact@example.test',
  CustomerAddressMobileLine: '+254 700 123456',
});
```

ERP updates the authenticated employee's linked customer address, preserves
other address fields and records the modifying user/time. The employee and
customer must exist and be unlocked. This does not change the login email,
username, password, or send a notification. Supabase updates the linked mirror
row via `portal_dev_update_profile` with the same field/validation contract.
Apply `20261021000000_profile_contact_self_service.sql` after the mirror adapter.
It also replaces the earlier feature-branch function that allowed name changes.
Deploy the ERP assemblies before enabling an ERP editing UI against a hosted
API. The integrated profile editor sends only the two shared
PROFILE_EDITABLE_FIELDS, preserving HR-controlled names and identity.

`LeaveType`: `Id`, `Description`, `Entitlement` (number), `IsAccrued` (boolean),
`UnitType` (number), `UnitTypeDescription`, `ExcludeHolidays`, `ExcludeWeekends`.
The adapter returns only types eligible for the signed-in employee.

`LeaveRequest`:

```json
{
  "leaveTypeId": "20000000-0000-4000-8000-000000000001",
  "start": "2027-01-11",
  "end": "2027-01-13",
  "reason": "Test request"
}
```

Reason: nonblank, at most 256 characters. Never accept employee IDs, balances,
approval fields or arbitrary statuses from employee input. Server identity wins.

`LeaveApplication`: `Id`, `EmployeeId`, `EmployeeName`, `LeaveTypeId`,
`LeaveTypeDescription`, `Start`, `End`, `Reason`, `Status`, `StatusDescription`,
`BalanceSnapshot`, `CreatedDate`, `AuthorizationRemarks`, `AuthorizedDate`,
`RecallRemarks`, `RecalledDate`, `EffectiveReturnDate`, `NotificationPending`.
Decision/recall fields can be null. `BalanceSnapshot` is a saved numeric balance,
not a substitute for current preview/balance requests.

`ApplicationPage`: `PageIndex`, `PageSize`, `TotalCount`, `TotalPages`,
`PageCollection` (LeaveApplication[]). Empty page: empty array, count/pages zero.
The Supabase processing queue may additionally return `InvalidCount` for
pending/approved mirror rows with no employee profile; those rows are excluded
from actionable results and cannot be opened or decided.

`LeavePreview`: `RequestedDays` (number), `CanSubmit` (boolean), `Error` (nullable
string), `Cycles` (LeaveCycleBalance[]).

`LeaveCycleBalance`: `Start`, `End`, `Entitlement`, `Used`, `Reserved`, `Available`,
`Requested`, `Remaining` (all quantities numeric).

`EmployeeLeaveStatistics`: `AsAt`, `Today`, `LeaveTypeDescription`, `IsAccrued`,
`Balance` (nullable LeaveCycleBalance), `BalanceError` (nullable string),
`TakenDays`, `UpcomingDays`, `HistoryCount`, `History` (EmployeeLeaveHistory[]).
History page size is 10. Do not use application-list paging fields here.

`EmployeeLeaveHistory`: `Id`, `Start`, `End`, `Status`, `ChargedDaysInYear`,
`EffectiveReturnDate`, `Reason`, `AuthorizedBy`.

## Status and ownership

| Value | Status | Employee transitions |
| --- | --- | --- |
| 1 | Pending | Edit allowed; withdrawal to 16 allowed |
| 2 | Approved | Read-only |
| 4 | Rejected | Read-only |
| 8 | Recalled | Read-only |
| 16 | Withdrawn | Read-only |

ERP permissions control real approvals/recalls. The processing methods require
22017 for pending decisions and 22018 for the approved queue. With the optional
leave-workflow migration, Supabase enforces equivalent development grants and
self-approval prevention. The separately permission-gated processing inbox is
not shown to employees without queue access. See the
[workflow guide](LEAVE_WORKFLOW_GUIDE.md) for SQL and fixture limitations.
The inbox UI is routed at `/processing/leave-applications`; its pending and
approved tabs request statuses 1 and 2, respectively, with zero-based
`pageIndex` and `pageSize=20`. Each row opens
`/processing/leave-applications/{id}`, which displays the processing
application and preview. The legacy `/approvals` path redirects to the inbox.

## Errors and limitations

Adapters reject with `ApiError` carrying `message`, `status`, `code` and nullable
`correlationId`. `AbortError` remains distinct. HTTP mappings: 400 validation,
401 session invalid/expired, 403 inactive/unlinked identity or foreign preview,
404 missing/foreign application. A 401 clears portal UI identity. Supabase
transport failures are sanitized; unexpected SQL failures are not shown raw.

Synthetic fixtures do not recalculate balances, apply calendar rules, accrue
entitlements, enqueue notifications or prove approval availability. Requests
can be submitted without a matching preview fixture; unknown previews report
`PreviewAvailable=false`, `CanSubmit=true`, and zero calculated days/balance.
Leave-request writes still check ownership, eligibility, pending status,
reason/date formats and overlap. The development workflow wrapper also requires
a matching workflow scenario for balance/history transitions; approvers may still
decide a request without one, but synthetic balances will not change.
Submitting or withdrawing requests without workflow fixtures does not
recalculate balance fixtures. Test real ERP calculations,
concurrency, approval availability and notification handling separately before
switching live.

In Supabase development mode, a user with processing permission can edit or
create a fixture for the employee and leave type attached to a selected request
from the approval details screen. Fixture lookup and writes require the
application ID; the RPC derives the employee/type from that request, requires
the matching 22017/22018 permission, and rejects editing one's own request.
New fixtures require cycle start/end dates containing the as-at date. Values
must be nonnegative numbers; `Available` is mirrored to `Remaining` and `Used`
to `TakenDays`. This does not update ERP balances; the ERP adapter rejects this
development-only operation.

The signed-in **Settings** page changes ERP passwords through the authenticated
`auth/change-initial-password` operation and re-authenticates to replace the
in-memory token. The strength indicator is informational; the backend remains
the password-policy authority. Password changes remain unsupported by the
Supabase development adapter. Theme and employee preferences are saved locally
in the browser (preferences are keyed by sign-in name and are not
synced across devices). Settings displays the authenticated user's `/me`
profile and links to the existing contact-only update form. No API is defined
for last-login data, active sessions, session revocation, two-factor setup,
recovery links, privacy/terms URLs, or HR/IT support contacts; the UI explains
those limitations without fake controls or details.

Approvers with permission 22017 create leave types under **Settings** using
`createLeaveType`. The operation rejects duplicate names and does not create
balances. **Leave types** uses `configureLeaveTypeBalance` to configure an
existing type by ID, without attempting to create it again. It adds an
all-employee fixture for the chosen as-at date and updates that type's metadata;
resaving an existing date edits its values while preserving fixture history and
requested-day values. Settings also uses `manageLeaveTypes` to rename, archive
or restore types. Archiving removes eligibility for new leave requests but
preserves the type row, applications and balance fixtures. These writes
stay in the development mirrors and never update ERP. Leave submissions do not need a
matching preview fixture; without one, requested days and balance are not
calculated. The deduplication migration removes only redundant eligibility
links and preserves mirror/history rows, including capitalized `Annual leave`.

The optional workflow migration switches explicitly configured balance snapshots
atomically on submit/edit/withdraw/approve/reject. It does not recalculate
previews or support arbitrary multi-request balance scenarios.

## Changing sources

Set `VITE_DATA_SOURCE=erp`, configure API URL/proxy, restart/rebuild and sign in
with an ERP account. No screen changes or synthetic data import is needed.
Compare actual ERP responses with these contracts using authorized test users.
Do not claim live contract verification from offline fixture tests alone.

The employee UI offers Dashboard, My Profile, Leave Management, Apply for
Leave, My Leaves and Help & Support. Help & Support provides guidance for
existing portal workflows. Other employee tools are not currently included.
Payslip/P9 remain outside the shared client until ownership and ERP contracts
are defined.
