export class ApiError extends Error {
  constructor(message, status = 0, correlationId = null) {
    super(message);
    this.status = status;
    this.correlationId = correlationId;
  }
}

export function createApiClient({ baseUrl = '/api', fetchImpl = globalThis.fetch, onUnauthorized = () => {} } = {}) {
  let token = null;
  async function request(path, { body, anonymous = false, ...options } = {}) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`, {
        ...options,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(!anonymous && token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new ApiError('The HR service could not be reached. Please try again.');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.success === false) {
      if (response.status === 401 && !anonymous) { token = null; onUnauthorized(); }
      throw new ApiError(data?.message || data?.Message || 'The request could not be completed.', response.status, data?.correlationId);
    }
    if (data === null) throw new ApiError('The HR service returned an unexpected response. Check the API connection.', response.status);
    return data && Object.hasOwn(data, 'data') ? data.data : data;
  }
  return {
    setToken(value) { token = value; },
    clearToken() { token = null; },
    login: (body) => request('auth/login', { method: 'POST', body, anonymous: true }),
    changeInitialPassword: (body) => request('auth/change-initial-password', { method: 'POST', body, anonymous: true }),
    profile: (options) => request('hr-portal/me', options),
    leaveTypes: (options) => request('hr-portal/me/leave-types', options),
    applications: (pageIndex = 0, options) => request(`hr-portal/me/leave-applications?pageIndex=${pageIndex}&pageSize=20`, options),
    preview: (query, options) => request(`hr-portal/me/leave-preview?${new URLSearchParams(query)}`, options),
    submitLeave: (body) => request('hr-portal/me/leave-applications', { method: 'POST', body }),
    withdraw: (id) => request(`hr-portal/me/leave-applications/${encodeURIComponent(id)}/withdraw`, { method: 'POST' }),
  };
}
