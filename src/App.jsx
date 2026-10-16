import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { createApiClient } from './lib/api.js';
import { createMirrorApiClient } from './lib/mirrorApi.js';
import { supabase } from './lib/supabase.js';

// TEMPORARY: 'supabase' signs in with Supabase Auth and shows test employee data from the Supabase mirror table until the ERP HR APIs are ready.
const usesMirror = import.meta.env.VITE_EMPLOYEE_DATA_SOURCE === 'supabase';

const dateText = (value) => value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function Feedback({ error }) { return error ? <div className="feedback" role="alert">{error.message || error}{error.correlationId && <small>Reference: {error.correlationId}</small>}</div> : null; }
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }
function Card({ title, children, action }) { return <section className="page-card"><header className="card-header"><h1>{title}</h1>{action}</header>{children}</section>; }

export default function App() {
  const [profile, setProfile] = useState(null);
  const [mirrorUser, setMirrorUser] = useState(null);
  const [notice, setNotice] = useState('');
  const navigate = useNavigate();
  const api = useMemo(() => {
    const onUnauthorized = () => { setProfile(null); setMirrorUser(null); setNotice('Your session has ended. Please sign in again.'); };
    return usesMirror ? createMirrorApiClient({ supabase, onUnauthorized })
      : createApiClient({ baseUrl: import.meta.env.VITE_API_BASE_URL || '/api', onUnauthorized });
  }, []);
  async function signedIn(result) {
    if (!result?.token) throw new Error('The sign-in response did not include a session token.');
    if (usesMirror) { setMirrorUser(result.email); setNotice(''); navigate('/employees'); return; }
    api.setToken(result.token);
    try {
      const employee = await api.profile();
      if (!employee?.Id) throw new Error('The employee profile response was incomplete. Contact HR.');
      setProfile(employee); setNotice(''); navigate('/profile');
    }
    catch (error) { api.clearToken(); throw error; }
  }
  function logout() { api.clearToken(); setProfile(null); setMirrorUser(null); setNotice(''); navigate('/login'); }
  if (usesMirror && mirrorUser) return <Shell home="/employees" label="EMPLOYEE RECORDS" nav={<><NavLink to="/employees">Employees</NavLink><NavLink to="/payslips">Payslips</NavLink><NavLink to="/p9">P9 forms</NavLink></>}
    footer={<><span>{mirrorUser}</span><button onClick={logout}>Sign out</button></>} greeting="Employee records" status="Supabase test data">
    <Routes><Route path="/employees" element={<Employees api={api} />} /><Route path="/employees/:id" element={<EmployeeDetail api={api} />} />
      <Route path="/payslips" element={<Payslips api={api} />} /><Route path="/p9" element={<P9Forms api={api} />} /><Route path="*" element={<Navigate to="/employees" replace />} /></Routes>
  </Shell>;
  if (usesMirror || !profile) return <Login api={api} signedIn={signedIn} notice={notice} />;
  return <Shell home="/profile" label="EMPLOYEE SELF-SERVICE" nav={<><NavLink to="/profile">My profile</NavLink><NavLink to="/leave">My leave</NavLink><NavLink to="/payslips">My payslips</NavLink><NavLink to="/p9">My P9</NavLink></>}
    footer={<><span>{profile.CustomerFullName || 'Employee'}</span><button onClick={logout}>Sign out</button></>}
    greeting={`Welcome, ${profile.CustomerIndividualFirstName || 'colleague'}`} status="Employee portal">
    <Routes><Route path="/profile" element={<Profile profile={profile} />} /><Route path="/leave" element={<Leave api={api} />} />
      <Route path="/payslips" element={<NotConnected title="My payslips" items="payslips" />} /><Route path="/p9" element={<NotConnected title="My P9 forms" items="P9 forms" />} /><Route path="*" element={<Navigate to="/profile" replace />} /></Routes>
  </Shell>;
}

function Shell({ home, label, nav, footer, greeting, status, children }) {
  return <div className="app-shell">
    <aside className="sidebar"><Link className="brand" to={home}><span className="brand-icon">S</span><span>Swift<span className="brand-sub">HR PORTAL</span></span></Link>
      <p className="nav-label">{label}</p><nav>{nav}</nav>
      <div className="sidebar-bottom">{footer}</div></aside>
    <main><div className="topbar"><span>{greeting}</span><span className="status-dot">{status}</span></div>{children}</main></div>;
}

function Login({ api, signedIn, notice }) {
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
    <div className="login-panel"><form onSubmit={submit}><p className="eyebrow">EMPLOYEE SELF-SERVICE</p><h2>{initial ? 'Choose your password' : 'Welcome back'}</h2><p className="muted">{initial ? 'Replace your temporary password to continue.' : usesMirror ? 'Sign in with your Supabase development account.' : 'Sign in with your ERP account.'}</p>{notice && <p role="status">{notice}</p>}<Feedback error={error} />
      <Field label="Username"><input required autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} disabled={busy || initial} /></Field>
      <Field label={initial ? 'Temporary password' : 'Password'}><input required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></Field>
      {initial && <><Field label="New password"><input required type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} /></Field><Field label="Confirm new password"><input required type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></Field></>}
      <button className="primary full" disabled={busy}>{busy ? 'Signing in…' : initial ? 'Change password and sign in' : 'Sign in'}</button><p className="help">Need an account or email confirmation? Contact your HR administrator.</p></form></div></div>;
}

function Profile({ profile, title = 'My employee profile', action, notice, help = 'To correct your employee details, contact HR.' }) {
  const fields = [['Payroll number', profile.CustomerIndividualPayrollNumbers], ['Email', profile.CustomerAddressEmail], ['Mobile', profile.CustomerAddressMobileLine], ['Start date', dateText(profile.EmploymentStartDate)], ['Department', profile.DepartmentDescription], ['Designation', profile.DesignationDescription], ['Branch', profile.BranchDescription], ['Employment type', profile.EmployeeTypeDescription], ['NSSF number', profile.NationalSocialSecurityFundNumber], ['SHA / NHIF number', profile.NationalHospitalInsuranceFundNumber]];
  return <Card title={title} action={action}>{notice && <p className="success" role="status">{notice}</p>}<div className="profile-heading"><div className="avatar">{(profile.CustomerIndividualFirstName || profile.CustomerFullName || 'E').slice(0, 1)}</div><div><h2>{profile.CustomerFullName || 'Employee'}</h2><p className="muted">{profile.DesignationDescription || 'Your employment record'}</p></div></div><dl className="details-grid">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl><p className="help">{help}</p></Card>;
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
  const [editing, setEditing] = useState(false); const [success, setSuccess] = useState('');
  useEffect(() => {
    const abort = new AbortController(); setEmployee(null); setError(null); setEditing(false); setSuccess('');
    api.employee(id, { signal: abort.signal })
      .then(result => { if (!abort.signal.aborted) setEmployee(result); })
      .catch(e => { if (e.name !== 'AbortError') setError(e); });
    return () => abort.abort();
  }, [api, id, revision]);
  const back = <button onClick={() => navigate('/employees')}>Back to employees</button>;
  if (error) return <Card title="Employee profile" action={back}><Feedback error={error} />{error.status !== 404 && <div className="empty"><button onClick={() => setRevision(x => x + 1)}>Try again</button></div>}</Card>;
  if (!employee) return <Card title="Employee profile" action={back}><div className="empty" role="status">Loading employee profile…</div></Card>;
  if (editing) return <EditEmployee api={api} employee={employee} onCancel={() => setEditing(false)}
    onSaved={updated => { setEmployee(updated); setEditing(false); setSuccess('Details updated.'); }} />;
  const actions = <div className="card-actions"><button onClick={() => { setSuccess(''); setEditing(true); }}>Edit details</button>{back}</div>;
  return <Profile profile={employee} title="Employee profile" action={actions} notice={success} help="Test record from the Supabase mirror table." />;
}

// Loads data for a list and reloads it when deps change or retry() is called; obsolete requests are cancelled.
function useLoader(load, deps) {
  const [data, setData] = useState(null); const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true); const [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError(null);
    load(abort.signal).then(result => { if (!abort.signal.aborted) setData(result); })
      .catch(e => { if (e.name !== 'AbortError') setError(e); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [...deps, revision]);
  return { data, error, loading, retry: () => setRevision(x => x + 1) };
}

const money = value => value == null ? '—' : new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(value);
const monthText = (year, month) => new Date(year, month - 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

function DownloadButton({ api, path }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null);
  if (!path) return <span className="muted">No PDF</span>;
  async function open() {
    // Open the tab before waiting for the link, so pop-up blockers treat it as part of the click.
    const tab = window.open('', '_blank'); setBusy(true); setError(null);
    try { const url = await api.documentUrl(path); if (tab) { tab.opener = null; tab.location.href = url; } else window.location.href = url; }
    catch (e) { tab?.close(); setError(e); } finally { setBusy(false); }
  }
  return <div><button onClick={open} disabled={busy}>{busy ? 'Opening…' : 'Download PDF'}</button>{error && <small className="row-error" role="alert">{error.message}</small>}</div>;
}

function EmployeeCell({ employee }) {
  return <div><strong>{employee?.CustomerFullName || 'Unknown employee'}</strong><small>{employee?.CustomerIndividualPayrollNumbers ? `Payroll ${employee.CustomerIndividualPayrollNumbers}` : 'No payroll number'}</small></div>;
}

function Pagination({ page, setPage, loading, totalPages }) {
  return <div className="pagination"><button disabled={loading || page === 0} onClick={() => setPage(x => x - 1)}>Prev</button><span>Page {page + 1} of {Math.max(1, totalPages || 1)}</span><button disabled={loading || page + 1 >= (totalPages || 1)} onClick={() => setPage(x => x + 1)}>Next</button></div>;
}

function Payslips({ api }) {
  const [page, setPage] = useState(0);
  const { data, error, loading, retry } = useLoader(signal => api.payslips(page, { signal }), [api, page]);
  return <Card title="Payslips">
    <p className="muted section-intro">Test payslips for all employees from the Supabase mirror. Figures are entered by hand, not calculated.</p><Feedback error={error} />
    <div className="list-wrapper"><div className="list-header"><span>Employee</span><span>Pay period</span><span>Net pay</span><span>Actions</span></div>
      {loading ? <div className="empty" role="status">Loading payslips…</div> : error ? <div className="empty"><button onClick={retry}>Try again</button></div> : data?.PageCollection?.length ? data.PageCollection.map(item => <div className="list-row" key={item.Id}><EmployeeCell employee={item.Employee} /><span>{monthText(item.Year, item.Month)}</span><div><strong>{money(item.NetPay)}</strong><small>Gross {money(item.GrossPay)} · Deductions {money(item.TotalDeductions)}</small></div><DownloadButton api={api} path={item.FilePath} /></div>) : <div className="empty"><strong>No payslips yet</strong><p>Add rows to the payslip_mirror table in Supabase to see them here.</p></div>}</div>
    <Pagination page={page} setPage={setPage} loading={loading} totalPages={data?.TotalPages} />
  </Card>;
}

function P9Forms({ api }) {
  const [page, setPage] = useState(0);
  const { data, error, loading, retry } = useLoader(signal => api.p9Forms(page, { signal }), [api, page]);
  return <Card title="P9 forms">
    <p className="muted section-intro">Test P9 tax deduction cards for all employees from the Supabase mirror, one per employee per year.</p><Feedback error={error} />
    <div className="list-wrapper"><div className="list-header"><span>Employee</span><span>Tax year</span><span>Document</span><span>Actions</span></div>
      {loading ? <div className="empty" role="status">Loading P9 forms…</div> : error ? <div className="empty"><button onClick={retry}>Try again</button></div> : data?.PageCollection?.length ? data.PageCollection.map(item => <div className="list-row" key={item.Id}><EmployeeCell employee={item.Employee} /><span>{item.Year}</span><span>P9 tax deduction card</span><DownloadButton api={api} path={item.FilePath} /></div>) : <div className="empty"><strong>No P9 forms yet</strong><p>Add rows to the p9_mirror table in Supabase to see them here.</p></div>}</div>
    <Pagination page={page} setPage={setPage} loading={loading} totalPages={data?.TotalPages} />
  </Card>;
}

// ERP mode: the payroll API is not connected yet, so show an honest empty state instead of calling it.
function NotConnected({ title, items }) {
  return <Card title={title}><div className="list-wrapper"><div className="empty"><strong>No {items} yet</strong><p>Your {items} will appear here once the payroll service is connected to the HR portal.</p></div></div></Card>;
}

const EDIT_FIELDS = [
  ['CustomerFullName', 'Full name', { required: true, maxLength: 200 }], ['CustomerIndividualFirstName', 'First name', { maxLength: 100 }],
  ['CustomerIndividualPayrollNumbers', 'Payroll number', { maxLength: 50 }], ['CustomerAddressEmail', 'Email', { type: 'email', maxLength: 254 }],
  ['CustomerAddressMobileLine', 'Mobile', { type: 'tel', maxLength: 20 }], ['EmploymentStartDate', 'Start date', { type: 'date' }],
  ['DepartmentDescription', 'Department', { maxLength: 100 }], ['DesignationDescription', 'Designation', { maxLength: 100 }],
  ['BranchDescription', 'Branch', { maxLength: 100 }], ['EmployeeTypeDescription', 'Employment type', { maxLength: 100 }],
  ['NationalSocialSecurityFundNumber', 'NSSF number', { maxLength: 50 }], ['NationalHospitalInsuranceFundNumber', 'SHA / NHIF number', { maxLength: 50 }],
];

function EditEmployee({ api, employee, onCancel, onSaved }) {
  const [form, setForm] = useState(() => Object.fromEntries(EDIT_FIELDS.map(([field, , { type }]) =>
    [field, type === 'date' ? (employee[field] || '').slice(0, 10) : employee[field] || ''])));
  const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  function set(field, value) { setError(null); setForm(x => ({ ...x, [field]: value })); }
  async function submit(event) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(null);
    try { onSaved(await api.updateEmployee(employee.Id, form)); } catch (error) { setError(error); setBusy(false); }
  }
  return <Card title="Edit employee details" action={<button onClick={onCancel} disabled={busy}>Cancel</button>}>
    <div className="profile-heading"><div className="avatar">{(employee.CustomerIndividualFirstName || employee.CustomerFullName || 'E').slice(0, 1)}</div><div><h2>{employee.CustomerFullName || 'Employee'}</h2><p className="muted">{employee.DesignationDescription || 'Employee record'}</p></div></div>
    <form className="request-form" onSubmit={submit}><Feedback error={error} /><div className="form-grid">
      {EDIT_FIELDS.map(([field, label, { type = 'text', ...rest }]) => <Field key={field} label={label}><input type={type} {...rest} autoComplete="off" value={form[field]} onChange={e => set(field, e.target.value)} disabled={busy} /></Field>)}</div>
      <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
    </form><p className="help">Leave a field empty to clear it. Full name is required.</p></Card>;
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
