// Profile details an employee may change themselves. Payroll, statutory and employment
// details stay HR-controlled. Must match portal_dev_update_profile in supabase/migrations.
export const PROFILE_EDITABLE_FIELDS = ['CustomerFullName', 'CustomerIndividualFirstName', 'CustomerAddressEmail', 'CustomerAddressMobileLine'];

export function pickProfileChanges(changes = {}) {
  return Object.fromEntries(PROFILE_EDITABLE_FIELDS.filter(field => Object.hasOwn(changes, field)).map(field => [field, changes[field] ?? null]));
}
