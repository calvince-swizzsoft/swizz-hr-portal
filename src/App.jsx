import { useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { createApiClient } from './lib/api.js';
import { createMirrorApiClient } from './lib/mirrorApi.js';
import { supabase } from './lib/supabase.js';

// TEMPORARY: 'supabase' shows test employee data from the Supabase mirror table, without sign-in, until the ERP HR APIs are ready.
const usesMirror = import.meta.env.VITE_EMPLOYEE_DATA_SOURCE === 'supabase';
import { fetchLeaveTypes } from './lib/supabaseClient.js';

const dateText = (value) => value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function Feedback({ error }) { return error ? <div className="feedback" role="alert">{error.message || error}{error.correlationId && <small>Reference: {error.correlationId}</small>}</div> : null; }
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }
function Card({ title, children, action }) { return <section className="page-card"><header className="card-header"><h1>{title}</h1>{action}</header>{children}</section>; }

export default function App() {
  const [profile, setProfile] = useState(null);
  const [notice, setNotice] = useState('');
  const [previewMode, setPreviewMode] = useState(import.meta.env.DEV);
  const navigate = useNavigate();
  const api = useMemo(() => usesMirror ? createMirrorApiClient({ supabase }) : createApiClient({ baseUrl: import.meta.env.VITE_API_BASE_URL || '/api', onUnauthorized: () => {
    setProfile(null); setNotice('Your session has ended. Please sign in again.');
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
  function logout() { api.clearToken(); setProfile(null); setNotice(''); navigate('/login'); }
  if (usesMirror) return <Shell home="/employees" label="EMPLOYEE RECORDS" nav={<NavLink to="/employees">Employees</NavLink>}
    footer={<span>No sign-in · test data only</span>} greeting="Employee records" status="Supabase test data">
    <Routes><Route path="/employees" element={<Employees api={api} />} /><Route path="/employees/:id" element={<EmployeeDetail api={api} />} /><Route path="*" element={<Navigate to="/employees" replace />} /></Routes>
  </Shell>;
  if (!profile) return <Login api={api} signedIn={signedIn} notice={notice} />;
  return <Shell home="/profile" label="EMPLOYEE SELF-SERVICE" nav={<><NavLink to="/profile">My profile</NavLink><NavLink to="/leave">My leave</NavLink></>}
    footer={<><span>{profile.CustomerFullName || 'Employee'}</span><button onClick={logout}>Sign out</button></>}
    greeting={`Welcome, ${profile.CustomerIndividualFirstName || 'colleague'}`} status="Employee portal">
    <Routes><Route path="/profile" element={<Profile profile={profile} />} /><Route path="/leave" element={<Leave api={api} />} /><Route path="*" element={<Navigate to="/profile" replace />} /></Routes>
  </Shell>;
}

function Shell({ home, label, nav, footer, greeting, status, children }) {
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href={home}><span className="brand-icon">S</span><span>Swift<span className="brand-sub">HR PORTAL</span></span></a>
      <p className="nav-label">{label}</p><nav>{nav}</nav>
      <div className="sidebar-bottom">{footer}</div></aside>
    <main><div className="topbar"><span>{greeting}</span><span className="status-dot">{status}</span></div>{children}</main></div>;
  if (!profile && !previewMode) return <Login api={api} signedIn={signedIn} notice={notice} onPreview={() => setPreviewMode(true)} />;
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="/profile"><span className="brand-icon">S</span><span>Swift<span className="brand-sub">HR PORTAL</span></span></a>
      <p className="nav-label">{previewMode ? 'DEVELOPMENT PREVIEW' : 'EMPLOYEE SELF-SERVICE'}</p><nav style={{ flexWrap: 'wrap' }}>{previewMode ? <NavLink to="/leave-types">Leave types</NavLink> : <><NavLink to="/profile">My profile</NavLink><NavLink to="/leave">My leave</NavLink><NavLink to="/leave-types">Leave types</NavLink></>}</nav>
      <div className="sidebar-bottom">{previewMode ? <><span>Read-only preview</span><button onClick={() => setPreviewMode(false)}>Sign in</button></> : <><span>{profile.CustomerFullName || 'Employee'}</span><button onClick={logout}>Sign out</button></>}</div></aside>
    <main><div className="topbar"><span>{previewMode ? 'Leave types preview' : `Welcome, ${profile.CustomerIndividualFirstName || 'colleague'}`}</span><span className="status-dot">{previewMode ? 'Development only · no employee session' : 'Employee portal'}</span></div>
      <Routes>{previewMode ? <><Route path="/leave-types" element={<LeaveTypes />} /><Route path="*" element={<Navigate to="/leave-types" replace />} /></> : <><Route path="/profile" element={<Profile profile={profile} />} /><Route path="/leave" element={<Leave api={api} />} /><Route path="/leave-types" element={<LeaveTypes />} /><Route path="*" element={<Navigate to="/profile" replace />} /></>}</Routes>
    </main></div>;
}

function Login({ api, signedIn, notice, onPreview }) {
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
      <button className="primary full" disabled={busy}>{busy ? 'Signing in…' : initial ? 'Change password and sign in' : 'Sign in'}</button>{import.meta.env.DEV && <button type="button" className="full preview-access" onClick={onPreview} disabled={busy}>Open leave types preview</button>}<p className="help">Need an account or email confirmation? Contact your HR administrator.</p></form></div></div>;
}

function Profile({ profile, title = 'My employee profile', action, help = 'To correct your employee details, contact HR.' }) {
  const fields = [['Payroll number', profile.CustomerIndividualPayrollNumbers], ['Email', profile.CustomerAddressEmail], ['Mobile', profile.CustomerAddressMobileLine], ['Start date', dateText(profile.EmploymentStartDate)], ['Department', profile.DepartmentDescription], ['Designation', profile.DesignationDescription], ['Branch', profile.BranchDescription], ['Employment type', profile.EmployeeTypeDescription], ['NSSF number', profile.NationalSocialSecurityFundNumber], ['SHA / NHIF number', profile.NationalHospitalInsuranceFundNumber]];
  return <Card title={title} action={action}><div className="profile-heading"><div className="avatar">{(profile.CustomerIndividualFirstName || profile.CustomerFullName || 'E').slice(0, 1)}</div><div><h2>{profile.CustomerFullName || 'Employee'}</h2><p className="muted">{profile.DesignationDescription || 'Your employment record'}</p></div></div><dl className="details-grid">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl><p className="help">{help}</p></Card>;
}

function Employees({ api }) {
  const navigate = useNavigate();
  const [page, setPage] = useState(0); const [data, setData] = useState(null);
  const [error, setError] = useState(null); const [loading, setLoading] = useState(true); const [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError(null);
    api.employees(page, { signal: abort.signal })
      .then(result => { if (!abort.signal.aborted) setData(result); })
      .catch(e => { if (e.name !== 'AbortError') setError(e); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [api, page, revision]);
  return <Card title="Employees">
    <p className="muted section-intro">Temporary test records from the Supabase mirror table.</p><Feedback error={error} />
    <div className="list-wrapper"><div className="list-header"><span>Employee</span><span>Department</span><span>Branch</span><span>Actions</span></div>
      {loading ? <div className="empty" role="status">Loading employees…</div> : error ? <div className="empty"><button onClick={() => setRevision(x => x + 1)}>Try again</button></div> : data?.PageCollection?.length ? data.PageCollection.map(item => <div className="list-row" key={item.Id}><div><strong>{item.CustomerFullName || 'Unnamed employee'}</strong><small>{item.CustomerIndividualPayrollNumbers ? `Payroll ${item.CustomerIndividualPayrollNumbers}` : 'No payroll number'}</small></div><div>{item.DepartmentDescription || '—'}<small>{item.DesignationDescription}</small></div><span>{item.BranchDescription || '—'}</span><div><button onClick={() => navigate(`/employees/${encodeURIComponent(item.Id)}`)}>View profile</button></div></div>) : <div className="empty"><strong>No employees yet</strong><p>Add rows to the employee_mirror table in Supabase to see them here.</p></div>}</div>
    <div className="pagination"><button disabled={loading || page === 0} onClick={() => setPage(x => x - 1)}>Prev</button><span>Page {page + 1} of {Math.max(1, data?.TotalPages || 1)}</span><button disabled={loading || page + 1 >= (data?.TotalPages || 1)} onClick={() => setPage(x => x + 1)}>Next</button></div>
  </Card>;
}

function EmployeeDetail({ api }) {
  const { id } = useParams(); const navigate = useNavigate();
  const [employee, setEmployee] = useState(null); const [error, setError] = useState(null); const [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setEmployee(null); setError(null);
    api.employee(id, { signal: abort.signal })
      .then(result => { if (!abort.signal.aborted) setEmployee(result); })
      .catch(e => { if (e.name !== 'AbortError') setError(e); });
    return () => abort.abort();
  }, [api, id, revision]);
  const back = <button onClick={() => navigate('/employees')}>Back to employees</button>;
  if (error) return <Card title="Employee profile" action={back}><Feedback error={error} />{error.status !== 404 && <div className="empty"><button onClick={() => setRevision(x => x + 1)}>Try again</button></div>}</Card>;
  if (!employee) return <Card title="Employee profile" action={back}><div className="empty" role="status">Loading employee profile…</div></Card>;
  return <Profile profile={employee} title="Employee profile" action={back} help="Test record from the Supabase mirror table. Edit it in the Supabase dashboard." />;
}

function LeaveTypes() {
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

  return <Card title="Leave types">
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
