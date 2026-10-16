import { createApiClient } from './api.js';
import { createSupabasePortalClient } from './supabasePortalClient.js';

// Choose once per application session. A failed ERP request must never fall back
// to a synthetic database, especially when saving an application.
export function createPortalClient({ source = 'erp', ...options } = {}) {
  if (source === 'erp') return createApiClient(options);
  if (source === 'supabase') return createSupabasePortalClient(options);
  throw new Error(`Unsupported VITE_DATA_SOURCE: ${source}. Use erp or supabase.`);
}
