grant select (
  "Id", "CustomerFullName", "CustomerIndividualFirstName", "CustomerIndividualPayrollNumbers",
  "CustomerAddressEmail", "CustomerAddressMobileLine", "EmploymentStartDate", "DepartmentDescription",
  "DesignationDescription", "BranchDescription", "EmployeeTypeDescription",
  "NationalSocialSecurityFundNumber", "NationalHospitalInsuranceFundNumber"
) on table public.employee_mirror to anon;

create policy "TEMPORARY public read of test employee data"
  on public.employee_mirror
  for select
  to anon
  using (true);
