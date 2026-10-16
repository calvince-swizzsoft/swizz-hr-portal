import { ApiError } from './api.js';

// TEMPORARY stand-in for the ERP HR portal API while its endpoints are being finished.
// Reads test employee data from the Supabase `employee_mirror` table without signing in.
// Rows use the ERP `/api/hr-portal/me` response field names, so screens need no mapping.
const PROFILE_COLUMNS = [
  'Id', 'CustomerFullName', 'CustomerIndividualFirstName', 'CustomerIndividualPayrollNumbers',
  'CustomerAddressEmail', 'CustomerAddressMobileLine', 'EmploymentStartDate', 'DepartmentDescription',
  'DesignationDescription', 'BranchDescription', 'EmployeeTypeDescription',
  'NationalSocialSecurityFundNumber', 'NationalHospitalInsuranceFundNumber',
].join(',');
const PAGE_SIZE = 20;

export function createMirrorApiClient({ supabase }) {
  function table() {
    if (!supabase) throw new ApiError('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.');
    return supabase.from('employee_mirror');
  }
  async function run(query, signal) {
    const result = await (signal ? query.abortSignal(signal) : query);
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (result.error) {
      // Invalid UUIDs in the address bar are reported the same way as a missing employee.
      if (result.error.code === '22P02') throw new ApiError('Employee not found.', 404);
      throw new ApiError(result.error.message || 'The employee data could not be loaded.', result.status || 0);
    }
    return result;
  }
  return {
    async employees(pageIndex = 0, { signal } = {}) {
      const from = pageIndex * PAGE_SIZE;
      const { data, count } = await run(table().select(PROFILE_COLUMNS, { count: 'exact' })
        .order('CustomerFullName', { ascending: true, nullsFirst: false }).order('Id')
        .range(from, from + PAGE_SIZE - 1), signal);
      return { PageCollection: data ?? [], ItemsCount: count ?? 0, TotalPages: Math.ceil((count ?? 0) / PAGE_SIZE) };
    },
    async employee(id, { signal } = {}) {
      const { data } = await run(table().select(PROFILE_COLUMNS).eq('Id', id).maybeSingle(), signal);
      if (!data) throw new ApiError('Employee not found.', 404);
      return data;
    },
  };
}
