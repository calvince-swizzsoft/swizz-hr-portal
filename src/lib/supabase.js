import { createClient } from '@supabase/supabase-js';

// Optional Supabase client for features the ERP does not provide.
// Employee, profile and leave data must stay on the ERP `/api/hr-portal/me` contracts.
// Only the public publishable (or legacy anon) key belongs here; never expose a secret/service_role key through VITE variables.
const url = import.meta.env.VITE_SUPABASE_URL;
const publicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && publicKey);

export const supabase = isSupabaseConfigured
  ? createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
