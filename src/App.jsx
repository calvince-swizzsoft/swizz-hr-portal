import { Component, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { createPortalClient } from './lib/portalClient.js';
import { uniqueLeaveTypes } from './lib/leaveTypes.js';

const dateText = value => value ? new Date(String(value).slice(0, 10) + 'T12:00:00').toLocaleDateString() : '\u2014';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const nextDate = value => { const [year, month, day] = value.split('-').map(Number); const date = new Date(Date.UTC(year, month - 1, day + 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`; };
function Feedback({ error }) { return error ? <div className="feedback" role="alert">{error.message || error}{error.correlationId && <small>Reference: {error.correlationId}</small>}</div> : null; }
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }
function Card({ title, children, action }) { return <section className="page-card"><header className="card-header"><h1>{title}</h1>{action}</header>{children}</section>; }
function useLoad(load, dependencies) {
  const [data, setData] = useState(null); const [error, setError] = useState(null); const [loading, setLoading] = useState(true); const [revision, setRevision] = useState(0);
  const [loadedFor, setLoadedFor] = useState(null);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setData(null); setError(null);
    Promise.resolve().then(() => load(abort.signal)).then(value => { if (!abort.signal.aborted) setData(value); }).catch(e => { if (!abort.signal.aborted) setError(e); }).finally(() => { if (!abort.signal.aborted) { setLoadedFor([...dependencies, revision]); setLoading(false); } });
    return () => abort.abort();
  }, [...dependencies, revision]);
  const current = loadedFor?.length === dependencies.length + 1 && [...dependencies, revision].every((value, index) => Object.is(value, loadedFor[index]));
  return { data: current ? data : null, error: current ? error : null, loading: loading || !current, retry: () => setRevision(x => x + 1) };
}
// Shows a message instead of a blank page when a screen fails to render; the sidebar stays usable.
class ScreenErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <Card title="Something went wrong"><div className="feedback" role="alert">This page could not be displayed. Try again, or contact support with the details below.<small>{String(this.state.error?.message || this.state.error)}</small></div><button onClick={() => { this.setState({ error: null }); this.props.onHome(); }}>{this.props.homeLabel || 'Back to my profile'}</button></Card>;
  }
}
function LoadState({ state }) {
  return state.loading ? <div className="empty" role="status">Loading...</div> : state.error ? <><Feedback error={state.error} /><button onClick={state.retry}>Try again</button></> : null;
}
function useRefreshOnFocus(refresh) {
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => {
    let lastRefresh = 0;
    function refreshVisiblePage() {
      if (document.visibilityState === 'hidden' || Date.now() - lastRefresh < 750) return;
      lastRefresh = Date.now();
      refreshRef.current();
    }
    window.addEventListener('focus', refreshVisiblePage);
    document.addEventListener('visibilitychange', refreshVisiblePage);
    return () => {
      window.removeEventListener('focus', refreshVisiblePage);
      document.removeEventListener('visibilitychange', refreshVisiblePage);
    };
  }, []);
}
export default function App() {
  const [profile, setProfile] = useState(null); const [isApprover, setIsApprover] = useState(false); const [notice, setNotice] = useState(''); const navigate = useNavigate(); const { pathname } = useLocation();
  const api = useMemo(() => createPortalClient({ source: import.meta.env.VITE_DATA_SOURCE || 'erp', baseUrl: import.meta.env.VITE_API_BASE_URL || '/api', supabaseUrl: import.meta.env.VITE_SUPABASE_URL, supabaseKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, onUnauthorized: () => { setProfile(null); setIsApprover(false); setNotice('Your session has ended. Please sign in again.'); } }), []);
  async function signedIn(result) {
    if (!result?.token) throw new Error('The sign-in response did not include a session token.');
    api.setToken(result.token);
    try {
      const employee = await api.profile(); if (!employee?.Id) throw new Error('Employee profile is incomplete. Contact HR.');
      // Accounts allowed to read the pending queue (permission 22017) also get approval screens.
      // This only chooses screens; the ERP or development RPC still enforces every permission. A failed check keeps the employee view.
      const approver = await api.processingApplications({ status: 1, pageIndex: 0, pageSize: 1 }).then(() => true, error => { if (error.status === 401) throw error; return false; });
      setIsApprover(approver); setProfile(employee); setNotice(''); navigate(approver ? '/approvals' : '/profile');
    }
    catch (error) { await api.clearToken(); throw error; }
  }
  async function logout() { setProfile(null); setIsApprover(false); setNotice(''); navigate('/login'); await api.clearToken(); }
  if (!profile) return <Login api={api} signedIn={signedIn} notice={notice} />;
  const home = isApprover ? '/approvals' : '/profile';
  return <div className="app-shell"><aside className="sidebar"><NavLink className="brand" to={home}><span className="brand-icon">S</span><span>Swift<span className="brand-sub">HR PORTAL</span></span></NavLink>
    <p className="nav-label">EMPLOYEE SELF-SERVICE</p><nav><NavLink to="/profile">My profile</NavLink><NavLink to="/leave">My leave</NavLink><NavLink to="/leave-types">Leave types</NavLink><NavLink to="/balances">Leave balances</NavLink><NavLink to="/remaining">Remaining</NavLink></nav>
    {isApprover && <><p className="nav-label">LEAVE APPROVALS</p><nav><NavLink to="/approvals">Approvals</NavLink>{api.source === 'supabase' && <NavLink to="/settings">Settings</NavLink>}</nav></>}
    <div className="sidebar-bottom"><span>{profile.CustomerFullName}</span><button onClick={logout}>Sign out</button></div></aside>
    <main><div className="topbar"><span>Welcome, {profile.CustomerIndividualFirstName || 'colleague'}</span><span className="status-dot">{isApprover ? 'Leave approver' : 'Employee portal'}</span></div><ScreenErrorBoundary key={pathname} onHome={() => navigate(home)} homeLabel={isApprover ? 'Back to approvals' : 'Back to my profile'}><Routes>
      <Route path="/profile" element={<Profile api={api} profile={profile} onUpdated={setProfile} />} /><Route path="/leave" element={<Leave api={api} />} /><Route path="/leave-types" element={<LeaveTypes api={api} isApprover={isApprover} />} /><Route path="/leave-type" element={<LeaveTypes api={api} isApprover={isApprover} />} /><Route path="/processing/leave" element={<Navigate to="/approvals" replace />} /><Route path="/leave/:id" element={<Navigate to="/leave" replace />} /><Route path="/balances" element={<Balances api={api} />} /><Route path="/remaining" element={<Remaining api={api} />} /><Route path="/applications" element={<Navigate to="/leave" replace />} />
      {isApprover && api.source === 'supabase' && <Route path="/settings" element={<Settings api={api} />} />}
      {isApprover && <><Route path="/approvals" element={<Approvals api={api} profile={profile} />} /><Route path="/approvals/:id" element={<ApprovalReview api={api} profile={profile} />} /></>}<Route path="*" element={<Navigate to={home} replace />} />
    </Routes></ScreenErrorBoundary></main></div>;
}
function Login({ api, signedIn, notice }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [newPassword, setNewPassword] = useState(''); const [confirmPassword, setConfirmPassword] = useState('');
  const [initial, setInitial] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(null);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(null);
    try { const result = initial ? await api.changeInitialPassword({ UserName: username, CurrentPassword: password, NewPassword: newPassword, ConfirmPassword: confirmPassword }) : await api.login({ UserName: username, Password: password }); if (result.requiresPasswordChange) { setInitial(true); return; } await signedIn(result); setPassword(''); setNewPassword(''); setConfirmPassword(''); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }
  return <div className="login-shell"><div className="login-intro"><div className="brand"><span className="brand-icon">S</span>Swift HR Portal</div><div><h1>Swift HR Portal</h1><p>Keep up with your employee details and plan your time away.</p></div><small>Swift Financials</small></div><div className="login-panel"><form onSubmit={submit}><h2>{initial ? 'Choose your password' : 'Welcome back'}</h2>{notice && <p role="status">{notice}</p>}<Feedback error={error} />
    <Field label={api.loginLabel}><input required autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} disabled={busy || initial} /></Field><Field label={initial ? 'Temporary password' : 'Password'}><input required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></Field>
    {initial && <><Field label="New password"><input required type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} disabled={busy} /></Field><Field label="Confirm new password"><input required type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} disabled={busy} /></Field></>}
    <button className="primary full" disabled={busy}>{busy ? 'Signing in...' : initial ? 'Change password and sign in' : 'Sign in'}</button><p className="help">Need an account? Contact your HR administrator.</p></form></div></div>;
}
function Profile({ api, profile, onUpdated }) {
  const [editing, setEditing] = useState(false); const [success, setSuccess] = useState('');
  const fields = [['Payroll number', profile.CustomerIndividualPayrollNumbers], ['Email', profile.CustomerAddressEmail], ['Mobile', profile.CustomerAddressMobileLine], ['Start date', dateText(profile.EmploymentStartDate)], ['Department', profile.DepartmentDescription], ['Designation', profile.DesignationDescription], ['Branch', profile.BranchDescription], ['Employment type', profile.EmployeeTypeDescription], ['NSSF number', profile.NationalSocialSecurityFundNumber], ['SHA / NHIF number', profile.NationalHospitalInsuranceFundNumber]];
  const heading = <div className="profile-heading"><div className="avatar">{(profile.CustomerIndividualFirstName || 'E').slice(0, 1)}</div><div><h2>{profile.CustomerFullName}</h2><p className="muted">{profile.DesignationDescription}</p></div></div>;
  if (editing) return <Card title="Edit my details">{heading}<ProfileForm api={api} profile={profile} onClose={() => setEditing(false)} onSaved={saved => { onUpdated(saved); setEditing(false); setSuccess('Your details were updated.'); }} /></Card>;
  return <Card title="My employee profile" action={api.canEditProfile && <button onClick={() => { setSuccess(''); setEditing(true); }}>Edit my details</button>}>{success && <p className="success" role="status">{success}</p>}{heading}<dl className="details-grid">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '\u2014'}</dd></div>)}</dl><p className="help">{api.canEditProfile ? 'You can update your email and mobile. To change other details, contact HR.' : 'To correct your employee details, contact HR.'}</p></Card>;
}
function ProfileForm({ api, profile, onClose, onSaved }) {
  const [form, setForm] = useState({ CustomerAddressEmail: profile.CustomerAddressEmail || '', CustomerAddressMobileLine: profile.CustomerAddressMobileLine || '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null);
  function set(field, value) { setError(null); setForm(current => ({ ...current, [field]: value })); }
  async function submit(event) { event.preventDefault(); if (busy) return; setBusy(true); setError(null); try { onSaved(await api.updateProfile(form)); } catch (e) { setError(e); setBusy(false); } }
  return <form className="request-form" onSubmit={submit}><div className="form-heading"><h2>Contact details</h2><button type="button" onClick={onClose} disabled={busy}>Cancel</button></div><Feedback error={error} /><div className="form-grid">
    <Field label="Email"><input type="email" maxLength={254} autoComplete="email" value={form.CustomerAddressEmail} onChange={e => set('CustomerAddressEmail', e.target.value)} disabled={busy} /></Field>
    <Field label="Mobile"><input type="tel" maxLength={20} autoComplete="tel" value={form.CustomerAddressMobileLine} onChange={e => set('CustomerAddressMobileLine', e.target.value)} disabled={busy} /></Field></div>
    <button className="primary" disabled={busy}>{busy ? 'Saving...' : 'Save changes'}</button><p className="help">Leave email or mobile empty to clear it. Names, payroll, statutory and employment details are managed by HR.</p></form>;
}
function LeaveTypes({ api, isApprover }) {
  const state = useLoad(async signal => uniqueLeaveTypes(await api.leaveTypes({ signal })), [api]);
  const navigate = useNavigate();
  const [selectedType, setSelectedType] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState('');
  const canManage = api.source === 'supabase' && isApprover;
  async function saveBalance(event) {
    event.preventDefault();
    if (busy || !selectedType) return;
    const formElement = event.currentTarget;
    const values = new FormData(formElement);
    const asAt = String(values.get('AsAt') || '');
    const cycleStart = String(values.get('CycleStart') || '');
    const cycleEnd = String(values.get('CycleEnd') || '');
    if (cycleEnd < cycleStart || asAt < cycleStart || asAt > cycleEnd) {
      setError(new Error('Choose a cycle range that includes the balance as-at date.'));
      return;
    }
    setBusy(true); setError(null); setSuccess('');
    try {
      const result = await api.configureLeaveTypeBalance({
        LeaveTypeId: selectedType,
        Entitlement: Number(values.get('Entitlement')),
        IsAccrued: values.get('IsAccrued') === 'true',
        UnitType: Number(values.get('UnitType')),
        UnitTypeDescription: String(values.get('UnitTypeDescription') || ''),
        ExcludeHolidays: values.get('ExcludeHolidays') === 'on',
        ExcludeWeekends: values.get('ExcludeWeekends') === 'on',
        AsAt: asAt, CycleStart: cycleStart, CycleEnd: cycleEnd,
        Used: Number(values.get('Used')), Reserved: Number(values.get('Reserved')),
        Available: Number(values.get('Available')),
      });
      const type = state.data.find(item => item.Id === selectedType);
      setSuccess(`${type?.Description || 'Leave type'} balance configured for ${result.EmployeeCount} employees, as at ${dateText(result.AsAt)}.`);
      state.retry();
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  return <Card title="Leave types">
    <LoadState state={state} />
    {success && <p className="success" role="status">{success}</p>}
    {canManage && selectedType && <form className="request-form fixture-form" onSubmit={saveBalance}>
      <div className="form-heading"><h2>Set up {state.data?.find(item => item.Id === selectedType)?.Description} balance</h2><button type="button" onClick={() => { setSelectedType(''); setError(null); setSuccess(''); }} disabled={busy}>Cancel</button></div>
      <p className="section-intro">Configure an existing leave type for all unlocked employees. This does not create another type or change ERP data.</p>
      <div className="form-grid">
        <Field label="Entitlement"><input name="Entitlement" required type="number" min="0" step="0.01" /></Field>
        <Field label="Unit type code"><input name="UnitType" required type="number" min="0" step="1" defaultValue="3" /></Field>
        <Field label="Unit description"><input name="UnitTypeDescription" required maxLength={40} defaultValue="Yearly" /></Field>
        <Field label="Accrued"><select name="IsAccrued" defaultValue="false"><option value="false">No</option><option value="true">Yes</option></select></Field>
        <Field label="Balance as at"><input name="AsAt" type="date" required defaultValue={today()} /></Field>
        <Field label="Cycle start"><input name="CycleStart" type="date" required defaultValue={`${today().slice(0, 4)}-01-01`} /></Field>
        <Field label="Cycle end"><input name="CycleEnd" type="date" required defaultValue={`${today().slice(0, 4)}-12-31`} /></Field>
        <Field label="Used"><input name="Used" required type="number" min="0" step="0.01" defaultValue="0" /></Field>
        <Field label="Pending"><input name="Reserved" required type="number" min="0" step="0.01" defaultValue="0" /></Field>
        <Field label="Available"><input name="Available" required type="number" min="0" step="0.01" /></Field>
      </div>
      <div className="tabs"><label><input name="ExcludeHolidays" type="checkbox" defaultChecked /> Exclude holidays</label><label><input name="ExcludeWeekends" type="checkbox" defaultChecked /> Exclude weekends</label></div>
      <Feedback error={error} />
      <button className="primary" disabled={busy}>{busy ? 'Saving...' : 'Save balance setup'}</button>
    </form>}
    {state.data && <div className="list-wrapper">{state.data.length ? state.data.map(type => <div className="list-row type-row" key={type.Id}><strong>{type.Description}</strong><span>{type.Entitlement == null ? 'Balance setup required' : `${type.Entitlement} ${type.UnitTypeDescription || ''}`}</span><div className="row-actions">{canManage && type.Entitlement == null && <button onClick={() => { setSelectedType(type.Id); setError(null); setSuccess(''); }}>Set up balance</button>}<button onClick={() => navigate(`/balances?leaveTypeId=${encodeURIComponent(type.Id)}`)}>View balance</button></div></div>) : <div className="empty">No leave types available.</div>}</div>}
  </Card>;
}
function Settings({ api }) {
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState('');
  async function createType(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null); setSuccess('');
    try {
      const result = await api.createLeaveType({ Description: description });
      setSuccess(`${result.Description} was added. Go to Leave types to configure its balance.`);
      setDescription('');
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  return <Card title="Settings"><p className="muted section-intro">Manage development leave types. Creating a type does not set balances or affect ERP.</p>
    <form className="request-form" onSubmit={createType}>
      <div className="form-heading"><h2>Create leave type</h2></div>
      <Field label="Leave type name"><input required maxLength={100} value={description} onChange={event => { setDescription(event.target.value); setError(null); }} disabled={busy} /></Field>
      <Feedback error={error} />{success && <p className="success" role="status">{success}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Creating...' : 'Create leave type'}</button>
    </form>
  </Card>;
}
function Leave({ api }) {
  const [page, setPage] = useState(0); const [open, setOpen] = useState(false); const [busyId, setBusyId] = useState(null); const [error, setError] = useState(null); const [success, setSuccess] = useState('');
  const state = useLoad(async signal => { const [applications, types] = await Promise.all([api.applications(page, { signal }), api.leaveTypes({ signal })]); return { applications, types: uniqueLeaveTypes(types) }; }, [api, page]);
  useRefreshOnFocus(() => { if (!open) state.retry(); });
  async function withdraw(item) { if (!window.confirm('Withdraw this pending leave request?')) return; setBusyId(item.Id); setError(null); try { await api.withdraw(item.Id); setSuccess('Leave request withdrawn.'); state.retry(); } catch (e) { setError(e); } finally { setBusyId(null); } }
  const data = state.data?.applications;
  return <Card title="My leave" action={<div className="row-actions"><button onClick={state.retry} disabled={state.loading || !!busyId}>Refresh</button><button className="primary" onClick={() => setOpen(true)} disabled={!state.data}>Request leave</button></div>}><Feedback error={error} />{success && <p className="success" role="status">{success}</p>}<LoadState state={state} />
    {open && state.data && <LeaveForm api={api} types={state.data.types} onClose={() => setOpen(false)} onSaved={saved => { setOpen(false); setSuccess(saved.NotificationPending ? 'Request saved. The HR notification is pending.' : 'Leave request submitted.'); setPage(0); state.retry(); }} />}
    {data && <><div className="list-wrapper"><div className="list-header"><span>Leave type</span><span>Dates</span><span>Status</span><span>Actions</span></div>{data.PageCollection.length ? data.PageCollection.map(item => <div className="list-row" key={item.Id}><div><strong>{item.LeaveTypeDescription}</strong></div><span>{dateText(item.Start)} - {dateText(item.End)}</span><span className={`badge status-${item.Status}`}>{item.StatusDescription}</span><div className="row-actions">{item.Status === 1 && <button disabled={!!busyId} onClick={() => withdraw(item)}>{busyId === item.Id ? 'Withdrawing...' : 'Withdraw'}</button>}</div></div>) : <div className="empty">No leave requests yet.</div>}</div><div className="pagination"><button disabled={page === 0 || !!busyId} onClick={() => setPage(x => x - 1)}>Prev</button><span>Page {page + 1} of {Math.max(1, data.TotalPages)}</span><button disabled={page + 1 >= data.TotalPages || !!busyId} onClick={() => setPage(x => x + 1)}>Next</button></div></>}
  </Card>;
}
function ApplicationDetail({ api }) {
  const { id } = useParams(); const [editing, setEditing] = useState(false); const navigate = useNavigate();
  const state = useLoad(async signal => ({ application: await api.application(id, { signal }), types: uniqueLeaveTypes(await api.leaveTypes({ signal })) }), [api, id]); const item = state.data?.application;
  useRefreshOnFocus(() => { if (!editing) state.retry(); });
  return <Card title="Leave application" action={<div className="row-actions"><button onClick={state.retry} disabled={state.loading}>Refresh</button><button onClick={() => navigate('/leave')}>Back</button></div>}><LoadState state={state} />{item && <>{editing ? <LeaveForm key={item.Id} api={api} types={state.data.types} application={item} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); state.retry(); }} /> : <><dl className="details-grid">{[['Leave type', item.LeaveTypeDescription], ['Status', item.StatusDescription], ['Start', dateText(item.Start)], ['End', dateText(item.End)], ['Reason', item.Reason], ['Decision remarks', item.AuthorizationRemarks], ['Decision date', dateText(item.AuthorizedDate)], ['Recall remarks', item.RecallRemarks]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '\u2014'}</dd></div>)}</dl>{item.Status === 1 && <button className="primary" onClick={() => setEditing(true)}>Edit application</button>}</>}</>}</Card>;
}
function Balances({ api }) {
  const [searchParams] = useSearchParams(); const [leaveTypeId, setType] = useState(() => searchParams.get('leaveTypeId') || ''); const [asAt, setAsAt] = useState(today); const [page, setPage] = useState(0);
  const types = useLoad(async signal => uniqueLeaveTypes(await api.leaveTypes({ signal })), [api]); const state = useLoad(signal => leaveTypeId && asAt ? api.balances({ leaveTypeId, asAt, pageIndex: page }, { signal }) : null, [api, leaveTypeId, asAt, page]); const data = state.data;
  useRefreshOnFocus(state.retry);
  return <Card title="Leave balances" action={<button onClick={state.retry} disabled={!leaveTypeId || state.loading}>Refresh balance</button>}><LoadState state={types} /><div className="form-grid"><Field label="Leave type"><select value={leaveTypeId} onChange={e => { setType(e.target.value); setPage(0); }}><option value="">Select leave type</option>{types.data?.map(type => <option key={type.Id} value={type.Id}>{type.Description}</option>)}</select></Field><Field label="As at"><input type="date" value={asAt} onChange={e => { setAsAt(e.target.value); setPage(0); }} /></Field></div>
    {leaveTypeId && asAt ? <LoadState state={state} /> : <div className="empty">Select a leave type and date.</div>}{data && <><Feedback error={data.BalanceError} />{data.Balance && <><div className="balance-summary"><div><span>Leaves left</span><strong>{data.Balance.Available}</strong></div><div><span>Leaves used</span><strong>{data.Balance.Used}</strong></div></div><dl className="details-grid">{['Entitlement', 'Reserved'].map(key => <div key={key}><dt>{key}</dt><dd>{data.Balance[key]}</dd></div>)}</dl></>}<h2>Leave history</h2><div className="list-wrapper">{data.History.length ? data.History.map(item => <div className="list-row" key={item.Id}><span>{dateText(item.Start)} - {dateText(item.End)}</span><span>{item.Reason}</span><span>{({ 1: 'Pending', 2: 'Approved', 4: 'Rejected', 8: 'Recalled', 16: 'Withdrawn' })[item.Status] || 'Unknown'}</span><span>{item.ChargedDaysInYear} days</span></div>) : <div className="empty">No history for this period.</div>}</div><div className="pagination"><button disabled={page === 0} onClick={() => setPage(x => x - 1)}>Prev</button><span>Page {page + 1} of {Math.max(1, Math.ceil(data.HistoryCount / 10))}</span><button disabled={(page + 1) * 10 >= data.HistoryCount} onClick={() => setPage(x => x + 1)}>Next</button></div></>}</Card>;
}
// Summary of days remaining per eligible leave type, read from the balances operation; nothing is calculated here.
function Remaining({ api }) {
  const [asAt, setAsAt] = useState(today);
  const state = useLoad(async signal => {
    if (!asAt) return null;
    const types = uniqueLeaveTypes(await api.leaveTypes({ signal }));
    return Promise.all((Array.isArray(types) ? types : []).map(async type => {
      // One leave type without a balance for this date must not hide the others.
      try { return { type, statistics: await api.balances({ leaveTypeId: type.Id, asAt, pageIndex: 0 }, { signal }) }; }
      catch (error) { if (error.name === 'AbortError' || error.status === 401) throw error; return { type, error }; }
    }));
  }, [api, asAt]);
  useRefreshOnFocus(state.retry);
  const number = value => value == null || value === '' || Number.isNaN(Number(value)) ? '—' : Number(value);
  // The summary only adds up the figures shown in the rows; it does not apply any leave rules.
  const balances = (state.data || []).map(row => row.statistics?.Balance).filter(Boolean);
  const sum = key => balances.reduce((total, balance) => total + (Number(balance[key]) || 0), 0);
  const totalRemaining = balances.reduce((total, balance) => total + (Number(balance.Remaining ?? balance.Available) || 0), 0);
  return <Card title="Remaining leave" action={<button onClick={state.retry} disabled={!asAt || state.loading}>Refresh</button>}><p className="muted section-intro">Days you have left for each leave type. Pending requests are already deducted; the figures update after a request is approved, rejected or withdrawn.</p>
    <div className="form-grid"><Field label="As at"><input type="date" required value={asAt} onChange={e => setAsAt(e.target.value)} /></Field></div>
    {!asAt ? <div className="empty">Select a date.</div> : <LoadState state={state} />}
    {state.data && <div className="remaining-summary" role="status"><h2>Remaining leave summary</h2>{balances.length
      ? <p><strong className={`remaining-days${totalRemaining <= 0 ? ' none' : ''}`}>{totalRemaining}</strong> day(s) remaining across {balances.length} leave type{balances.length === 1 ? '' : 's'} · {sum('Reserved')} day(s) pending approval</p>
      : <p className="muted">No balances are available for this date.</p>}</div>}
    {state.data && <div className="list-wrapper"><div className="list-header remaining-row"><span>Leave type</span><span>Entitlement</span><span>Taken</span><span>Pending</span><span>Days remaining</span></div>
      {state.data.length ? state.data.map(({ type, statistics, error }) => {
        const balance = statistics?.Balance; const remaining = balance?.Remaining ?? balance?.Available;
        return <div className="list-row remaining-row" key={type.Id}><div><strong>{type.Description}</strong><small>{type.UnitTypeDescription}</small></div>
          {balance ? <><span><small>Entitlement</small>{number(balance.Entitlement)}</span><span><small>Taken</small>{number(balance.Used)}</span><span><small>Pending</small>{number(balance.Reserved)}</span>
            <span className={`remaining-days${remaining <= 0 ? ' none' : remaining <= 3 ? ' low' : ''}`}>{number(remaining)}<small>{remaining <= 0 ? 'none left' : remaining <= 3 ? 'day(s) remaining – running low' : 'day(s) remaining'}</small></span></>
            : <div className="remaining-missing"><strong>No balance available for this date.</strong><small>{statistics?.BalanceError || error?.message}</small></div>}</div>;
      }) : <div className="empty">No leave types available.</div>}</div>}
  </Card>;
}
function BalanceFixtureEditor({ api, application }) {
  const [editingBalance, setEditingBalance] = useState(false); const [balanceAsAt, setBalanceAsAt] = useState(today); const [balanceBusy, setBalanceBusy] = useState(false); const [balanceError, setBalanceError] = useState(null); const [balanceSuccess, setBalanceSuccess] = useState('');
  const balanceFixture = useLoad(signal => editingBalance && application && api.source === 'supabase'
    ? api.processingBalanceFixture({ action: 'get', applicationId: application.Id, asAt: balanceAsAt, pageIndex: 0 }, { signal })
    : null, [api, editingBalance, application?.Id, balanceAsAt]);
  async function saveBalanceFixture(event) {
    event.preventDefault(); if (!application || balanceBusy) return;
    const form = new FormData(event.currentTarget);
    setBalanceBusy(true); setBalanceError(null); setBalanceSuccess('');
    try {
      await api.processingBalanceFixture({
        action: 'save', applicationId: application.Id, asAt: balanceAsAt, pageIndex: 0,
        ...(balanceFixture.data?.Balance ? {} : { CycleStart: form.get('CycleStart'), CycleEnd: form.get('CycleEnd') }),
        Entitlement: Number(form.get('Entitlement')), Used: Number(form.get('Used')),
        Reserved: Number(form.get('Reserved')), Available: Number(form.get('Available')),
      });
      setBalanceSuccess('Employee balance fixture saved. Refresh the employee balance screen to see the update.');
      balanceFixture.retry();
    } catch (e) { setBalanceError(e); }
    finally { setBalanceBusy(false); }
  }
  return <section className="request-form fixture-form"><div className="form-heading"><h2>Employee balance fixture</h2><button onClick={() => { setEditingBalance(value => !value); setBalanceError(null); setBalanceSuccess(''); }}>{editingBalance ? 'Close editor' : 'Edit fixture'}</button></div><p className="section-intro">Approver-only development fixture. Changes appear on the employee's balance screen; they do not update ERP balances.</p>{editingBalance && <><div className="form-grid"><Field label="Balance as at"><input type="date" value={balanceAsAt} onChange={event => { setBalanceAsAt(event.target.value); setBalanceSuccess(''); }} /></Field></div><LoadState state={balanceFixture} />{!balanceFixture.loading && !balanceFixture.error && <>{balanceFixture.data?.Balance ? <p className="muted">Existing fixture loaded for {dateText(balanceAsAt)}.</p> : <p className="section-intro">No fixture exists for this employee and date. Enter cycle dates and values to create one.</p>}<form key={balanceAsAt + String(balanceFixture.loading)} onSubmit={saveBalanceFixture}><div className="form-grid">{!balanceFixture.data?.Balance && <><Field label="Cycle start"><input name="CycleStart" type="date" required defaultValue={`${balanceAsAt.slice(0, 4)}-01-01`} disabled={balanceBusy} /></Field><Field label="Cycle end"><input name="CycleEnd" type="date" required defaultValue={`${balanceAsAt.slice(0, 4)}-12-31`} disabled={balanceBusy} /></Field></>}{['Entitlement', 'Used', 'Reserved', 'Available'].map(key => <Field key={key} label={key}><input name={key} type="number" min="0" step="0.01" required defaultValue={balanceFixture.data?.Balance?.[key] ?? ''} disabled={balanceBusy} /></Field>)}</div><Feedback error={balanceError} />{balanceSuccess && <p role="status" className="success">{balanceSuccess}</p>}<button className="primary" disabled={balanceBusy}>{balanceBusy ? 'Saving...' : balanceFixture.data?.Balance ? 'Save fixture' : 'Create fixture'}</button></form></>}</>}</section>;
}
function PreviewSummary({ preview }) {
  return <div className="balance-preview"><strong>{preview.RequestedDays ?? 0} chargeable day(s)</strong><Feedback error={preview.Error} />{(Array.isArray(preview.Cycles) ? preview.Cycles : []).map((cycle, i) => <div key={i}><span>{dateText(cycle.Start)} - {dateText(cycle.End)}</span><p>Available: {cycle.Available} | Requested: {cycle.Requested} | Remaining: {cycle.Remaining}</p></div>)}</div>;
}
// Processing permission is checked by the ERP or development RPC; a 403 shows no records and no permission toggle.
// A reply without the expected fields usually means the Supabase project lacks the leave-workflow migration.
const unexpectedProcessingReply = 'The approvals service returned incomplete request details. Refresh or contact HR.';
function ProcessingDenied({ status }) {
  return <div className="empty" role="alert"><strong>You don't have permission to {status === 2 ? 'view approved leave' : 'review leave requests'}.</strong><p>Ask HR if you need approval access.</p></div>;
}
function Approvals({ api, profile }) {
  const [status, setStatus] = useState(1); const [page, setPage] = useState(0); const navigate = useNavigate(); const notice = useLocation().state?.notice;
  const state = useLoad(signal => api.processingApplications({ status, pageIndex: page, pageSize: 20 }, { signal }), [api, status, page]);
  useRefreshOnFocus(state.retry);
  const received = Array.isArray(state.data?.PageCollection) ? state.data.PageCollection : null; const totalPages = Math.max(1, Number(state.data?.TotalPages) || 1);
  // The development queue returns null for applications whose employee_erp_id matches no employee record; skip them.
  const linked = received?.filter(item => item && typeof item === 'object' && item.Id); const hidden = received ? received.length - linked.length + (Number(state.data?.InvalidCount) || 0) : 0;
  // An approver cannot decide their own requests, so they are left out of their queue.
  const rows = linked?.filter(item => item.EmployeeId !== profile.Id); const own = linked ? linked.length - rows.length : 0;
  function show(next) { setStatus(next); setPage(0); }
  return <Card title="Approvals" action={<button onClick={state.retry} disabled={state.loading}>Refresh</button>}><p className="muted section-intro">Review employees' leave requests and see leave that has been approved.</p>{notice && <p className="success" role="status">{notice}</p>}
    {own > 0 && <p className="help" role="status">Your own requests are hidden here. Another approver reviews them.</p>}
    <div className="tabs"><button aria-pressed={status === 1} onClick={() => show(1)}>Pending</button><button aria-pressed={status === 2} onClick={() => show(2)}>Approved</button></div>
    {state.error?.status === 403 ? <ProcessingDenied status={status} /> : <LoadState state={state} />}
    {state.data && !rows && <Feedback error={unexpectedProcessingReply} />}
    {hidden > 0 && <p className="help" role="status">{hidden === 1 ? '1 request on this page couldn\'t be shown because it isn\'t' : `${hidden} requests on this page couldn't be shown because they aren't`} linked to an employee record. Ask HR to check {hidden === 1 ? 'it' : 'them'}.</p>}
    {rows && <><div className="list-wrapper"><div className="list-header"><span>Employee</span><span>Leave type</span><span>Dates</span><span>{status === 1 ? 'Actions' : 'Decision'}</span></div>{rows.length ? rows.map(item => <div className="list-row" key={item.Id}><div><strong>{item.EmployeeName || 'Employee'}</strong></div><div><strong>{item.LeaveTypeDescription}</strong><small>{item.Reason}</small></div><span>{dateText(item.Start)} - {dateText(item.End)}</span>
      {status === 1 ? <div className="row-actions"><button onClick={() => navigate(`/approvals/${item.Id}`)}>Review</button></div> : <div><span className="badge status-2">Approved</span><small>{dateText(item.AuthorizedDate)}{item.AuthorizationRemarks ? ` | ${item.AuthorizationRemarks}` : ''}</small><div className="row-actions"><button onClick={() => navigate(`/approvals/${item.Id}`)}>View</button></div></div>}</div>) : <div className="empty">{status === 1 ? 'No leave requests are waiting for approval.' : 'No approved leave yet.'}</div>}</div>
      <div className="pagination"><button disabled={page === 0} onClick={() => setPage(x => x - 1)}>Prev</button><span>Page {page + 1} of {totalPages}</span><button disabled={page + 1 >= totalPages} onClick={() => setPage(x => x + 1)}>Next</button></div></>}
  </Card>;
}
function ApprovalReview({ api, profile }) {
  const { id } = useParams(); const navigate = useNavigate();
  const [remarks, setRemarks] = useState(''); const [busy, setBusy] = useState(null); const [error, setError] = useState(null);
  const state = useLoad(signal => api.processingApplication(id, { signal }), [api, id]); const item = state.data?.Application; const preview = state.data?.Preview;
  // Usability only: the ERP and development RPC also reject self-approval.
  const own = item?.EmployeeId === profile.Id;
  useRefreshOnFocus(() => { if (!busy) state.retry(); });
  async function decide(decision) {
    if (!item?.Id || own || item.Status !== 1 || busy || !window.confirm(decision === 'approve' ? 'Approve this leave request?' : 'Reject this leave request?')) return;
    setBusy(decision); setError(null);
    try { await api.authorizeLeave(item.Id, { decision, remarks: remarks.trim() }); navigate('/approvals', { state: { notice: decision === 'approve' ? 'Leave request approved.' : 'Leave request rejected.' } }); }
    catch (e) { setError(e); setBusy(null); }
  }
  const details = item && [['Employee', item.EmployeeName], ['Leave type', item.LeaveTypeDescription], ['Status', item.StatusDescription], ['Start', dateText(item.Start)], ['End', dateText(item.End)], ['Requested on', dateText(item.CreatedDate)], ['Reason', item.Reason],
    ...(item.Status === 1 ? [] : [['Decision remarks', item.AuthorizationRemarks], ['Decision date', dateText(item.AuthorizedDate)]])];
  return <Card title={item?.Status === 1 ? 'Review leave request' : 'Leave decision'} action={<button onClick={() => navigate('/approvals')} disabled={!!busy}>Back</button>}>
    {state.error?.status === 403 ? <ProcessingDenied /> : <LoadState state={state} />}
    {state.data && !item && <Feedback error={unexpectedProcessingReply} />}
    {item && <><dl className="details-grid">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl>{preview && <><h2>Balance preview</h2><PreviewSummary preview={preview} /></>}
      {api.source === 'supabase' && !own && <BalanceFixtureEditor key={item.Id} api={api} application={item} />}
      {item.Status === 1 && (own ? <p className="help" role="status">You can't approve or reject your own request. Another approver must decide it.</p>
        : <div className="request-form"><Feedback error={error} /><Field label="Remarks (optional)"><textarea maxLength={256} rows={3} value={remarks} onChange={e => { setError(null); setRemarks(e.target.value); }} disabled={!!busy} /></Field>
          <div className="row-actions"><button className="primary" onClick={() => decide('approve')} disabled={!!busy}>{busy === 'approve' ? 'Approving...' : 'Approve'}</button><button className="danger" onClick={() => decide('reject')} disabled={!!busy}>{busy === 'reject' ? 'Rejecting...' : 'Reject'}</button></div></div>)}</>}
  </Card>;
}
function LeaveForm({ api, types, application, onClose, onSaved }) {
  const [form, setForm] = useState({ leaveTypeId: application?.LeaveTypeId || '', start: application?.Start?.slice(0, 10) || '', end: application?.End?.slice(0, 10) || '', reason: application?.Reason || '' }); const [busy, setBusy] = useState(false); const [error, setError] = useState(null);
  const [handoverNotes, setHandoverNotes] = useState(''); const [handoverFile, setHandoverFile] = useState(null);
  const handoverFileInput = useRef(null);
  const invalidDates = !!form.start && !!form.end && form.end <= form.start;
  const hasHandoverDraft = !!handoverNotes.trim() || !!handoverFile;
  const preview = useLoad(signal => !form.leaveTypeId || !form.start || !form.end || invalidDates ? null : api.preview({ leaveTypeId: form.leaveTypeId, start: form.start, end: form.end, ...(application ? { excludedId: application.Id } : {}) }, { signal }), [api, form.leaveTypeId, form.start, form.end, application?.Id, invalidDates]);
  useRefreshOnFocus(preview.retry);
  function set(field, value) {
    setError(null);
    setForm(current => ({ ...current, [field]: value }));
  }
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (hasHandoverDraft) { setError(new Error('Handover details and supporting documents are not connected to the HR service yet. Clear the draft to submit this leave request.')); return; }
    if (!form.reason.trim()) { setError(new Error('Enter a reason for this leave request.')); return; }
    if (invalidDates || preview.loading || !preview.data?.CanSubmit) return;
    setBusy(true); setError(null);
    try {
      const request = { leaveTypeId: form.leaveTypeId, start: form.start, end: form.end, reason: form.reason };
      onSaved(await (application ? api.updateLeave(application.Id, request) : api.submitLeave(request)));
    }
    catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  return <form className="request-form" onSubmit={submit}>
    <div className="form-heading"><h2>{application ? 'Edit leave' : 'Request leave'}</h2><button type="button" onClick={onClose} disabled={busy}>Close</button></div>
    <Feedback error={error} />
    <div className="form-grid">
      <Field label="Leave type"><select required value={form.leaveTypeId} onChange={e => set('leaveTypeId', e.target.value)} disabled={busy}><option value="">Select leave type</option>{types.map(type => <option key={type.Id} value={type.Id}>{type.Description}</option>)}</select></Field>
      <Field label="Start date"><input required type="date" value={form.start} onChange={e => set('start', e.target.value)} disabled={busy} /></Field>
      <Field label="End date"><input required type="date" min={form.start ? nextDate(form.start) : undefined} value={form.end} onChange={e => set('end', e.target.value)} disabled={busy} /></Field>
    </div>
    {api.source === 'supabase' && <p className="help">Choose any start and end dates. In development mode, submission is available only for date ranges with a configured preview fixture.</p>}
    <Field label="Reason"><textarea required maxLength={256} rows={3} value={form.reason} onChange={e => set('reason', e.target.value)} disabled={busy} /></Field>
    <h2>Work handover</h2>
    <p className="help" role="status">Handover details and documents are a local draft only and are not sent to HR. The colleague directory and document upload are not connected yet.</p>
    <Field label="Colleague receiving the handover"><select value="" disabled><option value="">Colleague directory unavailable</option></select></Field>
    <Field label="Handover notes"><textarea rows={3} value={handoverNotes} onChange={e => { setError(null); setHandoverNotes(e.target.value); }} disabled={busy} /></Field>
    <Field label="Supporting document"><input ref={handoverFileInput} type="file" onChange={e => { setError(null); setHandoverFile(e.target.files?.[0] || null); }} disabled={busy} />{handoverFile && <><small>{handoverFile.name} (not uploaded)</small><button type="button" onClick={() => { setError(null); setHandoverFile(null); if (handoverFileInput.current) handoverFileInput.current.value = ''; }} disabled={busy}>Clear selected file</button></>}</Field>
    <LoadState state={preview} />
    {invalidDates && <Feedback error="End date must be after the start date." />}
    {preview.data && !preview.data.CanSubmit && <Feedback error={preview.data.Error || 'The selected leave dates cannot be submitted.'} />}
    <button className="primary" disabled={busy || hasHandoverDraft || invalidDates || preview.loading || !preview.data?.CanSubmit}>{busy ? 'Saving...' : hasHandoverDraft ? 'Clear handover draft to submit' : application ? 'Save changes' : 'Submit request'}</button>
  </form>;
}
