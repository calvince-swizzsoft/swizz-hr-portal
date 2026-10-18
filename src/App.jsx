import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { createPortalClient } from './lib/portalClient.js';

const dateText = value => value ? new Date(String(value).slice(0, 10) + 'T12:00:00').toLocaleDateString() : '\u2014';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
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
  const [profile, setProfile] = useState(null); const [notice, setNotice] = useState(''); const navigate = useNavigate();
  const api = useMemo(() => createPortalClient({ source: import.meta.env.VITE_DATA_SOURCE || 'erp', baseUrl: import.meta.env.VITE_API_BASE_URL || '/api', supabaseUrl: import.meta.env.VITE_SUPABASE_URL, supabaseKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, onUnauthorized: () => { setProfile(null); setNotice('Your session has ended. Please sign in again.'); } }), []);
  async function signedIn(result) {
    if (!result?.token) throw new Error('The sign-in response did not include a session token.');
    api.setToken(result.token);
    try { const employee = await api.profile(); if (!employee?.Id) throw new Error('Employee profile is incomplete. Contact HR.'); setProfile(employee); setNotice(''); navigate('/profile'); }
    catch (error) { await api.clearToken(); throw error; }
  }
  async function logout() { setProfile(null); setNotice(''); navigate('/login'); await api.clearToken(); }
  if (!profile) return <Login api={api} signedIn={signedIn} notice={notice} />;
  return <div className="app-shell"><aside className="sidebar"><NavLink className="brand" to="/profile"><span className="brand-icon">S</span><span>Swift<span className="brand-sub">HR PORTAL</span></span></NavLink>
    <p className="nav-label">EMPLOYEE SELF-SERVICE</p><nav><NavLink to="/profile">My profile</NavLink><NavLink to="/leave">My leave</NavLink><NavLink to="/leave-types">Leave types</NavLink><NavLink to="/balances">Leave balances</NavLink></nav><ProcessingNavigation api={api} /><div className="sidebar-bottom"><span>{profile.CustomerFullName}</span><button onClick={logout}>Sign out</button></div></aside>
    <main><div className="topbar"><span>Welcome, {profile.CustomerIndividualFirstName || 'colleague'}</span><span className="status-dot">Employee portal</span></div><Routes>
      <Route path="/profile" element={<Profile api={api} profile={profile} onUpdated={setProfile} />} /><Route path="/leave" element={<Leave api={api} />} /><Route path="/leave-types" element={<LeaveTypes api={api} />} /><Route path="/leave-type" element={<LeaveTypes api={api} />} /><Route path="/leave/:id" element={<ApplicationDetail api={api} />} /><Route path="/balances" element={<Balances api={api} />} /><Route path="/processing/leave" element={<ProcessingInbox api={api} profile={profile} />} /><Route path="/applications" element={<Navigate to="/leave" replace />} /><Route path="*" element={<Navigate to="/profile" replace />} />
    </Routes></main></div>;
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
function LeaveTypes({ api }) {
  const state = useLoad(signal => api.leaveTypes({ signal }), [api]);
  const navigate = useNavigate();
  return <Card title="Leave types"><LoadState state={state} />{state.data && <div className="list-wrapper">{state.data.length ? state.data.map(type => <div className="list-row type-row" key={type.Id}><strong>{type.Description}</strong><span>{type.Entitlement} {type.UnitTypeDescription}</span><button onClick={() => navigate(`/balances?leaveTypeId=${encodeURIComponent(type.Id)}`)}>View balance</button></div>) : <div className="empty">No leave types available.</div>}</div>}</Card>;
}
function Leave({ api }) {
  const [page, setPage] = useState(0); const [open, setOpen] = useState(false); const [busyId, setBusyId] = useState(null); const [error, setError] = useState(null); const [success, setSuccess] = useState(''); const navigate = useNavigate();
  const state = useLoad(async signal => { const [applications, types] = await Promise.all([api.applications(page, { signal }), api.leaveTypes({ signal })]); return { applications, types }; }, [api, page]);
  useRefreshOnFocus(() => { if (!open) state.retry(); });
  async function withdraw(item) { if (!window.confirm('Withdraw this pending leave request?')) return; setBusyId(item.Id); setError(null); try { await api.withdraw(item.Id); setSuccess('Leave request withdrawn.'); state.retry(); } catch (e) { setError(e); } finally { setBusyId(null); } }
  const data = state.data?.applications;
  return <Card title="My leave" action={<div className="row-actions"><button onClick={state.retry} disabled={state.loading || !!busyId}>Refresh</button><button className="primary" onClick={() => setOpen(true)} disabled={!state.data}>Request leave</button></div>}><Feedback error={error} />{success && <p className="success" role="status">{success}</p>}<LoadState state={state} />
    {open && state.data && <LeaveForm api={api} types={state.data.types} onClose={() => setOpen(false)} onSaved={saved => { setOpen(false); setSuccess(saved.NotificationPending ? 'Request saved. The HR notification is pending.' : 'Leave request submitted.'); setPage(0); state.retry(); }} />}
    {data && <><div className="list-wrapper"><div className="list-header"><span>Leave type</span><span>Dates</span><span>Status</span><span>Actions</span></div>{data.PageCollection.length ? data.PageCollection.map(item => <div className="list-row" key={item.Id}><div><strong>{item.LeaveTypeDescription}</strong><small>{item.Reason}</small></div><span>{dateText(item.Start)} - {dateText(item.End)}</span><span className={`badge status-${item.Status}`}>{item.StatusDescription}</span><div className="row-actions"><button onClick={() => navigate(`/leave/${item.Id}`)}>View</button>{item.Status === 1 && <button disabled={!!busyId} onClick={() => withdraw(item)}>{busyId === item.Id ? 'Withdrawing...' : 'Withdraw'}</button>}</div></div>) : <div className="empty">No leave requests yet.</div>}</div><div className="pagination"><button disabled={page === 0 || !!busyId} onClick={() => setPage(x => x - 1)}>Prev</button><span>Page {page + 1} of {Math.max(1, data.TotalPages)}</span><button disabled={page + 1 >= data.TotalPages || !!busyId} onClick={() => setPage(x => x + 1)}>Next</button></div></>}
  </Card>;
}
function ApplicationDetail({ api }) {
  const { id } = useParams(); const [editing, setEditing] = useState(false); const navigate = useNavigate();
  const state = useLoad(async signal => ({ application: await api.application(id, { signal }), types: await api.leaveTypes({ signal }) }), [api, id]); const item = state.data?.application;
  useRefreshOnFocus(() => { if (!editing) state.retry(); });
  return <Card title="Leave application" action={<div className="row-actions"><button onClick={state.retry} disabled={state.loading}>Refresh</button><button onClick={() => navigate('/leave')}>Back</button></div>}><LoadState state={state} />{item && <>{editing ? <LeaveForm key={item.Id} api={api} types={state.data.types} application={item} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); state.retry(); }} /> : <><dl className="details-grid">{[['Leave type', item.LeaveTypeDescription], ['Status', item.StatusDescription], ['Start', dateText(item.Start)], ['End', dateText(item.End)], ['Reason', item.Reason], ['Decision remarks', item.AuthorizationRemarks], ['Decision date', dateText(item.AuthorizedDate)], ['Recall remarks', item.RecallRemarks]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '\u2014'}</dd></div>)}</dl>{item.Status === 1 && <button className="primary" onClick={() => setEditing(true)}>Edit application</button>}</>}</>}</Card>;
}
function Balances({ api }) {
  const [searchParams] = useSearchParams(); const [leaveTypeId, setType] = useState(() => searchParams.get('leaveTypeId') || ''); const [asAt, setAsAt] = useState(() => api.source === 'supabase' ? '2027-01-10' : today()); const [page, setPage] = useState(0);
  const types = useLoad(signal => api.leaveTypes({ signal }), [api]); const state = useLoad(signal => leaveTypeId && asAt ? api.balances({ leaveTypeId, asAt, pageIndex: page }, { signal }) : null, [api, leaveTypeId, asAt, page]); const data = state.data;
  useRefreshOnFocus(state.retry);
  return <Card title="Leave balances" action={<button onClick={state.retry} disabled={!leaveTypeId || state.loading}>Refresh balance</button>}><LoadState state={types} /><div className="form-grid"><Field label="Leave type"><select value={leaveTypeId} onChange={e => { setType(e.target.value); setPage(0); }}><option value="">Select leave type</option>{types.data?.map(type => <option key={type.Id} value={type.Id}>{type.Description}</option>)}</select></Field><Field label="As at"><input type="date" value={asAt} onChange={e => { setAsAt(e.target.value); setPage(0); }} /></Field></div>
    {leaveTypeId && asAt ? <LoadState state={state} /> : <div className="empty">Select a leave type and date.</div>}{data && <><Feedback error={data.BalanceError} />{data.Balance && <dl className="details-grid">{['Entitlement', 'Used', 'Reserved', 'Available'].map(key => <div key={key}><dt>{key}</dt><dd>{data.Balance[key]}</dd></div>)}</dl>}<h2>Leave history</h2><div className="list-wrapper">{data.History.length ? data.History.map(item => <div className="list-row" key={item.Id}><span>{dateText(item.Start)} - {dateText(item.End)}</span><span>{item.Reason}</span><span>{({ 1: 'Pending', 2: 'Approved', 4: 'Rejected', 8: 'Recalled', 16: 'Withdrawn' })[item.Status] || 'Unknown'}</span><span>{item.ChargedDaysInYear} days</span></div>) : <div className="empty">No history for this period.</div>}</div><div className="pagination"><button disabled={page === 0} onClick={() => setPage(x => x - 1)}>Prev</button><span>Page {page + 1} of {Math.max(1, Math.ceil(data.HistoryCount / 10))}</span><button disabled={(page + 1) * 10 >= data.HistoryCount} onClick={() => setPage(x => x + 1)}>Next</button></div></>}</Card>;
}
function ProcessingNavigation({ api }) {
  const state = useLoad(signal => api.processingApplications({ status: 1, pageIndex: 0, pageSize: 1 }, { signal }), [api]);
  if (state.loading || state.error?.status === 403 || !state.error && !state.data) return null;
  if (state.error) return <Feedback error={state.error} />;
  return <><p className="nav-label">LEAVE PROCESSING</p><nav><NavLink to="/processing/leave">Approval inbox</NavLink></nav></>;
}
function ProcessingInbox({ api, profile }) {
  const [status, setStatus] = useState(1); const [page, setPage] = useState(0); const [selectedId, setSelectedId] = useState(null);
  const [remarks, setRemarks] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(null); const [success, setSuccess] = useState('');
  const queue = useLoad(signal => api.processingApplications({ status, pageIndex: page, pageSize: 20 }, { signal }), [api, status, page]);
  const detail = useLoad(signal => selectedId ? api.processingApplication(selectedId, { signal }) : null, [api, selectedId]);
  const application = detail.data?.Application;
  const isOwnRequest = application?.EmployeeId === profile.Id;
  function showQueue(nextStatus) { setStatus(nextStatus); setPage(0); setSelectedId(null); setRemarks(''); setError(null); setSuccess(''); }
  async function decide(decision) {
    if (!application || isOwnRequest || busy) return;
    setBusy(true); setError(null); setSuccess('');
    try {
      await api.authorizeLeave(application.Id, { decision, remarks });
      setSuccess(`Request ${decision === 'approve' ? 'approved' : 'rejected'}.`);
      setSelectedId(null); setRemarks(''); queue.retry();
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  const data = queue.data;
  const pageCollection = Array.isArray(data?.PageCollection) ? data.PageCollection : [];
  const applications = pageCollection.filter(item => item && typeof item === 'object' && item.Id);
  const invalidApplicationCount = pageCollection.length - applications.length + (Number(data?.InvalidCount) || 0);
  return <Card title="Leave approval inbox" action={<div className="row-actions"><button className={status === 1 ? 'primary' : ''} onClick={() => showQueue(1)}>Pending</button><button className={status === 2 ? 'primary' : ''} onClick={() => showQueue(2)}>Approved</button><button onClick={() => selectedId ? detail.retry() : queue.retry()}>{selectedId ? 'Refresh details' : 'Refresh'}</button></div>}>
    {success && <p className="success" role="status">{success}</p>}
    <Feedback error={error} />
    {selectedId ? <><button onClick={() => { setSelectedId(null); setRemarks(''); setError(null); }}>Back to inbox</button><LoadState state={detail} />{detail.data && !application && <Feedback error="The processing service returned incomplete request details. Refresh the inbox or contact HR." />}{application && <><dl className="details-grid">{[['Employee', application.EmployeeName], ['Leave type', application.LeaveTypeDescription], ['Status', application.StatusDescription], ['Start', dateText(application.Start)], ['End', dateText(application.End)], ['Reason', application.Reason]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '\u2014'}</dd></div>)}</dl><h2>Request preview</h2>{detail.data.Preview?.Error && <Feedback error={detail.data.Preview.Error} />}{detail.data.Preview && <div className="balance-preview"><strong>{detail.data.Preview.RequestedDays} requested day(s)</strong>{detail.data.Preview.Cycles?.map((cycle, index) => <div key={index}><span>{dateText(cycle.Start)} - {dateText(cycle.End)}</span><p>Available: {cycle.Available} | Requested: {cycle.Requested} | Remaining: {cycle.Remaining}</p></div>)}</div>}{status === 1 && application.Status === 1 && (isOwnRequest ? <p className="feedback" role="alert">You cannot approve or reject your own request.</p> : <><Field label="Decision remarks (optional, up to 256 characters)"><textarea rows={3} maxLength={256} value={remarks} onChange={event => setRemarks(event.target.value)} disabled={busy} /></Field><div className="row-actions"><button className="primary" onClick={() => decide('approve')} disabled={busy}>{busy ? 'Saving...' : 'Approve'}</button><button className="danger" onClick={() => decide('reject')} disabled={busy}>{busy ? 'Saving...' : 'Reject'}</button></div></>)}</>}</> : <><LoadState state={queue} />{data && <>{invalidApplicationCount > 0 && <p className="feedback" role="alert">{invalidApplicationCount} request record(s) were returned without required details and could not be displayed. Please contact HR to check the processing data.</p>}{!Array.isArray(data.PageCollection) && <p className="feedback" role="alert">The processing service returned an invalid request list. Refresh or contact HR.</p>}<div className="list-wrapper"><div className="list-header processing-grid"><span>Employee</span><span>Leave type</span><span>Dates</span><span>Status</span><span>Details</span></div>{applications.length ? applications.map(item => <div className="list-row processing-grid" key={item.Id}><strong>{item.EmployeeName || 'Employee'}</strong><span>{item.LeaveTypeDescription || '\u2014'}</span><span>{dateText(item.Start)} - {dateText(item.End)}</span><span className={`badge status-${item.Status}`}>{item.StatusDescription || 'Unknown status'}</span><button onClick={() => { setSelectedId(item.Id); setRemarks(''); setError(null); }}>View</button></div>) : <div className="empty">No {status === 1 ? 'pending' : 'approved'} requests.</div>}</div><div className="pagination"><button disabled={page === 0} onClick={() => setPage(value => value - 1)}>Prev</button><span>Page {page + 1} of {Math.max(1, data.TotalPages || 0)}</span><button disabled={page + 1 >= Math.max(1, data.TotalPages || 0)} onClick={() => setPage(value => value + 1)}>Next</button></div></>}</>}
  </Card>;
}
function LeaveForm({ api, types, application, onClose, onSaved }) {
  const [form, setForm] = useState({ leaveTypeId: application?.LeaveTypeId || '', start: application?.Start?.slice(0, 10) || '', end: application?.End?.slice(0, 10) || '', reason: application?.Reason || '' }); const [busy, setBusy] = useState(false); const [error, setError] = useState(null);
  const invalidDates = !!form.start && !!form.end && form.end < form.start;
  const preview = useLoad(signal => !form.leaveTypeId || !form.start || !form.end || invalidDates ? null : api.preview({ leaveTypeId: form.leaveTypeId, start: form.start, end: form.end, ...(application ? { excludedId: application.Id } : {}) }, { signal }), [api, form.leaveTypeId, form.start, form.end, application?.Id, invalidDates]);
  useRefreshOnFocus(preview.retry);
  function set(field, value) { setError(null); setForm(current => ({ ...current, [field]: value })); }
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (!form.reason.trim()) { setError(new Error('Enter a reason for this leave request.')); return; }
    if (invalidDates || preview.loading || !preview.data?.CanSubmit) return;
    setBusy(true); setError(null);
    try { onSaved(await (application ? api.updateLeave(application.Id, form) : api.submitLeave(form))); }
    catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  return <form className="request-form" onSubmit={submit}><div className="form-heading"><h2>{application ? 'Edit leave' : 'Request leave'}</h2><button type="button" onClick={onClose} disabled={busy}>Close</button></div><Feedback error={error} /><div className="form-grid"><Field label="Leave type"><select required value={form.leaveTypeId} onChange={e => set('leaveTypeId', e.target.value)} disabled={busy}><option value="">Select leave type</option>{types.map(type => <option key={type.Id} value={type.Id}>{type.Description}</option>)}</select></Field><Field label="Start date"><input required type="date" value={form.start} onChange={e => set('start', e.target.value)} disabled={busy} /></Field><Field label="End date"><input required type="date" min={form.start} value={form.end} onChange={e => set('end', e.target.value)} disabled={busy} /></Field></div><Field label="Reason"><textarea required maxLength={256} rows={3} value={form.reason} onChange={e => set('reason', e.target.value)} disabled={busy} /></Field><LoadState state={preview} />
    {invalidDates && <Feedback error="End date must be on or after the start date." />}{preview.data && <div className="balance-preview"><strong>{preview.data.RequestedDays} chargeable day(s)</strong><Feedback error={preview.data.Error} />{preview.data.Cycles.map((cycle, i) => <div key={i}><span>{dateText(cycle.Start)} - {dateText(cycle.End)}</span><p>Available: {cycle.Available} | Requested: {cycle.Requested} | Remaining: {cycle.Remaining}</p></div>)}</div>}<button className="primary" disabled={busy || invalidDates || preview.loading || !preview.data?.CanSubmit}>{busy ? 'Saving...' : application ? 'Save changes' : 'Submit request'}</button></form>;
}
