import { useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { createApiClient } from './lib/api.js';
import {
  fetchLeaveTypes,
  fetchMirroredLeaveApplications,
  insertTestLeaveApplication,
  setMirroredLeaveApplicationStatus,
  updateMirroredLeaveApplication,
} from './lib/supabaseClient.js';

const dateText = (value) => value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function Feedback({ error }) { return error ? <div className="feedback" role="alert">{error.message || error}{error.correlationId && <small>Reference: {error.correlationId}</small>}</div> : null; }
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }
function Card({ title, children, action }) { return <section className="page-card"><header className="card-header"><h1>{title}</h1>{action}</header>{children}</section>; }

export default function App() {
  const [profile, setProfile] = useState(null);
  const [notice, setNotice] = useState('');
  const [previewMode, setPreviewMode] = useState(false);
  const navigate = useNavigate();
  const api = useMemo(() => createApiClient({ baseUrl: import.meta.env.VITE_API_BASE_URL || '/api', onUnauthorized: () => {
    setProfile(null); setPreviewMode(false); setNotice('Your session has ended. Please sign in again.');
  } }), []);
  async function signedIn(result) {
    if (!result?.token) throw new Error('The sign-in response did not include a session token.');
    api.setToken(result.token);
    try {
      const employee = await api.profile();
      if (!employee?.Id) throw new Error('The employee profile response was incomplete. Contact HR.');
      setProfile(employee); setNotice(''); setPreviewMode(false); navigate('/profile');
    }
    catch (error) { api.clearToken(); throw error; }
  }
  function demoSignIn() { setProfile(null); setNotice(''); setPreviewMode(true); navigate('/profile'); }
  function logout() { api.clearToken(); setProfile(null); setPreviewMode(false); setNotice(''); navigate('/login'); }
  if (!profile && !previewMode) return <Login api={api} signedIn={signedIn} notice={notice} onDemoSignIn={demoSignIn} />;
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="/profile"><span className="brand-icon">S</span><span>Swift<span className="brand-sub">HR PORTAL</span></span></a>
      <p className="nav-label">EMPLOYEE SELF-SERVICE</p><nav style={{ flexWrap: 'wrap' }}>{previewMode ? <><NavLink to="/profile">My profile</NavLink><NavLink to="/leave">My leave</NavLink><NavLink to="/leave-types">Leave types</NavLink><NavLink to="/leave-application">New application</NavLink><NavLink to="/applications">Applications</NavLink></> : <><NavLink to="/profile">My profile</NavLink><NavLink to="/leave">My leave</NavLink><NavLink to="/leave-types">Leave types</NavLink><NavLink to="/applications">Applications</NavLink></>}</nav>
      <div className="sidebar-bottom">{previewMode ? <button onClick={logout}>Sign out</button> : <><span>{profile.CustomerFullName || 'Employee'}</span><button onClick={logout}>Sign out</button></>}</div></aside>
    <main><div className="topbar"><span>{previewMode ? 'Employee self-service' : `Welcome, ${profile.CustomerIndividualFirstName || 'colleague'}`}</span><span className="status-dot">{previewMode ? '' : 'Employee portal'}</span></div>
      <Routes>{previewMode ? <><Route path="/profile" element={<OpenProfile />} /><Route path="/leave" element={<OpenLeave />} /><Route path="/leave-types" element={<LeaveTypes />} /><Route path="/leave-application" element={<LeaveApplication />} /><Route path="/applications" element={<LeaveApplications />} /><Route path="*" element={<Navigate to="/profile" replace />} /></> : <><Route path="/profile" element={<Profile profile={profile} />} /><Route path="/leave" element={<Leave api={api} />} /><Route path="/leave-types" element={<LeaveTypes />} /><Route path="/applications" element={<LeaveApplications />} /><Route path="*" element={<Navigate to="/profile" replace />} /></>}</Routes>
    </main></div>;
}

function Login({ api, signedIn, notice, onDemoSignIn }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState(''); const [confirmPassword, setConfirmPassword] = useState('');
  const [initial, setInitial] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(null);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const result = initial ? await api.changeInitialPassword({ UserName: username, CurrentPassword: password, NewPassword: newPassword, ConfirmPassword: confirmPassword })
        : await api.login({ UserName: username, Password: password });
      if (result.requiresPasswordChange) { setInitial(true); return; }
      await signedIn(result); setPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (error) { setError(error); } finally { setBusy(false); }
  }
  return <div className="login-shell"><div className="login-intro"><div className="brand"><span className="brand-icon">S</span>Swift HR Portal</div><div><p className="eyebrow">YOUR WORK, IN ONE PLACE</p><h1>A little less admin.<br />More room for you.</h1><p>Keep up with your employee details and plan your time away.</p></div><small>Connected to Swift Financials</small></div>
    <div className="login-panel"><form onSubmit={submit}><p className="eyebrow">EMPLOYEE SELF-SERVICE</p><h2>{initial ? 'Choose your password' : 'Welcome back'}</h2><p className="muted">{initial ? 'Replace your temporary password to continue.' : 'Sign in with your ERP account.'}</p>{notice && <p role="status">{notice}</p>}<Feedback error={error} />
      <Field label="Username"><input required autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} disabled={busy || initial} /></Field>
      <Field label={initial ? 'Temporary password' : 'Password'}><input required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></Field>
      {initial && <><Field label="New password"><input required type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} /></Field><Field label="Confirm new password"><input required type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></Field></>}
      <button className="primary full" disabled={busy}>{busy ? 'Signing in…' : initial ? 'Change password and sign in' : 'Sign in'}</button>{import.meta.env.DEV && <button type="button" className="full" onClick={onDemoSignIn} disabled={busy}>Continue without signing in</button>}<p className="help">Need an account or email confirmation? Contact your HR administrator.</p></form></div></div>;
}

function Profile({ profile }) {
  const fields = [['Payroll number', profile.CustomerIndividualPayrollNumbers], ['Email', profile.CustomerAddressEmail], ['Mobile', profile.CustomerAddressMobileLine], ['Start date', dateText(profile.EmploymentStartDate)], ['Department', profile.DepartmentDescription], ['Designation', profile.DesignationDescription], ['Branch', profile.BranchDescription], ['Employment type', profile.EmployeeTypeDescription], ['NSSF number', profile.NationalSocialSecurityFundNumber], ['SHA / NHIF number', profile.NationalHospitalInsuranceFundNumber]];
  return <Card title="My employee profile"><div className="profile-heading"><div className="avatar">{(profile.CustomerIndividualFirstName || profile.CustomerFullName || 'E').slice(0, 1)}</div><div><h2>{profile.CustomerFullName || 'Employee'}</h2><p className="muted">{profile.DesignationDescription || 'Your employment record'}</p></div></div><dl className="details-grid">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl><p className="help">To correct your employee details, contact HR.</p></Card>;
}

function OpenProfile() {
  return <Card title="My employee profile">
    <div className="empty"><strong>Profile details aren’t available</strong><p>No employee account is connected.</p></div>
  </Card>;
}

function OpenLeave() {
  const navigate = useNavigate();
  return <Card title="My leave" action={<button className="primary" onClick={() => navigate('/leave-application')}>Request leave</button>}>
    <p className="muted section-intro">View leave requests and apply for leave.</p>
    <div className="empty"><strong>No leave requests to display</strong><p>There is no employee account connected to load personal requests.</p></div>
  </Card>;
}

function LeaveTypes() {
  const navigate = useNavigate();
  const [types, setTypes] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    fetchLeaveTypes(abort.signal)
      .then(value => { if (!abort.signal.aborted) setTypes(value); })
      .catch(e => { if (e.name !== 'AbortError') setError(e); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [revision]);

  return <Card title="Leave types" action={import.meta.env.DEV && <button className="primary" onClick={() => navigate('/leave-application')}>New application</button>}>
    <p className="muted section-intro">Leave types configured in the HR system.</p>
    {loading ? <div className="empty" role="status">Loading leave types…</div>
      : error ? <div className="empty"><Feedback error={error} /><button onClick={() => setRevision(x => x + 1)}>Try again</button></div>
        : types.length ? <div className="list-wrapper" role="list" aria-label="Available leave types">
          {types.map(type => <div className="list-row" role="listitem" key={type.erp_id} style={{ gridTemplateColumns: '1fr' }}>
            <strong>{type.description}</strong>
          </div>)}
        </div>
          : <div className="empty"><strong>No leave types available</strong><p>No leave types are currently configured. Contact HR if you think this is incorrect.</p></div>}
  </Card>;
}

function LeaveApplications() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState({ rows: [], count: 0 });
  const [revision, setRevision] = useState(0);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [success, setSuccess] = useState('');
  const pageSize = 20;

  useEffect(() => {
    const abort = new AbortController();
    setBusy(true);
    setError(null);
    fetchMirroredLeaveApplications({ page, pageSize, signal: abort.signal })
      .then(value => { if (!abort.signal.aborted) setResult(value); })
      .catch(e => { if (!abort.signal.aborted) setError(e); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [page, pageSize, revision]);

  function beginEdit(item) {
    setEditingId(item.erp_id);
    setError(null);
    setSuccess('');
    setEditForm({ ...item, source_payload_text: JSON.stringify(item.source_payload ?? {}, null, 2) });
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (!editForm || busy) return;
    if (editForm.end_date < editForm.start_date) {
      setError(new Error('End date must be on or after the start date.'));
      return;
    }
    let sourcePayload;
    try {
      sourcePayload = JSON.parse(editForm.source_payload_text);
      if (sourcePayload === null || Array.isArray(sourcePayload) || typeof sourcePayload !== 'object') {
        throw new Error('Source payload must be a JSON object.');
      }
    } catch (e) {
      setError(new Error(`Invalid source payload JSON: ${e.message}`));
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess('');
    try {
      await updateMirroredLeaveApplication(editingId, {
        ...editForm,
        status: Number(editForm.status),
        source_payload: sourcePayload,
      });
      setEditingId(null);
      setEditForm(null);
      setSuccess('Application mirror row updated.');
      setRevision(value => value + 1);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function decide(item, status, description) {
    setBusy(true);
    setError(null);
    setSuccess('');
    try {
      await setMirroredLeaveApplicationStatus(item.erp_id, status, description);
      setSuccess(`Application marked ${description.toLowerCase()}.`);
      setRevision(value => value + 1);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return <Card title="Leave applications">
    <p className="muted section-intro">Leave application mirror records.</p>
    <p className="help">Changes here update Supabase only. They do not update the ERP and may be overwritten by the next mirror sync.</p>
    {success && <p className="success" role="status">{success}</p>}
    <Feedback error={error} />
    <div className="list-wrapper">
      {busy ? <div className="empty" role="status">Loading applications…</div>
        : error ? <div className="empty"><button onClick={() => setRevision(value => value + 1)}>Try again</button></div>
          : result.rows.length ? result.rows.map(item => <article className="application-record" key={item.erp_id} style={{ background: 'white', border: '1px solid #d1d5db', borderRadius: 8, padding: 16, marginBottom: 12 }}>
            {editingId === item.erp_id && editForm
              ? <form className="request-form" onSubmit={saveEdit}>
                <div className="form-heading"><h2>Edit application {item.erp_id}</h2><button type="button" onClick={() => { setEditingId(null); setEditForm(null); }} disabled={busy}>Cancel</button></div>
                <div className="form-grid">
                  <Field label="Employee ERP ID"><input required value={editForm.employee_erp_id} onChange={e => setEditForm({ ...editForm, employee_erp_id: e.target.value })} disabled={busy} /></Field>
                  <Field label="Leave type ERP ID"><input value={editForm.leave_type_erp_id || ''} onChange={e => setEditForm({ ...editForm, leave_type_erp_id: e.target.value })} disabled={busy} /></Field>
                  <Field label="Leave type"><input required value={editForm.leave_type_description} onChange={e => setEditForm({ ...editForm, leave_type_description: e.target.value })} disabled={busy} /></Field>
                  <Field label="Start date"><input required type="date" value={editForm.start_date} onChange={e => setEditForm({ ...editForm, start_date: e.target.value })} disabled={busy} /></Field>
                  <Field label="End date"><input required type="date" value={editForm.end_date} onChange={e => setEditForm({ ...editForm, end_date: e.target.value })} disabled={busy} /></Field>
                  <Field label="Status"><input required type="number" step="1" value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value })} disabled={busy} /></Field>
                </div>
                <Field label="Reason"><textarea maxLength={256} rows={3} value={editForm.reason || ''} onChange={e => setEditForm({ ...editForm, reason: e.target.value })} disabled={busy} /></Field>
                <Field label="Status description"><input value={editForm.status_description || ''} onChange={e => setEditForm({ ...editForm, status_description: e.target.value })} disabled={busy} /></Field>
                <Field label="Source payload (JSON)"><textarea className="payload-editor" rows={8} spellCheck={false} value={editForm.source_payload_text} onChange={e => setEditForm({ ...editForm, source_payload_text: e.target.value })} disabled={busy} /></Field>
                <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
              </form>
              : <>
            <div className="application-record-heading">
              <div><strong>{item.leave_type_description}</strong><small>Employee ERP ID: {item.employee_erp_id}</small></div>
              <span><span className={`badge status-${item.status}`}>Status {item.status}</span><small>{item.status_description || '—'}</small></span>
            </div>
            <dl className="details-grid">
              <div><dt>Start date</dt><dd>{dateText(item.start_date)}</dd></div>
              <div><dt>End date</dt><dd>{dateText(item.end_date)}</dd></div>
              <div><dt>Reason</dt><dd>{item.reason || '—'}</dd></div>
              <div><dt>Synced at</dt><dd>{item.synced_at ? new Date(item.synced_at).toLocaleString() : '—'}</dd></div>
            </dl>
            <details className="source-payload"><summary>Source payload</summary><pre>{JSON.stringify(item.source_payload, null, 2)}</pre></details>
            {item.status === 1 && <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button className="primary" onClick={() => decide(item, 2, 'Accepted')} disabled={busy}>Accept</button>
              <button onClick={() => decide(item, 4, 'Rejected')} disabled={busy}>Reject</button>
            </div>}
            <button onClick={() => beginEdit(item)} disabled={busy}>Edit</button>
              </>}
          </article>) : <div className="empty"><strong>No applications found</strong><p>No leave application rows are currently available in the mirror.</p></div>}
    </div>
    <div className="pagination"><button disabled={busy || page === 0} onClick={() => setPage(value => value - 1)}>Prev</button><span>Page {page + 1} of {Math.max(1, Math.ceil(result.count / pageSize))}</span><button disabled={busy || (page + 1) * pageSize >= result.count} onClick={() => setPage(value => value + 1)}>Next</button></div>
  </Card>;
}

function LeaveApplication() {
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({ leaveTypeId: '', start: '', end: '', reason: '' });
  const navigate = useNavigate();

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    fetchLeaveTypes(abort.signal)
      .then(value => { if (!abort.signal.aborted) setTypes(value); })
      .catch(e => { if (!abort.signal.aborted) setError(e); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, []);

  function update(field, value) {
    setForm(current => ({ ...current, [field]: value }));
    setError(null);
    setSuccess('');
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || loading || !types.some(type => type.erp_id === form.leaveTypeId)) return;
    if (form.end < form.start) {
      setError(new Error('End date must be on or after the start date.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const type = types.find(item => item.erp_id === form.leaveTypeId);
      await insertTestLeaveApplication({ ...form, leaveTypeDescription: type.description });
      setSuccess('Application saved to the Supabase mirror.');
      navigate('/applications');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return <Card title="New leave application">
    <p className="muted section-intro">Submitting here creates a test row in Supabase only. It does not submit to the ERP or notify HR.</p>
    {success && <p className="success" role="status">{success}</p>}
    <Feedback error={error} />
    {loading ? <div className="empty" role="status">Loading leave types…</div>
      : error && !types.length ? <div className="empty"><button onClick={() => window.location.reload()}>Reload</button></div>
        : !types.length ? <div className="empty"><strong>No leave types available</strong><p>No leave types are currently configured.</p></div>
          : <form className="request-form" onSubmit={submit}>
            <div className="form-grid">
              <Field label="Leave type"><select required value={form.leaveTypeId} onChange={e => update('leaveTypeId', e.target.value)} disabled={busy}><option value="">Select leave type</option>{types.map(type => <option key={type.erp_id} value={type.erp_id}>{type.description}</option>)}</select></Field>
              <Field label="Start date"><input required type="date" min={localToday()} value={form.start} onChange={e => update('start', e.target.value)} disabled={busy} /></Field>
              <Field label="End date"><input required type="date" min={form.start || localToday()} value={form.end} onChange={e => update('end', e.target.value)} disabled={busy} /></Field>
            </div>
            <Field label="Reason"><textarea required maxLength={256} rows={3} value={form.reason} onChange={e => update('reason', e.target.value)} disabled={busy} /></Field>
            <button className="primary" disabled={busy || loading || !types.length}>{busy ? 'Saving…' : 'Submit leave application'}</button>
          </form>}
  </Card>;
}

function Leave({ api }) {
  const [page, setPage] = useState(0); const [data, setData] = useState(null); const [types, setTypes] = useState([]);
  const [error, setError] = useState(null); const [loading, setLoading] = useState(true); const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false); const [busyId, setBusyId] = useState(null); const [success, setSuccess] = useState('');
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError(null);
    Promise.all([api.applications(page, { signal: abort.signal }), api.leaveTypes({ signal: abort.signal })])
      .then(([applications, policies]) => { if (!abort.signal.aborted) { setData(applications); setTypes(policies); } })
      .catch(e => { if (e.name !== 'AbortError') setError(e); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [api, page, revision]);
  async function withdraw(item) {
    if (!window.confirm('Withdraw this pending leave request?')) return;
    setBusyId(item.Id); setError(null);
    try { await api.withdraw(item.Id); setSuccess('Leave request withdrawn.'); setRevision(x => x + 1); }
    catch (error) { setError(error); } finally { setBusyId(null); }
  }
  return <Card title="My leave" action={<button className="primary" onClick={() => setOpen(true)} disabled={loading || !!error}>Request leave</button>}>
    <p className="muted section-intro">Plan your time away and follow your requests.</p><Feedback error={error} />{success && <p className="success" role="status">{success}</p>}
    {open && <LeaveForm api={api} types={types} onClose={() => setOpen(false)} onSaved={saved => { setOpen(false); setSuccess(saved.NotificationPending ? 'Request saved. The HR notification is pending.' : 'Leave request submitted.'); setPage(0); setRevision(x => x + 1); }} />}
    <div className="list-wrapper"><div className="list-header"><span>Leave type</span><span>Dates</span><span>Status</span><span>Actions</span></div>
      {loading ? <div className="empty" role="status">Loading your leave requests…</div> : error ? <div className="empty"><button onClick={() => setRevision(x => x + 1)}>Try again</button></div> : data?.PageCollection?.length ? data.PageCollection.map(item => <div className="list-row" key={item.Id}><div><strong>{item.LeaveTypeDescription}</strong><small>{item.Reason}</small></div><span>{dateText(item.Start)} – {dateText(item.End)}</span><span><span className={`badge status-${item.Status}`}>{item.StatusDescription || 'Unknown'}</span></span><div>{item.Status === 1 ? <button onClick={() => withdraw(item)} disabled={busyId === item.Id}>{busyId === item.Id ? 'Withdrawing…' : 'Withdraw'}</button> : '—'}</div></div>) : <div className="empty"><strong>No leave requests yet</strong><p>Your requests will appear here after you submit them.</p></div>}</div>
    <div className="pagination"><button disabled={loading || page === 0} onClick={() => setPage(x => x - 1)}>Prev</button><span>Page {page + 1} of {Math.max(1, data?.TotalPages || 1)}</span><button disabled={loading || page + 1 >= (data?.TotalPages || 1)} onClick={() => setPage(x => x + 1)}>Next</button></div>
  </Card>;
}

function LeaveForm({ api, types, onClose, onSaved }) {
  const [form, setForm] = useState({ leaveTypeId: '', start: '', end: '', reason: '' });
  const [preview, setPreview] = useState(null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false); const [previewing, setPreviewing] = useState(false);
  function set(field, value) { if (field !== 'reason') setPreview(null); setError(null); setForm(x => ({ ...x, [field]: value })); }
  useEffect(() => {
    setPreview(null);
    if (!form.leaveTypeId || !form.start || !form.end || form.end < form.start) { setPreviewing(false); return; }
    const abort = new AbortController(); setPreviewing(true);
    const timer = setTimeout(() => api.preview({ leaveTypeId: form.leaveTypeId, start: form.start, end: form.end }, { signal: abort.signal })
      .then(value => { if (!abort.signal.aborted) setPreview(value); }).catch(e => { if (e.name !== 'AbortError') setError(e); })
      .finally(() => { if (!abort.signal.aborted) setPreviewing(false); }), 250);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [api, form.leaveTypeId, form.start, form.end]);
  async function submit(event) {
    event.preventDefault(); if (!preview?.CanSubmit || previewing || busy) return;
    setBusy(true); setError(null);
    try { onSaved(await api.submitLeave(form)); } catch (error) { setError(error); } finally { setBusy(false); }
  }
  return <form className="request-form" onSubmit={submit}><div className="form-heading"><h2>Request leave</h2><button type="button" onClick={onClose} disabled={busy}>Close</button></div><Feedback error={error} /><div className="form-grid">
    <Field label="Leave type"><select required value={form.leaveTypeId} onChange={e => set('leaveTypeId', e.target.value)} disabled={busy}><option value="">Select leave type</option>{types.map(type => <option key={type.Id} value={type.Id}>{type.Description}</option>)}</select></Field>
    <Field label="Start date"><input required type="date" min={localToday()} value={form.start} onChange={e => set('start', e.target.value)} disabled={busy} /></Field>
    <Field label="End date"><input required type="date" min={form.start || localToday()} value={form.end} onChange={e => set('end', e.target.value)} disabled={busy} /></Field></div>
    <Field label="Reason"><textarea required maxLength={256} rows={3} value={form.reason} onChange={e => set('reason', e.target.value)} disabled={busy} /></Field>
    {previewing && <p role="status">Calculating your leave balance…</p>}{preview && <div className="balance-preview"><strong>{preview.RequestedDays} chargeable day(s)</strong>{preview.Error && <p role="alert">{preview.Error}</p>}{preview.Cycles.map((cycle, i) => <div key={i}><span>{dateText(cycle.Start)} – {dateText(cycle.End)}</span><p>Available: {cycle.Available} · Requested: {cycle.Requested} · Remaining: {cycle.Remaining}</p></div>)}</div>}
    <button className="primary" disabled={busy || previewing || !preview?.CanSubmit}>{busy ? 'Submitting…' : 'Submit request'}</button>
  </form>;
}
