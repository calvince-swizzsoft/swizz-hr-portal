-- TEMPORARY, DEVELOPMENT TEST DATA ONLY: replaces public access to employee_mirror with access for
-- signed-in Supabase Auth users. Any signed-in user can read every row and edit every column
-- except "Id" and "AuthUserId". The ERP has no employee list or update API yet, so this has no ERP equivalent.
-- Safe to run more than once.
--
-- To undo:
--   drop policy "TEMPORARY signed-in read of test employee data" on public.employee_mirror;
--   drop policy "TEMPORARY signed-in edit of test employee data" on public.employee_mirror;
--   revoke update on table public.employee_mirror from authenticated;

-- Remove public (not signed-in) access.
drop policy if exists "TEMPORARY public read of test employee data" on public.employee_mirror;
drop policy if exists "TEMPORARY public edit of test employee data" on public.employee_mirror;
revoke all on table public.employee_mirror from anon;

-- Signed-in users can read all rows (the first migration already grants select to authenticated).
drop policy if exists "TEMPORARY signed-in read of test employee data" on public.employee_mirror;
create policy "TEMPORARY signed-in read of test employee data"
  on public.employee_mirror
  for select
  to authenticated
  using (true);

-- Signed-in users can edit the profile columns.
grant update (
  "CustomerFullName", "CustomerIndividualFirstName", "CustomerIndividualPayrollNumbers",
  "CustomerAddressEmail", "CustomerAddressMobileLine", "EmploymentStartDate", "DepartmentDescription",
  "DesignationDescription", "BranchDescription", "EmployeeTypeDescription",
  "NationalSocialSecurityFundNumber", "NationalHospitalInsuranceFundNumber"
) on table public.employee_mirror to authenticated;

drop policy if exists "TEMPORARY signed-in edit of test employee data" on public.employee_mirror;
create policy "TEMPORARY signed-in edit of test employee data"
  on public.employee_mirror
  for update
  to authenticated
  using (true)
  with check (true);
