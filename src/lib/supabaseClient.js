import { createClient } from '@supabase/supabase-js'

let supabase

function getSupabaseClient() {
  if (!supabase) {
    const url = import.meta.env.VITE_SUPABASE_URL
    const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
    if (!url || !publishableKey) {
      throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.')
    }
    supabase = createClient(url, publishableKey)
  }
  return supabase
}

export async function fetchLeaveTypes(signal) {
  let query = getSupabaseClient()
    .from('leave_types_mirror')
    .select('erp_id, description')
    .order('description', { ascending: true })
  if (signal) query = query.abortSignal(signal)

  const { data, error } = await query
  if (error) throw error
  return data
}