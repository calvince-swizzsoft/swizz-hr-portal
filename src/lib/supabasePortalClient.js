import { createClient } from '@supabase/supabase-js';
import { ApiError } from './api.js';
import { pickProfileChanges } from './profileFields.js';

export function createSupabasePortalClient({ supabase: injected, supabaseUrl, supabaseKey, onUnauthorized = () => {} } = {}) {
  let client = injected;
  let expiresAt = 0;
  function getClient() {
    if (!client) {
      if (!supabaseUrl || !supabaseKey) throw new ApiError('Configure the development Supabase URL and publishable key.');
      client = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
    }
    return client;
  }
  function fail(message, status, code = null) {
    const error = new ApiError(message, status);
    error.code = code;
    if (status === 401) { expiresAt = 0; onUnauthorized(); }
    throw error;
  }
  async function request(operation, args = {}, { signal } = {}, rpc = ['portal_dev_request', { operation, args }]) {
    signal?.throwIfAborted();
    if (!expiresAt || Date.now() >= expiresAt) fail('Your session has ended. Please sign in again.', 401, 'AUTHENTICATION_REQUIRED');
    try {
      let query = getClient().rpc(...rpc);
      if (signal) query = query.abortSignal(signal);
      const { data, error, status } = await query;
      signal?.throwIfAborted();
      if (error) {
        if (error.name === 'AbortError') throw error;
        const setupErrors = {
          PGRST202: rpc[0] === 'portal_dev_update_profile'
            ? 'Profile updates are unavailable. Apply the contact self-service migration to this Supabase project.'
            : 'The development API function is unavailable. Apply the existing-mirror adapter migration to this Supabase project.',
          '42501': 'Access to the development API was denied. Check the migration grants and the signed-in Auth role.',
          '42P01': 'A required development table or view is missing. Check that the adapter migration completed successfully.',
          '42703': 'The development database columns do not match the adapter. Check the adapter migration.',
        };
        const message = status === 401 ? 'Your session has ended. Please sign in again.'
          : setupErrors[error.code] || 'The development HR service could not complete the request.';
        const diagnostic = /^[A-Z0-9]{5,12}$/.test(error.code || '') ? ` (code ${error.code})` : '';
        fail(message + diagnostic, status || 0, error.code);
      }
      if (!data || typeof data.success !== 'boolean') fail('The development HR service returned an unexpected response.', 502);
      if (!data.success) fail(data.message, data.status || 400, data.error?.code);
      return data.data;
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof ApiError || error.name === 'AbortError') throw error;
      throw new ApiError('The development HR service could not be reached. Please try again.');
    }
  }
  return {
    source: 'supabase',
    loginLabel: 'Email',
    canEditProfile: true,
    async login(body) {
      const { data, error } = await getClient().auth.signInWithPassword({ email: body.UserName ?? body.userName, password: body.Password ?? body.password });
      if (error) fail('Sign-in failed. Check your development account credentials.', error.status || 401, error.code);
      if (!data?.session) fail('Sign-in did not return a session.', 401);
      expiresAt = data.session.expires_at * 1000;
      return { token: data.session.access_token, userName: data.user.email, roles: [] };
    },
    // Supabase Auth already holds this session in memory; ERP uses setToken.
    setToken() {},
    async clearToken() {
      expiresAt = 0;
      if (client) await client.auth.signOut({ scope: 'local' });
    },
    async changeInitialPassword() { throw new ApiError('Manage development passwords in Supabase Auth. ERP first-login behaviour is tested in ERP mode.', 400); },
    profile: (options) => request('profile', {}, options),
    async updateProfile(changes) {
      let body;
      try { body = pickProfileChanges(changes); } catch (error) { throw new ApiError(error.message, 400); }
      return request('updateProfile', {}, {}, ['portal_dev_update_profile', { changes: body }]);
    },
    leaveTypes: (options) => request('leaveTypes', {}, options),
    applications: (pageIndex = 0, options) => request('applications', { pageIndex, pageSize: 20 }, options),
    application: (id, options) => request('application', { id }, options),
    balances: (query, options) => request('balances', query, options),
    preview: (query, options) => request('preview', query, options),
    submitLeave: (body) => request('submitLeave', body),
    updateLeave: (id, body) => request('updateLeave', { ...body, id }),
    withdraw: (id) => request('withdraw', { id }),
    processingApplications: (query = {}, options) => request('processingApplications', query, options),
    processingApplication: (id, options) => request('processingApplication', { id }, options),
    authorizeLeave: (id, body) => request('authorizeLeave', { ...body, id }),
  };
}
