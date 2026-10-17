// Keep this allowlist aligned with PUT /api/hr-portal/me and the Supabase RPC.
export const PROFILE_EDITABLE_FIELDS = ['CustomerAddressEmail', 'CustomerAddressMobileLine'];

export function pickProfileChanges(changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length
    || Object.entries(changes).some(([key, value]) => !PROFILE_EDITABLE_FIELDS.includes(key) || (value !== null && typeof value !== 'string'))) {
    throw new TypeError('Provide email and/or mobile as strings or null. Other details are HR-controlled.');
  }
  return { ...changes };
}
