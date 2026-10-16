import { createClient } from '@supabase/supabase-js'

let supabase

function getSupabaseClient() {
  if (!supabase) {
    const url = import.meta.env.VITE_SUPABASE_URL
    const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
    if (!url || !publishableKey) {
      throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.')
    }
    supabase = createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
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

export async function fetchMirroredLeaveApplications({ page = 0, pageSize = 20, signal } = {}) {
  let query = getSupabaseClient()
    .from('leave_application_mirror')
    .select('erp_id, employee_erp_id, leave_type_erp_id, leave_type_description, start_date, end_date, reason, status, status_description, source_payload, synced_at', { count: 'exact' })
    .order('synced_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)
  if (signal) query = query.abortSignal(signal)

  const { data, count, error } = await query
  if (error) throw error
  return { rows: data, count: count || 0 }
}

export async function insertTestLeaveApplication(application) {
  const { data, error } = await getSupabaseClient()
    .from('leave_application_mirror')
    .insert({
      erp_id: crypto.randomUUID(),
      employee_erp_id: 'DEMO',
      leave_type_erp_id: application.leaveTypeId,
      leave_type_description: application.leaveTypeDescription,
      start_date: application.start,
      end_date: application.end,
      reason: application.reason.trim(),
      status: 1,
      status_description: 'Pending',
      source_payload: {
        source: 'portal_demo_submission',
        leaveTypeId: application.leaveTypeId,
        start: application.start,
        end: application.end,
        reason: application.reason.trim(),
      },
    })
    .select('erp_id')
    .single()
  if (error) throw error
  return data
}

export async function setMirroredLeaveApplicationStatus(erpId, status, statusDescription) {
  const { data, error } = await getSupabaseClient()
    .from('leave_application_mirror')
    .update({ status, status_description: statusDescription })
    .eq('erp_id', erpId)
    .select('erp_id')
    .single()
  if (error) throw error
  if (!data) throw new Error('The application status was not updated.')
}

export async function updateMirroredLeaveApplication(erpId, application) {
  const { data, error } = await getSupabaseClient()
    .from('leave_application_mirror')
    .update({
      employee_erp_id: application.employee_erp_id,
      leave_type_erp_id: application.leave_type_erp_id,
      leave_type_description: application.leave_type_description,
      start_date: application.start_date,
      end_date: application.end_date,
      reason: application.reason,
      status: application.status,
      status_description: application.status_description,
      source_payload: application.source_payload,
    })
    .eq('erp_id', erpId)
    .select('erp_id')
    .single()
  if (error) throw error
  if (!data) throw new Error('The application was not updated.')
}