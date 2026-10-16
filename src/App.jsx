import { useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
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
    <p className="nav-label">EMPLOYEE SELF-SERVICE</p><nav><NavLink to="/profile">My profile</NavLink><NavLink to="/leave">My leave</NavLink><NavLink to="/leave-types">Leave types</NavLink><NavLink to="/balances">Leave balances</NavLink><NavLink to="/approvals">Approvals</NavLink></nav><div className="sidebar-bottom"><span>{profile.CustomerFullName}</span><button onClick={logout}>Sign out</button></div></aside>
    <main><div className="topbar"><span>Welcome, {profile.CustomerIndividualFirstName || 'colleague'}</span><span className="status-dot">Employee portal</span></div><Routes>
      <Route path="/profile" element={<Profile api={api} profile={profile} onUpdated={setProfile} />} /><Route path="/leave" element={<Leave api={api} />} /><Route path="/leave-types" element={<LeaveTypes api={api} />} /><Route path="/leave/:id" element={<ApplicationDetail api={api} />} /><Route path="/balances" element={<Balances api={api} />} /><Route path="/approvals" element={<Approvals api={api} profile={profile} />} /><Route path="/approvals/:id" element={<ApprovalReview api={api} profile={profile} />} /><Route path="/applications" element={<Navigate to="/leave" replace />} /><Route path="*" element={<Navigate to="/profile" replace />} />
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
  return <Card title="My employee profile" action={api.canEditProfile && <button onClick={() => { setSuccess(''); setEditing(true); }}>Edit my details</button>}>{success && <p className="success" role="status">{success}</p>}{heading}<dl className="details-grid">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '\u2014'}</dd></div>)}</dl><p className="help">{api.canEditProfile ? 'You can update your name and contact details. To change other details, contact HR.' : 'To correct your employee details, contact HR.'}</p></Card>;
}
function ProfileForm({ api, profile, onClose, onSaved }) {
  const [form, setForm] = useState({ CustomerFullName: profile.CustomerFullName || '', CustomerIndividualFirstName: profile.CustomerIndividualFirstName || '', CustomerAddressEmail: profile.CustomerAddressEmail || '', CustomerAddressMobileLine: profile.CustomerAddressMobileLine || '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null);
  function set(field, value) { setError(null); setForm(current => ({ ...current, [field]: value })); }
  async function submit(event) { event.preventDefault(); if (busy) return; setBusy(true); setError(null); try { onSaved(await api.updateProfile(form)); } catch (e) { setError(e); setBusy(false); } }
  return <form className="request-form" onSubmit={submit}><div className="form-heading"><h2>Name and contact details</h2><button type="button" onClick={onClose} disabled={busy}>Cancel</button></div><Feedback error={error} /><div className="form-grid">
    <Field label="Full name"><input required maxLength={200} autoComplete="name" value={form.CustomerFullName} onChange={e => set('CustomerFullName', e.target.value)} disabled={busy} /></Field>
    <Field label="First name"><input maxLength={100} autoComplete="given-name" value={form.CustomerIndividualFirstName} onChange={e => set('CustomerIndividualFirstName', e.target.value)} disabled={busy} /></Field>
    <Field label="Email"><input type="email" maxLength={254} autoComplete="email" value={form.CustomerAddressEmail} onChange={e => set('CustomerAddressEmail', e.target.value)} disabled={busy} /></Field>
    <Field label="Mobile"><input type="tel" maxLength={20} autoComplete="tel" value={form.CustomerAddressMobileLine} onChange={e => set('CustomerAddressMobileLine', e.target.value)} disabled={busy} /></Field></div>
    <button className="primary" disabled={busy}>{busy ? 'Saving...' : 'Save changes'}</button><p className="help">Leave first name, email or mobile empty to clear it. Payroll, statutory and employment details are managed by HR.</p></form>;
}
function LeaveTypes({ api }) {
  const state = useLoad(signal => api.leaveTypes({ signal }), [api]);
  return <Card title="Leave types"><LoadState state={state} />{state.data && <div className="list-wrapper">{state.data.length ? state.data.map(type => <div className="list-row type-row" key={type.Id}><strong>{type.Description}</strong><span>{type.Entitlement} {type.UnitTypeDescription}</span></div>) : <div className="empty">No leave types available.</div>}</div>}</Card>;
}
function Leave({ api }) {
  const [page, setPage] = useState(0); const [open, setOpen] = useState(false); const [busyId, setBusyId] = useState(null); const [error, setError] = useState(null); const [success, setSuccess] = useState(''); const navigate = useNavigate();
  const state = useLoad(async signal => { const [applications, types] = await Promise.all([api.applications(page, { signal }), api.leaveTypes({ signal })]); return { applications, types }; }, [api, page]);
  async function withdraw(item) { if (!window.confirm('Withdraw this pending leave request?')) return; setBusyId(item.Id); setError(null); try { await api.withdraw(item.Id); setSuccess('Leave request withdrawn.'); state.retry(); } catch (e) { setError(e); } finally { setBusyId(null); } }
  const data = state.data?.applications;
  return <Card title="My leave" action={<button className="primary" onClick={() => setOpen(true)} disabled={!state.data}>Request leave</button>}><Feedback error={error} />{success && <p className="success" role="status">{success}</p>}<LoadState state={state} />
    {open && state.data && <LeaveForm api={api} types={state.data.types} onClose={() => setOpen(false)} onSaved={saved => { setOpen(false); setSuccess(saved.NotificationPending ? 'Request saved. The HR notification is pending.' : 'Leave request submitted.'); setPage(0); state.retry(); }} />}
    {data && <><div className="list-wrapper"><div className="list-header"><span>Leave type</span><span>Dates</span><span>Status</span><span>Actions</span></div>{data.PageCollection.length ? data.PageCollection.map(item => <div className="list-row" key={item.Id}><div><strong>{item.LeaveTypeDescription}</strong><small>{item.Reason}</small></div><span>{dateText(item.Start)} - {dateText(item.End)}</span><span className={`badge status-${item.Status}`}>{item.StatusDescription}</span><div className="row-actions"><button onClick={() => navigate(`/leave/${item.Id}`)}>View</button>{item.Status === 1 && <button disabled={!!busyId} onClick={() => withdraw(item)}>{busyId === item.Id ? 'Withdrawing...' : 'Withdraw'}</button>}</div></div>) : <div className="empty">No leave requests yet.</div>}</div><div className="pagination"><button disabled={page === 0 || !!busyId} onClick={() => setPage(x => x - 1)}>Prev</button><span>Page {page + 1} of {Math.max(1, data.TotalPages)}</span><button disabled={page + 1 >= data.TotalPages || !!busyId} onClick={() => setPage(x => x + 1)}>Next</button></div></>}
  </Card>;
}
function ApplicationDetail({ api }) {
  const { id } = useParams(); const [editing, setEditing] = useState(false); const navigate = useNavigate();
  const state = useLoad(async signal => ({ application: await api.application(id, { signal }), types: await api.leaveTypes({ signal }) }), [api, id]); const item = state.data?.application;
  return <Card title="Leave application" action={<button onClick={() => navigate('/leave')}>Back</button>}><LoadState state={state} />{item && <>{editing ? <LeaveForm key={item.Id} api={api} types={state.data.types} application={item} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); state.retry(); }} /> : <><dl className="details-grid">{[['Leave type', item.LeaveTypeDescription], ['Status', item.StatusDescription], ['Start', dateText(item.Start)], ['End', dateText(item.End)], ['Reason', item.Reason], ['Decision remarks', item.AuthorizationRemarks], ['Recall remarks', item.RecallRemarks]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '\u2014'}</dd></div>)}</dl>{item.Status === 1 && <button className="primary" onClick={() => setEditing(true)}>Edit application</button>}</>}</>}</Card>;
}
function Balances({ api }) {
  const [leaveTypeId, setType] = useState(''); const [asAt, setAsAt] = useState(today); const [page, setPage] = useState(0);
  const types = useLoad(signal => api.leaveTypes({ signal }), [api]); const state = useLoad(signal => leaveTypeId && asAt ? api.balances({ leaveTypeId, asAt, pageIndex: page }, { signal }) : null, [api, leaveTypeId, asAt, page]); const data = state.data;
  return <Card title="Leave balances"><LoadState state={types} /><div className="form-grid"><Field label="Leave type"><select value={leaveTypeId} onChange={e => { setType(e.target.value); setPage(0); }}><option value="">Select leave type</option>{types.data?.map(type => <option key={type.Id} value={type.Id}>{type.Description}</option>)}</select></Field><Field label="As at"><input type="date" value={asAt} onChange={e => { setAsAt(e.target.value); setPage(0); }} /></Field></div>
    {leaveTypeId && asAt ? <LoadState state={state} /> : <div className="empty">Select a leave type and date.</div>}{data && <><Feedback error={data.BalanceError} />{data.Balance && <dl className="details-grid">{['Entitlement', 'Used', 'Reserved', 'Available'].map(key => <div key={key}><dt>{key}</dt><dd>{data.Balance[key]}</dd></div>)}</dl>}<h2>Leave history</h2><div className="list-wrapper">{data.History.length ? data.History.map(item => <div className="list-row" key={item.Id}><span>{dateText(item.Start)} - {dateText(item.End)}</span><span>{item.Reason}</span><span>{({ 1: 'Pending', 2: 'Approved', 4: 'Rejected', 8: 'Recalled', 16: 'Withdrawn' })[item.Status] || 'Unknown'}</span><span>{item.ChargedDaysInYear} days</span></div>) : <div className="empty">No history for this period.</div>}</div><div className="pagination"><button disabled={page === 0} onClick={() => setPage(x => x - 1)}>Prev</button><span>Page {page + 1} of {Math.max(1, Math.ceil(data.HistoryCount / 10))}</span><button disabled={(page + 1) * 10 >= data.HistoryCount} onClick={() => setPage(x => x + 1)}>Next</button></div></>}</Card>;
}
function PreviewSummary({ preview }) {
  return <div className="balance-preview"><strong>{preview.RequestedDays} chargeable day(s)</strong><Feedback error={preview.Error} />{preview.Cycles.map((cycle, i) => <div key={i}><span>{dateText(cycle.Start)} - {dateText(cycle.End)}</span><p>Available: {cycle.Available} | Requested: {cycle.Requested} | Remaining: {cycle.Remaining}</p></div>)}</div>;
}
// Processing permission is checked by the ERP or development RPC; a 403 shows no records and no permission toggle.
function ProcessingDenied({ status }) {
  return <div className="empty" role="alert"><strong>You don't have permission to {status === 2 ? 'view approved leave' : 'review leave requests'}.</strong><p>Ask HR if you need approval access.</p></div>;
}
function Approvals({ api, profile }) {
  const [status, setStatus] = useState(1); const [page, setPage] = useState(0); const navigate = useNavigate(); const notice = useLocation().state?.notice;
  const state = useLoad(signal => api.processingApplications({ status, pageIndex: page, pageSize: 20 }, { signal }), [api, status, page]); const data = state.data;
  function show(next) { setStatus(next); setPage(0); }
  return <Card title="Approvals"><p className="muted section-intro">Review employees' leave requests and see leave that has been approved.</p>{notice && <p className="success" role="status">{notice}</p>}
    <div className="tabs"><button aria-pressed={status === 1} onClick={() => show(1)}>Pending</button><button aria-pressed={status === 2} onClick={() => show(2)}>Approved</button></div>
    {state.error?.status === 403 ? <ProcessingDenied status={status} /> : <LoadState state={state} />}
    {data && <><div className="list-wrapper"><div className="list-header"><span>Employee</span><span>Leave type</span><span>Dates</span><span>{status === 1 ? 'Actions' : 'Decision'}</span></div>{data.PageCollection.length ? data.PageCollection.map(item => <div className="list-row" key={item.Id}><div><strong>{item.EmployeeName || 'Employee'}</strong>{item.EmployeeId === profile.Id && <small>Your request</small>}</div><div><strong>{item.LeaveTypeDescription}</strong><small>{item.Reason}</small></div><span>{dateText(item.Start)} - {dateText(item.End)}</span>
      {status === 1 ? <div className="row-actions"><button onClick={() => navigate(`/approvals/${item.Id}`)}>Review</button></div> : <div><span className="badge status-2">Approved</span><small>{dateText(item.AuthorizedDate)}{item.AuthorizationRemarks ? ` | ${item.AuthorizationRemarks}` : ''}</small><div className="row-actions"><button onClick={() => navigate(`/approvals/${item.Id}`)}>View</button></div></div>}</div>) : <div className="empty">{status === 1 ? 'No leave requests are waiting for approval.' : 'No approved leave yet.'}</div>}</div>
      <div className="pagination"><button disabled={page === 0} onClick={() => setPage(x => x - 1)}>Prev</button><span>Page {page + 1} of {Math.max(1, data.TotalPages)}</span><button disabled={page + 1 >= data.TotalPages} onClick={() => setPage(x => x + 1)}>Next</button></div></>}
  </Card>;
}
function ApprovalReview({ api, profile }) {
  const { id } = useParams(); const navigate = useNavigate();
  const [remarks, setRemarks] = useState(''); const [busy, setBusy] = useState(null); const [error, setError] = useState(null);
  const state = useLoad(signal => api.processingApplication(id, { signal }), [api, id]); const item = state.data?.Application; const preview = state.data?.Preview;
  // Usability only: the ERP and development RPC also reject self-approval.
  const own = item?.EmployeeId === profile.Id;
  async function decide(decision) {
    if (busy || !window.confirm(decision === 'approve' ? 'Approve this leave request?' : 'Reject this leave request?')) return;
    setBusy(decision); setError(null);
    try { await api.authorizeLeave(item.Id, { decision, remarks: remarks.trim() }); navigate('/approvals', { state: { notice: decision === 'approve' ? 'Leave request approved.' : 'Leave request rejected.' } }); }
    catch (e) { setError(e); setBusy(null); }
  }
  const details = item && [['Employee', item.EmployeeName], ['Leave type', item.LeaveTypeDescription], ['Status', item.StatusDescription], ['Start', dateText(item.Start)], ['End', dateText(item.End)], ['Requested on', dateText(item.CreatedDate)], ['Reason', item.Reason],
    ...(item.Status === 1 ? [] : [['Decision remarks', item.AuthorizationRemarks], ['Decision date', dateText(item.AuthorizedDate)]])];
  return <Card title={item?.Status === 1 ? 'Review leave request' : 'Leave decision'} action={<button onClick={() => navigate('/approvals')} disabled={!!busy}>Back</button>}>
    {state.error?.status === 403 ? <ProcessingDenied /> : <LoadState state={state} />}
    {item && <><dl className="details-grid">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl>{preview && <><h2>Balance preview</h2><PreviewSummary preview={preview} /></>}
      {item.Status === 1 && (own ? <p className="help" role="status">You can't approve or reject your own request. Another approver must decide it.</p>
        : <div className="request-form"><Feedback error={error} /><Field label="Remarks (optional)"><textarea maxLength={256} rows={3} value={remarks} onChange={e => { setError(null); setRemarks(e.target.value); }} disabled={!!busy} /></Field>
          <div className="row-actions"><button className="primary" onClick={() => decide('approve')} disabled={!!busy}>{busy === 'approve' ? 'Approving...' : 'Approve'}</button><button className="danger" onClick={() => decide('reject')} disabled={!!busy}>{busy === 'reject' ? 'Rejecting...' : 'Reject'}</button></div></div>)}</>}
  </Card>;
}
function LeaveForm({ api, types, application, onClose, onSaved }) {
  const [form, setForm] = useState({ leaveTypeId: application?.LeaveTypeId || '', start: application?.Start?.slice(0, 10) || '', end: application?.End?.slice(0, 10) || '', reason: application?.Reason || '' }); const [busy, setBusy] = useState(false); const [error, setError] = useState(null);
  const preview = useLoad(signal => !form.leaveTypeId || !form.start || !form.end || form.end < form.start ? null : api.preview({ leaveTypeId: form.leaveTypeId, start: form.start, end: form.end, ...(application ? { excludedId: application.Id } : {}) }, { signal }), [api, form.leaveTypeId, form.start, form.end, application?.Id]);
  function set(field, value) { setError(null); setForm(current => ({ ...current, [field]: value })); }
  async function submit(event) { event.preventDefault(); if (busy || preview.loading || !preview.data?.CanSubmit) return; setBusy(true); setError(null); try { onSaved(await (application ? api.updateLeave(application.Id, form) : api.submitLeave(form))); } catch (e) { setError(e); } finally { setBusy(false); } }
  return <form className="request-form" onSubmit={submit}><div className="form-heading"><h2>{application ? 'Edit leave' : 'Request leave'}</h2><button type="button" onClick={onClose} disabled={busy}>Close</button></div><Feedback error={error} /><div className="form-grid"><Field label="Leave type"><select required value={form.leaveTypeId} onChange={e => set('leaveTypeId', e.target.value)} disabled={busy}><option value="">Select leave type</option>{types.map(type => <option key={type.Id} value={type.Id}>{type.Description}</option>)}</select></Field><Field label="Start date"><input required type="date" value={form.start} onChange={e => set('start', e.target.value)} disabled={busy} /></Field><Field label="End date"><input required type="date" min={form.start} value={form.end} onChange={e => set('end', e.target.value)} disabled={busy} /></Field></div><Field label="Reason"><textarea required maxLength={256} rows={3} value={form.reason} onChange={e => set('reason', e.target.value)} disabled={busy} /></Field><LoadState state={preview} />
    {preview.data && <PreviewSummary preview={preview.data} />}<button className="primary" disabled={busy || preview.loading || !preview.data?.CanSubmit}>{busy ? 'Saving...' : application ? 'Save changes' : 'Submit request'}</button></form>;
}
