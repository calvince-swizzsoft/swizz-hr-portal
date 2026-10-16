-- TEMPORARY: mirror of the ERP `/api/hr-portal/me` employee profile response.
-- Lets the portal UI be built while the ERP HR portal APIs are being finished.
-- WebApplication1 remains the source of truth; drop this table once the portal uses the ERP API.
--
-- Column names are quoted PascalCase so Supabase returns exactly the same JSON shape as the ERP API
-- and screens need no mapping. "AuthUserId" is not part of the API response: it links a row to a
-- Supabase Auth user so each employee can read only their own record, like `/me`.

create table public.employee_mirror (
  "Id" uuid primary key default gen_random_uuid(),
  "AuthUserId" uuid unique references auth.users (id) on delete set null,
  "CustomerFullName" text,
  "CustomerIndividualFirstName" text,
  "CustomerIndividualPayrollNumbers" text,
  "CustomerAddressEmail" text,
  "CustomerAddressMobileLine" text,
  "EmploymentStartDate" date,
  "DepartmentDescription" text,
  "DesignationDescription" text,
  "BranchDescription" text,
  "EmployeeTypeDescription" text,
  "NationalSocialSecurityFundNumber" text,
  "NationalHospitalInsuranceFundNumber" text
);

comment on table public.employee_mirror is
  'TEMPORARY mirror of the ERP /api/hr-portal/me response for UI development. Not a source of truth.';

-- Employees can only read their own record; changes are made by HR in the Supabase dashboard,
-- matching the portal's read-only profile ("contact HR to correct your details").
alter table public.employee_mirror enable row level security;

revoke all on table public.employee_mirror from anon, authenticated;
grant select on table public.employee_mirror to authenticated;

create policy "Employees read their own mirror record"
  on public.employee_mirror
  for select
  to authenticated
  using ("AuthUserId" = (select auth.uid()));
