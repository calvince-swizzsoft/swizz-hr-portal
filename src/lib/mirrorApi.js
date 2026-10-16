import { ApiError } from './api.js';

// TEMPORARY stand-in for the ERP HR portal API while its endpoints are being finished.
// Signs in with Supabase Auth, then reads and edits test employee data in the Supabase `employee_mirror` table,
// and reads test payslips and P9 forms from `payslip_mirror`, `p9_mirror` and the `hr-documents` storage bucket.
// The session is kept in memory only (see src/lib/supabase.js).
// Employee rows use the ERP `/api/hr-portal/me` response field names, so screens need no mapping.
// Payslip and P9 field names are provisional until the ERP payroll API contract is known.
const PROFILE_COLUMNS = [
  'Id', 'CustomerFullName', 'CustomerIndividualFirstName', 'CustomerIndividualPayrollNumbers',
  'CustomerAddressEmail', 'CustomerAddressMobileLine', 'EmploymentStartDate', 'DepartmentDescription',
  'DesignationDescription', 'BranchDescription', 'EmployeeTypeDescription',
  'NationalSocialSecurityFundNumber', 'NationalHospitalInsuranceFundNumber',
].join(',');
// Each document row includes its employee's name and payroll number, looked up through the EmployeeId link.
const DOCUMENT_EMPLOYEE = 'Employee:employee_mirror(Id,CustomerFullName,CustomerIndividualPayrollNumbers)';
const PAYSLIP_COLUMNS = `Id,Year,Month,GrossPay,TotalDeductions,NetPay,FilePath,${DOCUMENT_EMPLOYEE}`;
const P9_COLUMNS = `Id,Year,FilePath,${DOCUMENT_EMPLOYEE}`;
const PAGE_SIZE = 20;
const DOCUMENT_BUCKET = 'hr-documents';
// Download links stop working after this many seconds, so they cannot be shared and reused later.
const DOCUMENT_LINK_SECONDS = 300;
// Supabase Auth signs in by email; a plain development username such as "admin" becomes admin@example.com.
const USERNAME_EMAIL_DOMAIN = 'example.com';
// Must match the columns granted for update in supabase/migrations/*_employee_mirror_signed_in_access.sql.
export const EDITABLE_FIELDS = PROFILE_COLUMNS.split(',').filter(field => field !== 'Id');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE = /^\+?[0-9 ()-]{7,20}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function createMirrorApiClient({ supabase, onUnauthorized = () => {} }) {
  function client() {
    if (!supabase) throw new ApiError('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.');
    return supabase;
  }
  const table = (name = 'employee_mirror') => client().from(name);
  async function run(query, signal) {
    const result = await (signal ? query.abortSignal(signal) : query);
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (result.error) {
      // 401 means there is no valid session (signed out or expired); the signed-in permissions do not apply.
      if (result.status === 401) { onUnauthorized(); throw new ApiError('Your session has ended. Please sign in again.', 401); }
      // Invalid UUIDs in the address bar are reported the same way as a missing employee.
      if (result.error.code === '22P02') throw new ApiError('Employee not found.', 404);
      throw new ApiError(result.error.message || 'The employee data could not be loaded.', result.status || 0);
    }
    return result;
  }
  async function page(query, pageIndex, size, signal) {
    const from = pageIndex * size;
    const { data, count } = await run(query.range(from, from + size - 1), signal);
    return { PageCollection: data ?? [], ItemsCount: count ?? 0, TotalPages: Math.ceil((count ?? 0) / size) };
  }
  return {
    async login({ UserName, Password }) {
      const name = UserName.trim();
      const email = name.includes('@') ? name : `${name}@${USERNAME_EMAIL_DOMAIN}`;
      const { data, error } = await client().auth.signInWithPassword({ email, password: Password });
      if (error) throw new ApiError(error.message || 'Sign in failed.', error.status || 0);
      return { token: data.session.access_token, email: data.user?.email || email };
    },
    clearToken() { supabase?.auth.signOut({ scope: 'local' }).catch(() => {}); },
    async employees(pageIndex = 0, { signal } = {}) {
      return page(table().select(PROFILE_COLUMNS, { count: 'exact' })
        .order('CustomerFullName', { ascending: true, nullsFirst: false }).order('Id'), pageIndex, PAGE_SIZE, signal);
    },
    async employee(id, { signal } = {}) {
      const { data } = await run(table().select(PROFILE_COLUMNS).eq('Id', id).maybeSingle(), signal);
      if (!data) throw new ApiError('Employee not found.', 404);
      return data;
    },
    async updateEmployee(id, changes) {
      const values = Object.fromEntries(EDITABLE_FIELDS.filter(field => field in changes)
        .map(field => [field, String(changes[field] ?? '').trim() || null]));
      if ('CustomerFullName' in values && !values.CustomerFullName) throw new ApiError('Enter the employee\'s full name.', 400);
      if (values.EmploymentStartDate && !DATE.test(values.EmploymentStartDate)) throw new ApiError('Enter a valid start date.', 400);
      if (values.CustomerAddressEmail && !EMAIL.test(values.CustomerAddressEmail)) throw new ApiError('Enter a valid email address.', 400);
      if (values.CustomerAddressMobileLine && !MOBILE.test(values.CustomerAddressMobileLine)) throw new ApiError('Enter a valid mobile number, using digits and an optional leading +.', 400);
      const { data } = await run(table().update(values).eq('Id', id).select(PROFILE_COLUMNS).maybeSingle());
      // Row-level security silently skips rows it does not allow, so no row back means nothing was saved.
      if (!data) throw new ApiError('The changes were not saved. Check that the signed-in access SQL has been run in Supabase.', 403);
      return data;
    },
    async payslips(pageIndex = 0, { signal } = {}) {
      return page(table('payslip_mirror').select(PAYSLIP_COLUMNS, { count: 'exact' })
        .order('Year', { ascending: false }).order('Month', { ascending: false }).order('Id'), pageIndex, PAGE_SIZE, signal);
    },
    async p9Forms(pageIndex = 0, { signal } = {}) {
      return page(table('p9_mirror').select(P9_COLUMNS, { count: 'exact' })
        .order('Year', { ascending: false }).order('Id'), pageIndex, PAGE_SIZE, signal);
    },
    async documentUrl(path) {
      const { data, error } = await client().storage.from(DOCUMENT_BUCKET).createSignedUrl(path, DOCUMENT_LINK_SECONDS);
      if (error || !data?.signedUrl) throw new ApiError(`The PDF could not be opened. Check that "${path}" is uploaded to the ${DOCUMENT_BUCKET} bucket.`, 404);
      return data.signedUrl;
    },
  };
}
