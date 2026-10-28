import { Component, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { createPortalClient } from './lib/portalClient.js';
import { uniqueLeaveTypes } from './lib/leaveTypes.js';
import packageInfo from '../package.json';
import { Feedback, Field, Card, useLoad, LoadState, useRefreshOnFocus } from './components/PortalUi.jsx';
import { Payslips, PayslipDetail } from './components/Payslips.jsx';

const DEFAULT_PREFERENCES = { language: 'en', displayName: '', textSize: 'medium', highContrast: false, reduceMotion: false };
const preferenceKey = userName => `swizz-hr-portal-preferences:${encodeURIComponent(String(userName || 'guest').trim().toLowerCase())}`;
function loadPreferences(userName) {
  try {
    const stored = JSON.parse(localStorage.getItem(preferenceKey(userName)) || '{}');
    return {
      language: 'en',
      displayName: typeof stored.displayName === 'string' ? stored.displayName.trim().slice(0, 64) : '',
      textSize: ['small', 'medium', 'large'].includes(stored.textSize) ? stored.textSize : DEFAULT_PREFERENCES.textSize,
      highContrast: stored.highContrast === true,
      reduceMotion: stored.reduceMotion === true,
    };
  } catch (error) {
    console.warn('Saved portal preferences could not be read; using defaults on this device.', error);
    return { ...DEFAULT_PREFERENCES };
  }
}
const dateText = value => {
  return value ? new Date(String(value).slice(0, 10) + 'T12:00:00').toLocaleDateString() : '\u2014';
};
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const nextDate = value => { const [year, month, day] = value.split('-').map(Number); const date = new Date(Date.UTC(year, month - 1, day + 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`; };
// Shows a message instead of a blank page when a screen fails to render; the sidebar stays usable.
class ScreenErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <Card title="Something went wrong"><div className="feedback" role="alert">This page could not be displayed. Try again, or contact support with the details below.<small>{String(this.state.error?.message || this.state.error)}</small></div><button onClick={() => { this.setState({ error: null }); this.props.onHome(); }}>{this.props.homeLabel || 'Back to my profile'}</button></Card>;
  }
}
function ApprovalRedirect() {
  const { id } = useParams();
  return <Navigate to={`/processing/leave-applications/${encodeURIComponent(id)}`} replace />;
}
export default function App() {
  const [profile, setProfile] = useState(null); const [userName, setUserName] = useState(''); const [isApprover, setIsApprover] = useState(false); const [notice, setNotice] = useState('');
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES); const navigate = useNavigate(); const { pathname } = useLocation();
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = 'light';
    root.dataset.displayName = preferences.displayName;
    root.dataset.textSize = preferences.textSize;
    root.dataset.highContrast = String(preferences.highContrast);
    root.dataset.reduceMotion = String(preferences.reduceMotion);
  }, [preferences]);
  const api = useMemo(() => createPortalClient({ source: import.meta.env.VITE_DATA_SOURCE || 'erp', baseUrl: import.meta.env.VITE_API_BASE_URL || '/api', supabaseUrl: import.meta.env.VITE_SUPABASE_URL, supabaseKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, onUnauthorized: () => { setProfile(null); setUserName(''); setIsApprover(false); setNotice('Your session has ended. Please sign in again.'); } }), []);
  async function signedIn(result, loginUserName) {
    if (!result?.token) throw new Error('The sign-in response did not include a session token.');
    api.setToken(result.token);
    try {
      const employee = await api.profile(); if (!employee?.Id) throw new Error('Employee profile is incomplete. Contact HR.');
      // Accounts allowed to read the pending queue (permission 22017) also get approval screens.
      // This only chooses screens; the ERP or development RPC still enforces every permission. A failed check keeps the employee view.
      const approver = await api.processingApplications({ status: 1, pageIndex: 0, pageSize: 1 }).then(() => true, error => { if (error.status === 401) throw error; return false; });
      const signedInName = result.userName || loginUserName || '';
      setIsApprover(approver); setProfile(employee); setUserName(signedInName); setPreferences(loadPreferences(signedInName)); setNotice(''); navigate('/dashboard');
    }
    catch (error) { await api.clearToken(); throw error; }
  }
  async function logout() { setProfile(null); setUserName(''); setIsApprover(false); setPreferences(DEFAULT_PREFERENCES); setNotice(''); navigate('/login'); await api.clearToken(); }
  if (!profile) return <Login api={api} signedIn={signedIn} notice={notice} />;
  const home = '/dashboard';
  return <div className="app-shell"><aside className="sidebar"><NavLink className="brand" to={home}><span className="brand-icon">S</span><span>Swift<span className="brand-sub">HR PORTAL</span></span></NavLink>
    <nav><NavLink to="/dashboard">Dashboard</NavLink><NavLink to="/profile">My Profile</NavLink></nav>
    <p className="nav-label">LEAVE MANAGEMENT</p><nav><NavLink to="/leave/apply">Apply for Leave</NavLink><NavLink to="/leave/applications">My Leaves</NavLink><NavLink to="/leave-types">Leave types</NavLink><NavLink to="/balances">Leave balances</NavLink><NavLink to="/remaining">Remaining</NavLink></nav>
    {isApprover && <><p className="nav-label">LEAVE PROCESSING</p><nav><NavLink to="/processing/leave-applications">Team leave applications</NavLink></nav></>}
    {api.canViewPayslips && <><p className="nav-label">PAYROLL</p><nav><NavLink to="/payslips">My payslips</NavLink></nav></>}
    <p className="nav-label">ACCOUNT</p><nav><NavLink to="/settings">Settings</NavLink><NavLink to="/help">Help &amp; Support</NavLink></nav>
    <div className="sidebar-bottom"><span>{preferences.displayName || profile.CustomerFullName}</span><button onClick={logout}>Sign out</button></div></aside>
    <main><div className="topbar"><span>Welcome, {preferences.displayName || profile.CustomerIndividualFirstName || 'colleague'}</span><span className="status-dot">{isApprover ? 'Leave approver' : 'Employee portal'}</span></div><ScreenErrorBoundary key={pathname} onHome={() => navigate(home)} homeLabel="Back to dashboard"><Routes>
      <Route path="/dashboard" element={<Dashboard api={api} profile={profile} preferences={preferences} />} />
      <Route path="/profile" element={<Profile api={api} profile={profile} onUpdated={setProfile} />} />
      <Route path="/leave/apply" element={<Leave api={api} startWithForm />} />
      <Route path="/leave/applications" element={<Leave api={api} />} />
      <Route path="/leave" element={<Navigate to="/leave/applications" replace />} />
      <Route path="/payslips" element={<Payslips api={api} />} /><Route path="/payslips/:id" element={<PayslipDetail api={api} />} />
      <Route path="/help" element={<HelpSupport api={api} />} />
      <Route path="/leave-types" element={<LeaveTypes api={api} isApprover={isApprover} />} />
      <Route path="/leave-type" element={<LeaveTypes api={api} isApprover={isApprover} />} />
      <Route path="/approvals" element={<Navigate to="/processing/leave-applications" replace />} />
      <Route path="/approvals/:id" element={<ApprovalRedirect />} />
      <Route path="/processing/leave" element={<Navigate to="/processing/leave-applications" replace />} />
      <Route path="/leave/:id" element={<Navigate to="/leave/applications" replace />} />
      <Route path="/balances" element={<Balances api={api} />} />
      <Route path="/remaining" element={<Remaining api={api} />} />
      <Route path="/applications" element={<Navigate to="/leave/applications" replace />} />
      <Route path="/settings" element={<Settings api={api} userName={userName} profile={profile} preferences={preferences} onPreferencesChange={next => { localStorage.setItem(preferenceKey(userName), JSON.stringify(next)); setPreferences(next); }} isApprover={isApprover} onPasswordChanged={result => { api.setToken(result.token); setUserName(result.UserName || result.userName || userName); }} />} />
      <Route path="/processing/leave-applications" element={<Approvals api={api} profile={profile} />} /><Route path="/processing/leave-applications/:id" element={<ApprovalReview api={api} profile={profile} />} /><Route path="*" element={<Navigate to={home} replace />} />
    </Routes></ScreenErrorBoundary></main></div>;
}
function Login({ api, signedIn, notice }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [newPassword, setNewPassword] = useState(''); const [confirmPassword, setConfirmPassword] = useState('');
  const [initial, setInitial] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(null);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const result = initial
        ? await api.changeInitialPassword({ UserName: username, CurrentPassword: password, NewPassword: newPassword, ConfirmPassword: confirmPassword })
        : await api.login({ UserName: username, Password: password });
      if (result?.requiresPasswordChange ?? result?.RequiresPasswordChange) { setInitial(true); return; }
      await signedIn(result, username); setPassword(''); setNewPassword(''); setConfirmPassword('');
    }
    catch (e) { setError(e); } finally { setBusy(false); }
  }
  return <div className="login-shell"><div className="login-intro"><div className="brand"><span className="brand-icon">S</span>Swift HR Portal</div><div><h1>Swift HR Portal</h1><p>Keep up with your employee details and plan your time away.</p></div><small>Swift Financials</small></div><div className="login-panel"><form onSubmit={submit}><h2>{initial ? 'Choose your password' : 'Welcome back'}</h2>{notice && <p role="status">{notice}</p>}<Feedback error={error} />
      <Field label={api.loginLabel}><input required autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} disabled={busy || initial} /></Field><Field label={initial ? 'Temporary password' : 'Password'}><input required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></Field>
      {initial && <><Field label="New password"><input required type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} disabled={busy} /></Field><Field label="Confirm new password"><input required type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} disabled={busy} /></Field></>}
      <button className="primary full" disabled={busy}>{busy ? 'Signing in...' : initial ? 'Change password and sign in' : 'Sign in'}</button>
      <p className="help">Need an account? Contact your HR administrator.</p>
    </form></div></div>;
}
function Profile({ api, profile, onUpdated }) {
  const [editing, setEditing] = useState(false); const [success, setSuccess] = useState('');
  const fields = [['Payroll number', profile.CustomerIndividualPayrollNumbers], ['Email', profile.CustomerAddressEmail], ['Mobile', profile.CustomerAddressMobileLine], ['Start date', dateText(profile.EmploymentStartDate)], ['Department', profile.DepartmentDescription], ['Designation', profile.DesignationDescription], ['Branch', profile.BranchDescription], ['Employment type', profile.EmployeeTypeDescription], ['NSSF number', profile.NationalSocialSecurityFundNumber], ['SHA / NHIF number', profile.NationalHospitalInsuranceFundNumber]];
  const heading = <div className="profile-heading"><div className="avatar">{(profile.CustomerIndividualFirstName || 'E').slice(0, 1)}</div><div><h2>{profile.CustomerFullName}</h2><p className="muted">{profile.DesignationDescription}</p></div></div>;
  if (editing) return <Card title="Edit my details">{heading}<ProfileForm api={api} profile={profile} onClose={() => setEditing(false)} onSaved={saved => { onUpdated(saved); setEditing(false); setSuccess('Your details were updated.'); }} /></Card>;
  return <Card title="My employee profile" action={api.canEditProfile && <button onClick={() => { setSuccess(''); setEditing(true); }}>Edit my details</button>}>{success && <p className="success" role="status">{success}</p>}{heading}<dl className="details-grid">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '\u2014'}</dd></div>)}</dl><p className="help">{api.canEditProfile ? 'You can update your email and mobile. To change other details, contact HR.' : 'To correct your employee details, contact HR.'}</p></Card>;
}
function Dashboard({ api, profile, preferences }) {
  const links = [
    { title: 'Apply for Leave', description: 'Start a leave request and review its details before submitting.', to: '/leave/apply', action: 'Start a request' },
    { title: 'My Leaves', description: 'Check the status and history of your leave requests.', to: '/leave/applications', action: 'View my leaves' },
    { title: 'My Profile', description: 'Review your employee information and contact details.', to: '/profile', action: 'View profile' },
    ...(api?.canViewPayslips ? [{ title: 'My payslips', description: 'View your posted payslips and payroll entries.', to: '/payslips', action: 'View payslips' }] : []),
    { title: 'Help & Support', description: 'Find guidance for common employee portal tasks.', to: '/help', action: 'Get help' },
  ];
  return <Card title="Dashboard">
    <section className="dashboard-welcome">
      <div className="dashboard-avatar">{(profile.CustomerIndividualFirstName || profile.CustomerFullName || 'E').slice(0, 1)}</div>
      <div><p className="dashboard-eyebrow">EMPLOYEE PORTAL</p><h2>Welcome back, {preferences.displayName || profile.CustomerIndividualFirstName || 'colleague'}</h2><p>{profile.DesignationDescription || 'Your employee self-service workspace'}</p></div>
    </section>
    <div className="dashboard-section-heading"><h2>Quick access</h2><p>Manage your leave and employee information.</p></div>
    <div className="dashboard-links">{links.map(link => <NavLink className="dashboard-link" to={link.to} key={link.to}><span className="dashboard-link-title">{link.title}</span><span className="dashboard-link-description">{link.description}</span><span className="dashboard-link-action">{link.action} <span aria-hidden="true">→</span></span></NavLink>)}</div>
    {(profile.DepartmentDescription || profile.BranchDescription) && <div className="dashboard-context"><span>{profile.DepartmentDescription}</span>{profile.DepartmentDescription && profile.BranchDescription && <span aria-hidden="true">·</span>}<span>{profile.BranchDescription}</span></div>}
  </Card>;
}
function HelpSupport({ api }) {
  const topics = [
    ['Sign-in problems', 'Use the account provided by your organization. There is no self-registration in this portal. If your account is locked, unconfirmed or not linked to an employee record, contact HR through your established support channel.'],
    ['Change your password', api.source === 'erp' ? 'Open Settings and use Change password. Enter your current password and confirm the new password. The authenticated HR service validates the current password and enforces its configured password policy. If you cannot sign in, use your organization’s established account recovery process.' : 'Development passwords are managed in Supabase Auth. Use your project administrator’s established support process if you need to change or recover a password.'],
    ['Update preferences', 'Open Settings to select a preferred display name and accessibility options. Account preferences are saved locally in this browser for your sign-in name and do not sync across devices.'],
    ['Update contact details', 'Open My Profile and choose Edit my details. You can update your email address and mobile number; other employee details are managed by HR.'],
    ['Correct employee information', 'Open Settings to review your account information. For official details that cannot be edited in My Profile, contact HR through your organization’s established support process.'],
    ['Apply for leave', 'Open Apply for Leave, choose an eligible leave type, enter dates and a reason, then review the available preview before submitting. Handover details and file uploads are not connected.'],
    ['Check a leave request', 'Open My Leaves to see your own requests and their latest statuses. Pending requests can be edited or withdrawn. Refresh the list if a request was recently processed.'],
    ['View payslips', api.canViewPayslips ? 'Open My payslips to view your posted payroll periods, net pay and entries. If a payslip is missing, contact HR. PDF downloads and P9 forms are not connected.' : 'Payslips are available through the ERP only. They are not simulated in development mode.'],
    ['Report an API error', 'Try again after checking your connection. If the error includes a reference ID, share that ID with your HR or support team; do not share your password or session token.'],
  ];
  return <Card title="Help & Support"><p className="muted section-intro">Guidance for common tasks in the employee portal.</p><dl className="details-grid">{topics.map(([title, description]) => <div key={title}><dt>{title}</dt><dd>{description}</dd></div>)}</dl><p className="help">For account-specific or urgent assistance, use your organization's established HR support channel. Contact details are not configured in this portal.</p></Card>;
}
function PasswordField({ label, autoComplete, value, onChange, disabled }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return <div className="field">
    <label htmlFor={id}><span>{label}</span></label>
    <div className="password-input"><input id={id} required type={visible ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={onChange} disabled={disabled} /><button type="button" aria-controls={id} aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} onClick={() => setVisible(state => !state)} disabled={disabled}>{visible ? 'Hide' : 'Show'}</button></div>
  </div>;
}
function PasswordChange({ api, onChanged }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState('');
  const rules = [
    ['length', 'At least 8 characters', newPassword.length >= 8],
    ['case', 'Uppercase and lowercase letters', /[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword)],
    ['number', 'At least one number', /\d/.test(newPassword)],
    ['special', 'At least one special character', /[^A-Za-z0-9]/.test(newPassword)],
  ];
  const strength = newPassword ? Math.min(4, rules.filter(([, , valid]) => valid).length) : 0;
  const mismatch = !!confirmPassword && newPassword !== confirmPassword;
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (newPassword !== confirmPassword) { setError(new Error('The new passwords do not match.')); return; }
    setBusy(true); setError(null); setSuccess('');
    try {
      const result = await api.changePassword({ CurrentPassword: currentPassword, NewPassword: newPassword, ConfirmPassword: confirmPassword });
      if (!result?.token) throw new Error('Your password was changed, but the HR service did not return a new session. Sign in again.');
      onChanged(result);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setSuccess('Your password was changed.');
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  return <form className="request-form" onSubmit={submit}>
    <div className="form-heading"><h2>Change password</h2></div>
    {api.source === 'supabase'
      ? <p className="help">Password changes are managed in Supabase Auth for development accounts.</p>
      : <><p className="section-intro">Update the password for your portal sign-in. The HR service securely verifies your current password and applies its password policy.</p>
        <PasswordField label="Current password" autoComplete="current-password" value={currentPassword} onChange={event => { setError(null); setCurrentPassword(event.target.value); }} disabled={busy} />
        <PasswordField label="New password" autoComplete="new-password" value={newPassword} onChange={event => { setError(null); setNewPassword(event.target.value); }} disabled={busy} />
        {newPassword && <div className="password-strength" aria-live="polite">
          <div className="password-strength-heading"><span>Password strength estimate</span><strong>{['Weak', 'Weak', 'Fair', 'Good', 'Strong'][strength]}</strong></div>
          <div className="password-strength-track" role="progressbar" aria-label="Estimated password strength" aria-valuemin="0" aria-valuemax="4" aria-valuenow={strength}><span aria-hidden="true" style={{ width: `${strength * 25}%` }} /></div>
          <ul>{rules.map(([key, text, valid]) => <li className={valid ? 'valid' : ''} key={key}>{valid ? 'Met' : 'Needed'}: {text}</li>)}</ul>
          <small>The HR service remains the authority on password requirements.</small>
        </div>}
        <PasswordField label="Confirm new password" autoComplete="new-password" value={confirmPassword} onChange={event => { setError(null); setConfirmPassword(event.target.value); }} disabled={busy} />
        {mismatch && <p className="field-error" role="alert">The new passwords do not match.</p>}
        <Feedback error={error} />
        {success && <p className="success" role="status">{success}</p>}
        <button className="primary" disabled={busy || !currentPassword || !newPassword || !confirmPassword || mismatch}>{busy ? 'Changing password...' : 'Change password'}</button>
      </>}
  </form>;
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
  const currentType = state.data?.find(item => item.Id === selectedType);
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
      setSuccess(`${type?.Description || 'Leave type'} balance saved for ${result.EmployeeCount} employees, as at ${dateText(result.AsAt)}.`);
      state.retry();
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  return <Card title="Leave types">
    <LoadState state={state} />
    {success && <p className="success" role="status">{success}</p>}
    {canManage && selectedType && <form key={selectedType} className="request-form fixture-form" onSubmit={saveBalance}>
      <div className="form-heading"><h2>Set up {state.data?.find(item => item.Id === selectedType)?.Description} balance</h2><button type="button" onClick={() => { setSelectedType(''); setError(null); setSuccess(''); }} disabled={busy}>Cancel</button></div>
      <p className="section-intro">Set or edit the fixture for all unlocked employees on this date. Existing history is preserved; these values do not change ERP data.</p>
      <div className="form-grid">
        <Field label="Entitlement"><input name="Entitlement" required type="number" min="0" step="0.01" defaultValue={currentType?.Entitlement ?? ''} /></Field>
        <Field label="Unit type code"><input name="UnitType" required type="number" min="0" step="1" defaultValue={currentType?.UnitType ?? 3} /></Field>
        <Field label="Unit description"><input name="UnitTypeDescription" required maxLength={40} defaultValue={currentType?.UnitTypeDescription ?? 'Yearly'} /></Field>
        <Field label="Accrued"><select name="IsAccrued" defaultValue={currentType?.IsAccrued ? 'true' : 'false'}><option value="false">No</option><option value="true">Yes</option></select></Field>
        <Field label="Balance as at"><input name="AsAt" type="date" required defaultValue={today()} /></Field>
        <Field label="Cycle start"><input name="CycleStart" type="date" required defaultValue={`${today().slice(0, 4)}-01-01`} /></Field>
        <Field label="Cycle end"><input name="CycleEnd" type="date" required defaultValue={`${today().slice(0, 4)}-12-31`} /></Field>
        <Field label="Used"><input name="Used" required type="number" min="0" step="0.01" /></Field>
        <Field label="Pending"><input name="Reserved" required type="number" min="0" step="0.01" /></Field>
        <Field label="Available"><input name="Available" required type="number" min="0" step="0.01" /></Field>
      </div>
      <div className="tabs"><label><input name="ExcludeHolidays" type="checkbox" defaultChecked={currentType?.ExcludeHolidays ?? true} /> Exclude holidays</label><label><input name="ExcludeWeekends" type="checkbox" defaultChecked={currentType?.ExcludeWeekends ?? true} /> Exclude weekends</label></div>
      <Feedback error={error} />
      <button className="primary" disabled={busy}>{busy ? 'Saving...' : 'Save balance changes'}</button>
    </form>}
    {state.data && <div className="list-wrapper">{state.data.length ? state.data.map(type => <div className="list-row type-row" key={type.Id}><strong>{type.Description}</strong><span>{type.Entitlement == null ? 'Balance setup required' : `${type.Entitlement} ${type.UnitTypeDescription || ''}`}</span><div className="row-actions">{canManage && <button onClick={() => { setSelectedType(type.Id); setError(null); setSuccess(''); }}>Set up balance</button>}<button onClick={() => navigate(`/balances?leaveTypeId=${encodeURIComponent(type.Id)}`)}>View balance</button></div></div>) : <div className="empty">No leave types available.</div>}</div>}
  </Card>;
}
export function Settings({ api, userName, profile, preferences, onPreferencesChange, isApprover, onPasswordChanged }) {
  const [description, setDescription] = useState('');
  const [editingType, setEditingType] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState('');
  const [preferenceDraft, setPreferenceDraft] = useState(preferences);
  const [preferenceError, setPreferenceError] = useState(null);
  const [preferenceSuccess, setPreferenceSuccess] = useState('');
  const canManageTypes = api.source === 'supabase' && isApprover;
  const types = useLoad(async () => canManageTypes ? (await api.manageLeaveTypes({ action: 'list' })).Types || [] : null, [api, canManageTypes]);
  const preferencesChanged = JSON.stringify(preferenceDraft) !== JSON.stringify(preferences);
  useEffect(() => {
    if (!preferencesChanged) return undefined;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    const warnNavigation = event => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!link || new URL(link.href, window.location.href).origin !== window.location.origin) return;
      if (!window.confirm('Discard your unsaved preference changes and leave Settings?')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      } else {
        setPreferenceDraft(preferences);
        setPreferenceError(null);
      }
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', warnNavigation, true);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('click', warnNavigation, true);
    };
  }, [preferencesChanged, preferences]);
  function updatePreference(name, value) {
    setPreferenceDraft(current => ({ ...current, [name]: value }));
    setPreferenceError(null); setPreferenceSuccess('');
  }
  function savePreferences(event) {
    event.preventDefault();
    if (busy) return;
    const displayName = preferenceDraft.displayName.trim();
    if (displayName.length > 64) { setPreferenceError(new Error('Preferred display name must be 64 characters or fewer.')); return; }
    setBusy(true); setPreferenceError(null); setPreferenceSuccess('');
    try {
      const saved = { ...preferenceDraft, displayName };
      onPreferencesChange(saved);
      setPreferenceDraft(saved);
      setPreferenceSuccess('Your preferences were saved on this device.');
    } catch (e) { setPreferenceError(e); }
    finally { setBusy(false); }
  }
  function resetPreferences() {
    if (preferencesChanged && !window.confirm('Discard your unsaved preference changes and reset your preferences?')) return;
    setBusy(true); setPreferenceError(null); setPreferenceSuccess('');
    try {
      onPreferencesChange({ ...DEFAULT_PREFERENCES });
      setPreferenceDraft({ ...DEFAULT_PREFERENCES });
      setPreferenceSuccess('Your preferences were reset and saved on this device.');
    } catch (e) { setPreferenceError(e); }
    finally { setBusy(false); }
  }
  function cancelPreferenceChanges() {
    if (preferencesChanged && !window.confirm('Discard your unsaved preference changes?')) return;
    setPreferenceDraft(preferences); setPreferenceError(null); setPreferenceSuccess('');
  }
  async function createType(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null); setSuccess('');
    try {
      const result = await api.createLeaveType({ Description: description });
      setSuccess(`${result.Description} was added. Go to Leave types to configure its balance.`);
      setDescription('');
      types.retry();
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  async function saveType(event) {
    event.preventDefault();
    if (busy || !editingType) return;
    const values = new FormData(event.currentTarget);
    setBusy(true); setError(null); setSuccess('');
    try {
      const result = await api.manageLeaveTypes({ action: 'update', LeaveTypeId: editingType.Id, Description: values.get('Description') });
      setSuccess(`${result.Description} was updated.`);
      setEditingType(null);
      types.retry();
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  async function changeArchived(type, archived) {
    if (busy) return;
    if (archived && !window.confirm(`Archive ${type.Description}? Employees will no longer be able to select it. Existing applications and balance fixtures will be preserved.`)) return;
    setBusy(true); setError(null); setSuccess('');
    try {
      const result = await api.manageLeaveTypes({ action: archived ? 'archive' : 'restore', LeaveTypeId: type.Id });
      setSuccess(archived ? `${result.Description} was archived. Existing history and balances were preserved.` : `${result.Description} was restored.`);
      types.retry();
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  return <Card title="Settings"><p className="muted section-intro">Manage your password, account details and personal portal preferences.</p>
    <Feedback error={error} />{success && <p className="success" role="status">{success}</p>}
    <PasswordChange api={api} onChanged={onPasswordChanged} />
    <form className="request-form" onSubmit={savePreferences}>
      <div className="form-heading"><h2>Account preferences</h2></div>
      <p className="muted section-intro">These preferences are saved in this browser for this sign-in name; they are not synchronized across devices.</p>
      <div className="settings-grid">
        <Field label="Preferred language"><select value={preferenceDraft.language} onChange={event => updatePreference('language', event.target.value)} disabled={busy}><option value="en">English</option></select></Field>
        <Field label="Preferred display name"><input maxLength={64} value={preferenceDraft.displayName} onChange={event => updatePreference('displayName', event.target.value)} disabled={busy} placeholder={profile.CustomerIndividualFirstName || 'Use your profile name'} /></Field>
      </div>
      <p className="help">The interface is currently available in English.</p>
      <Feedback error={preferenceError} />{preferenceSuccess && <p className="success" role="status">{preferenceSuccess}</p>}
      <div className="row-actions"><button className="primary" disabled={busy || !preferencesChanged}>{busy ? 'Saving...' : 'Save changes'}</button><button type="button" disabled={busy} onClick={cancelPreferenceChanges}>Cancel changes</button><button type="button" disabled={busy} onClick={resetPreferences}>Reset preferences</button></div>
    </form>
    <section className="request-form">
      <div className="form-heading"><h2>Accessibility</h2></div>
      <div className="settings-grid">
        <Field label="Text size"><select value={preferenceDraft.textSize} onChange={event => updatePreference('textSize', event.target.value)} disabled={busy}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></Field>
        <label className="settings-toggle"><input type="checkbox" checked={preferenceDraft.highContrast} onChange={event => updatePreference('highContrast', event.target.checked)} disabled={busy} /> High contrast</label>
        <label className="settings-toggle"><input type="checkbox" checked={preferenceDraft.reduceMotion} onChange={event => updatePreference('reduceMotion', event.target.checked)} disabled={busy} /> Reduce animations</label>
      </div>
      <p className="muted section-intro">Save these options in Account preferences to apply them and keep them on this device.</p>
    </section>
    <section className="request-form">
      <div className="form-heading"><h2>My account information</h2></div>
      <dl className="details-grid">{[['Employee name', profile.CustomerFullName], ['Employee number', profile.CustomerIndividualPayrollNumbers], ['Username', userName], ['Registered email', profile.CustomerAddressEmail], ['Registered phone', profile.CustomerAddressMobileLine], ['Department', profile.DepartmentDescription], ['Job title', profile.DesignationDescription]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '\u2014'}</dd></div>)}</dl>
      <p className="help">Your details are retrieved from your authenticated employee profile. Email and phone can be updated through the authorized profile form; for corrections to official employment information, contact HR.</p>
      <div className="row-actions"><NavLink className="button-link" to="/profile">Review or update contact details</NavLink><NavLink className="button-link" to="/help">Request an official information correction</NavLink></div>
    </section>
    <section className="request-form">
      <div className="form-heading"><h2>Security &amp; privacy</h2></div>
      <p>Your password change is verified by the authenticated HR service. Never share your password or session token.</p>
      <ul className="settings-list"><li>Last successful sign-in: not provided by the authentication API.</li><li>Active sessions and sign-out of other devices: not supported by the current API.</li><li>Two-factor authentication: not supported by the current authentication service.</li><li>Password recovery: use your organization’s established account recovery process; no recovery link is configured.</li><li>Privacy policy: no policy URL is configured for this portal.</li></ul>
      <p className="muted">The portal uses the authenticated employee profile for account information. Session tokens remain in memory and are not saved in browser storage.</p>
    </section>
    <section className="request-form">
      <div className="form-heading"><h2>Help &amp; About</h2></div>
      <p><strong>Swift HR Portal</strong> v{packageInfo.version}</p>
      <p className="muted">Employee self-service for the Swift Financials ERP.</p>
      <p>HR/IT support contacts and terms of use are not configured in the portal.</p>
      <NavLink className="button-link" to="/help">Help &amp; Support</NavLink>
    </section>
    {canManageTypes && <><p className="muted section-intro">Development-only leave type management. These changes do not affect ERP.</p><form className="request-form" onSubmit={createType}>
      <div className="form-heading"><h2>Create leave type</h2></div>
      <Field label="Leave type name"><input required maxLength={100} value={description} onChange={event => { setDescription(event.target.value); setError(null); }} disabled={busy} /></Field>
      <button className="primary" disabled={busy}>{busy ? 'Creating...' : 'Create leave type'}</button>
    </form>
    <section className="request-form">
      <div className="form-heading"><h2>Manage leave types</h2></div>
      <LoadState state={types} />
      {types.data && <div className="list-wrapper">{types.data.length ? types.data.map(type => <div className="list-row type-row" key={type.Id}>
        <div><strong>{type.Description}</strong>{type.Archived && <small>Archived</small>}</div>
        <span>{type.Entitlement == null ? 'Balance not configured' : `${type.Entitlement} ${type.UnitTypeDescription || ''}`}</span>
        <div className="row-actions">
          <button disabled={busy} onClick={() => { setEditingType(type); setError(null); setSuccess(''); }}>Edit name</button>
          <button disabled={busy} className={type.Archived ? '' : 'danger'} onClick={() => changeArchived(type, !type.Archived)}>{type.Archived ? 'Restore' : 'Archive'}</button>
        </div>
      </div>) : <div className="empty">No leave types available.</div>}</div>}
      {editingType && <form className="request-form" onSubmit={saveType}>
        <div className="form-heading"><h2>Edit {editingType.Description}</h2><button type="button" disabled={busy} onClick={() => setEditingType(null)}>Cancel</button></div>
        <Field label="Leave type name"><input name="Description" required maxLength={100} defaultValue={editingType.Description} disabled={busy} /></Field>
        <button className="primary" disabled={busy}>{busy ? 'Saving...' : 'Save name'}</button>
      </form>}
    </section></>}
  </Card>;
}
function Leave({ api, startWithForm = false }) {
  const [page, setPage] = useState(0); const [open, setOpen] = useState(startWithForm); const [editingApplication, setEditingApplication] = useState(null); const [busyId, setBusyId] = useState(null); const [busyAction, setBusyAction] = useState(null); const [error, setError] = useState(null); const [success, setSuccess] = useState('');
  const navigate = useNavigate();
  const state = useLoad(async signal => {
    const [applications, types] = await Promise.all([
      startWithForm ? Promise.resolve(null) : api.applications(page, { signal }),
      api.leaveTypes({ signal }),
    ]);
    return { applications, types: uniqueLeaveTypes(types) };
  }, [api, page, startWithForm]);
  useRefreshOnFocus(() => { if (!open) state.retry(); });
  async function withdraw(item) { if (!window.confirm('Withdraw this pending leave request?')) return; setBusyId(item.Id); setBusyAction('withdraw'); setError(null); try { await api.withdraw(item.Id); setSuccess('Leave request withdrawn.'); state.retry(); } catch (e) { setError(e); } finally { setBusyId(null); setBusyAction(null); } }
  async function retryNotification(item) { setBusyId(item.Id); setBusyAction('notification'); setError(null); setSuccess(''); try { await api.retryNotification(item.Id); setSuccess('Notification retry requested.'); state.retry(); } catch (e) { setError(e); } finally { setBusyId(null); setBusyAction(null); } }
  function closeForm() { setOpen(false); setEditingApplication(null); if (startWithForm) navigate('/leave/applications'); }
  const data = state.data?.applications;
  return <Card title={startWithForm ? 'Apply for Leave' : 'My Leaves'} action={!startWithForm && <div className="row-actions"><button onClick={state.retry} disabled={state.loading || !!busyId}>Refresh</button><button className="primary" onClick={() => navigate('/leave/apply')} disabled={!state.data || !!busyId}>Apply for Leave</button></div>}><p className="muted section-intro">{startWithForm ? 'Submit a leave request for review.' : 'Your leave requests and their current status.'}</p><Feedback error={error} />{success && <p className="success" role="status">{success}</p>}<LoadState state={state} />
    {open && state.data && <LeaveForm key={editingApplication?.Id || 'new'} api={api} types={state.data.types} application={editingApplication || undefined} onClose={closeForm} onSaved={saved => { const wasEditing = !!editingApplication; closeForm(); setSuccess(wasEditing ? saved.NotificationPending ? 'Leave request updated. The HR notification is pending.' : 'Leave request updated.' : saved.NotificationPending ? 'Request saved. The HR notification is pending.' : 'Leave request submitted.'); if (!wasEditing) setPage(0); state.retry(); }} />}
    {!startWithForm && data && <><div className="list-wrapper"><div className="list-header"><span>Leave type</span><span>Dates</span><span>Status</span><span>Actions</span></div>{data.PageCollection.length ? data.PageCollection.map(item => <div className="list-row" key={item.Id}><div><strong>{item.LeaveTypeDescription}</strong></div><span>{dateText(item.Start)} - {dateText(item.End)}</span><span className={`badge status-${item.Status}`}>{item.StatusDescription}</span><div className="row-actions">{item.Status === 1 && <><button disabled={!!busyId || open} onClick={() => { setEditingApplication(item); setOpen(true); }}>Edit</button><button disabled={!!busyId || open} onClick={() => withdraw(item)}>{busyId === item.Id && busyAction === 'withdraw' ? 'Withdrawing...' : 'Withdraw'}</button></>}{api.source === 'erp' && item.NotificationPending && <button disabled={!!busyId || open} onClick={() => retryNotification(item)}>{busyId === item.Id && busyAction === 'notification' ? 'Retrying...' : 'Retry notification'}</button>}</div></div>) : <div className="empty">No leave requests yet.</div>}</div><div className="pagination"><button disabled={page === 0 || !!busyId || open} onClick={() => setPage(x => x - 1)}>Prev</button><span>Page {page + 1} of {Math.max(1, data.TotalPages)}</span><button disabled={page + 1 >= data.TotalPages || !!busyId || open} onClick={() => setPage(x => x + 1)}>Next</button></div></>}
  </Card>;
}
function ApplicationDetail({ api }) {
  const { id } = useParams(); const [editing, setEditing] = useState(false); const navigate = useNavigate();
  const state = useLoad(async signal => ({ application: await api.application(id, { signal }), types: uniqueLeaveTypes(await api.leaveTypes({ signal })) }), [api, id]); const item = state.data?.application;
  useRefreshOnFocus(() => { if (!editing) state.retry(); });
  return <Card title="Leave application" action={<div className="row-actions"><button onClick={state.retry} disabled={state.loading}>Refresh</button><button onClick={() => navigate('/leave/applications')}>Back</button></div>}><LoadState state={state} />{item && <>{editing ? <LeaveForm key={item.Id} api={api} types={state.data.types} application={item} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); state.retry(); }} /> : <><dl className="details-grid">{[['Leave type', item.LeaveTypeDescription], ['Status', item.StatusDescription], ['Start', dateText(item.Start)], ['End', dateText(item.End)], ['Reason', item.Reason], ['Decision remarks', item.AuthorizationRemarks], ['Decision date', dateText(item.AuthorizedDate)], ['Recall remarks', item.RecallRemarks]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '\u2014'}</dd></div>)}</dl>{item.Status === 1 && <button className="primary" onClick={() => setEditing(true)}>Edit application</button>}</>}</>}</Card>;
}
function Balances({ api }) {
  const [searchParams] = useSearchParams(); const navigate = useNavigate(); const [leaveTypeId, setType] = useState(() => searchParams.get('leaveTypeId') || ''); const [asAt, setAsAt] = useState(today); const [page, setPage] = useState(0);
  const types = useLoad(async signal => uniqueLeaveTypes(await api.leaveTypes({ signal })), [api]); const state = useLoad(signal => leaveTypeId && asAt ? api.balances({ leaveTypeId, asAt, pageIndex: page }, { signal }) : null, [api, leaveTypeId, asAt, page]); const data = state.data;
  useRefreshOnFocus(state.retry);
  const missingFixture = state.error?.message?.includes('No balance fixture matches this date and page.');
  return <Card title="Leave balances" action={<button onClick={state.retry} disabled={!leaveTypeId || state.loading}>Refresh balance</button>}><LoadState state={types} /><div className="form-grid"><Field label="Leave type"><select value={leaveTypeId} onChange={e => { setType(e.target.value); setPage(0); }}><option value="">Select leave type</option>{types.data?.map(type => <option key={type.Id} value={type.Id}>{type.Description}</option>)}</select></Field><Field label="As at"><input type="date" value={asAt} onChange={e => { setAsAt(e.target.value); setPage(0); }} /></Field></div>
    {leaveTypeId && asAt ? missingFixture
      ? <div className="empty"><Feedback error={`No balance fixture is configured for ${dateText(asAt)}. Balance fixtures are date-specific. Choose a configured date or ask an approver to set up this date under Leave types.`} /><button onClick={() => navigate('/leave-types')}>Go to Leave types</button></div>
      : <LoadState state={state} />
      : <div className="empty">Select a leave type and date.</div>}{data && <><Feedback error={data.BalanceError} />{data.Balance && <><div className="balance-summary"><div><span>Leaves left</span><strong>{data.Balance.Available}</strong></div><div><span>Leaves used</span><strong>{data.Balance.Used}</strong></div></div><dl className="details-grid">{['Entitlement', 'Reserved'].map(key => <div key={key}><dt>{key}</dt><dd>{data.Balance[key]}</dd></div>)}</dl></>}<h2>Leave history</h2><div className="list-wrapper">{data.History.length ? data.History.map(item => <div className="list-row" key={item.Id}><span>{dateText(item.Start)} - {dateText(item.End)}</span><span>{item.Reason}</span><span>{({ 1: 'Pending', 2: 'Approved', 4: 'Rejected', 8: 'Recalled', 16: 'Withdrawn' })[item.Status] || 'Unknown'}</span><span>{item.ChargedDaysInYear} days</span></div>) : <div className="empty">No history for this period.</div>}</div><div className="pagination"><button disabled={page === 0} onClick={() => setPage(x => x - 1)}>Prev</button><span>Page {page + 1} of {Math.max(1, Math.ceil(data.HistoryCount / 10))}</span><button disabled={(page + 1) * 10 >= data.HistoryCount} onClick={() => setPage(x => x + 1)}>Next</button></div></>}</Card>;
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
  if (preview.PreviewAvailable === false || preview.Error === 'No matching preview fixture') {
    return <p className="help" role="status">No preview fixture exists for these dates. Leave days and balance are not calculated in development mode.</p>;
  }
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
  return <Card title="Leave applications" action={<button onClick={state.retry} disabled={state.loading}>Refresh</button>}><p className="muted section-intro">Review employees' pending leave requests and view applications that have been approved.</p>{notice && <p className="success" role="status">{notice}</p>}
    {own > 0 && <p className="help" role="status">Your own requests are hidden here. Another approver reviews them.</p>}
    <div className="tabs"><button aria-pressed={status === 1} onClick={() => show(1)}>Pending</button><button aria-pressed={status === 2} onClick={() => show(2)}>Approved</button></div>
    {state.error?.status === 403 ? <ProcessingDenied status={status} /> : <LoadState state={state} />}
    {state.data && !rows && <Feedback error={unexpectedProcessingReply} />}
    {hidden > 0 && <p className="help" role="status">{hidden === 1 ? '1 request on this page couldn\'t be shown because it isn\'t' : `${hidden} requests on this page couldn't be shown because they aren't`} linked to an employee record. Ask HR to check {hidden === 1 ? 'it' : 'them'}.</p>}
    {rows && <><div className="list-wrapper"><div className="list-header"><span>Employee</span><span>Leave type</span><span>Dates</span><span>{status === 1 ? 'Actions' : 'Decision'}</span></div>{rows.length ? rows.map(item => <div className="list-row" key={item.Id}><div><strong>{item.EmployeeName || 'Employee'}</strong></div><div><strong>{item.LeaveTypeDescription}</strong><small>{item.Reason}</small></div><span>{dateText(item.Start)} - {dateText(item.End)}</span>
      {status === 1 ? <div className="row-actions"><button onClick={() => navigate(`/processing/leave-applications/${item.Id}`)}>Review</button></div> : <div><span className="badge status-2">Approved</span><small>{dateText(item.AuthorizedDate)}{item.AuthorizationRemarks ? ` | ${item.AuthorizationRemarks}` : ''}</small><div className="row-actions"><button onClick={() => navigate(`/processing/leave-applications/${item.Id}`)}>View</button></div></div>}</div>) : <div className="empty">{status === 1 ? 'No leave requests are waiting for approval.' : 'No approved leave yet.'}</div>}</div>
      <div className="pagination"><button disabled={page === 0} onClick={() => setPage(x => x - 1)}>Prev</button><span>Page {page + 1} of {totalPages}</span><button disabled={page + 1 >= totalPages} onClick={() => setPage(x => x + 1)}>Next</button></div></>}
  </Card>;
}
function ApprovalReview({ api, profile }) {
  const { id } = useParams(); const navigate = useNavigate();
  const [remarks, setRemarks] = useState(''); const [busy, setBusy] = useState(null); const [error, setError] = useState(null);
  const [recalling, setRecalling] = useState(false); const [recall, setRecall] = useState({ effectiveReturnDate: today(), remarks: '' });
  const state = useLoad(signal => api.processingApplication(id, { signal }), [api, id]); const item = state.data?.Application; const preview = state.data?.Preview;
  // Usability only: the ERP and development RPC also reject self-approval.
  const own = item?.EmployeeId === profile.Id;
  useRefreshOnFocus(() => { if (!busy) state.retry(); });
  async function decide(decision) {
    if (!item?.Id || own || item.Status !== 1 || busy || !window.confirm(decision === 'approve' ? 'Approve this leave request?' : 'Reject this leave request?')) return;
    setBusy(decision); setError(null);
    try { await api.authorizeLeave(item.Id, { decision, remarks: remarks.trim() }); navigate('/processing/leave-applications', { state: { notice: decision === 'approve' ? 'Leave request approved.' : 'Leave request rejected.' } }); }
    catch (e) { setError(e); setBusy(null); }
  }
  // Recall calls an employee back from approved leave; the ERP enforces permission and date rules.
  // The return date must fall within the approved leave; start from today when it does, else the first day.
  const leaveStart = item?.Start ? String(item.Start).slice(0, 10) : ''; const leaveEnd = item?.End ? String(item.End).slice(0, 10) : '';
  function openRecall() {
    const now = today(); const start = now < leaveStart ? leaveStart : now > leaveEnd ? leaveStart : now;
    setError(null); setRecall({ effectiveReturnDate: start, remarks: '' }); setRecalling(true);
  }
  async function submitRecall(event) {
    event.preventDefault();
    if (!api.canRecallLeave || !item?.Id || own || item.Status !== 2 || busy || !window.confirm('Recall this approved leave? The employee will be called back from leave.')) return;
    if (!recall.remarks.trim()) { setError(new Error('Enter a recall reason.')); return; }
    setBusy('recall'); setError(null);
    try { await api.recallLeave(item.Id, { effectiveReturnDate: recall.effectiveReturnDate, remarks: recall.remarks.trim() }); navigate('/processing/leave-applications', { state: { notice: 'Leave recalled.' } }); }
    catch (e) { setError(e); setBusy(null); }
  }
  const details = item && [['Employee', item.EmployeeName], ['Leave type', item.LeaveTypeDescription], ['Status', item.StatusDescription], ['Start', dateText(item.Start)], ['End', dateText(item.End)], ['Requested on', dateText(item.CreatedDate)], ['Reason', item.Reason],
    ...(item.Status === 1 ? [] : [['Decision remarks', item.AuthorizationRemarks], ['Decision date', dateText(item.AuthorizedDate)]]),
    ...(item.Status === 8 ? [['Recall remarks', item.RecallRemarks], ['Recalled on', dateText(item.RecalledDate)], ['Effective return date', dateText(item.EffectiveReturnDate)]] : [])];
  return <Card title={item?.Status === 1 ? 'Review leave request' : 'Leave decision'} action={<button onClick={() => navigate('/processing/leave-applications')} disabled={!!busy}>Back</button>}>
    {state.error?.status === 403 ? <ProcessingDenied /> : <LoadState state={state} />}
    {state.data && !item && <Feedback error={unexpectedProcessingReply} />}
    {item && <><dl className="details-grid">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl>{preview && <><h2>Balance preview</h2><PreviewSummary preview={preview} /></>}
      {api.source === 'supabase' && !own && <BalanceFixtureEditor key={item.Id} api={api} application={item} />}
      {item.Status === 1 && (own ? <p className="help" role="status">You can't approve or reject your own request. Another approver must decide it.</p>
        : <div className="request-form"><Feedback error={error} /><Field label="Remarks (optional)"><textarea maxLength={256} rows={3} value={remarks} onChange={e => { setError(null); setRemarks(e.target.value); }} disabled={!!busy} /></Field>
          <div className="row-actions"><button className="primary" onClick={() => decide('approve')} disabled={!!busy}>{busy === 'approve' ? 'Approving...' : 'Approve'}</button><button className="danger" onClick={() => decide('reject')} disabled={!!busy}>{busy === 'reject' ? 'Rejecting...' : 'Reject'}</button></div></div>)}
      {item.Status === 2 && !own && api.canRecallLeave && (!recalling
        ? <div className="row-actions"><button className="danger" onClick={openRecall}>Recall leave</button></div>
        : <form className="request-form" onSubmit={submitRecall}><div className="form-heading"><h2>Recall leave</h2><button type="button" onClick={() => setRecalling(false)} disabled={!!busy}>Cancel</button></div><Feedback error={error} />
          <div className="form-grid"><Field label="Effective return date"><input type="date" required min={leaveStart || undefined} max={leaveEnd || undefined} value={recall.effectiveReturnDate} onChange={e => { setError(null); setRecall(x => ({ ...x, effectiveReturnDate: e.target.value })); }} disabled={!!busy} /></Field></div>
          <Field label="Recall reason"><textarea required maxLength={256} rows={3} value={recall.remarks} onChange={e => { setError(null); setRecall(x => ({ ...x, remarks: e.target.value })); }} disabled={!!busy} /></Field>
          <button className="danger" disabled={!!busy}>{busy === 'recall' ? 'Recalling...' : 'Recall'}</button><p className="help">The employee returns to work on the effective return date, which must fall within the leave ({dateText(item.Start)} - {dateText(item.End)}). Unused days from that date are restored by the ERP, which also checks your permission and the dates.</p></form>)}</>}
  </Card>;
}
function LeaveForm({ api, types, application, onClose, onSaved }) {
  const [form, setForm] = useState({ leaveTypeId: application?.LeaveTypeId || '', start: application?.Start?.slice(0, 10) || '', end: application?.End?.slice(0, 10) || '', reason: application?.Reason || '' }); const [busy, setBusy] = useState(false); const [error, setError] = useState(null);
  const [handoverNotes, setHandoverNotes] = useState(''); const [handoverFile, setHandoverFile] = useState(null);
  const handoverFileInput = useRef(null);
  const isNewRequest = !application;
  const invalidDates = !!form.start && !!form.end && form.end <= form.start;
  const hasHandoverDraft = isNewRequest && (!!handoverNotes.trim() || !!handoverFile);
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
      {!application && <Field label="Leave type"><select required value={form.leaveTypeId} onChange={e => set('leaveTypeId', e.target.value)} disabled={busy}><option value="">Select leave type</option>{types.map(type => <option key={type.Id} value={type.Id}>{type.Description}</option>)}</select></Field>}
      <Field label="Start date"><input required type="date" value={form.start} onChange={e => set('start', e.target.value)} disabled={busy} /></Field>
      <Field label="End date"><input required type="date" min={form.start ? nextDate(form.start) : undefined} value={form.end} onChange={e => set('end', e.target.value)} disabled={busy} /></Field>
    </div>
    {isNewRequest && api.source === 'supabase' && <p className="help">Choose dates with configured preview and workflow fixtures. Development balances use explicit scenarios rather than live calculations.</p>}
    <Field label={application ? 'Reason for change' : 'Reason'}><textarea required maxLength={256} rows={3} value={form.reason} onChange={e => set('reason', e.target.value)} disabled={busy} /></Field>
    {isNewRequest && <>
      <h2>Work handover</h2>
      <p className="help" role="status">Handover details and documents are a local draft only and are not sent to HR. The colleague directory and document upload are not connected yet.</p>
      <Field label="Colleague receiving the handover"><select value="" disabled><option value="">Colleague directory unavailable</option></select></Field>
      <Field label="Handover notes"><textarea rows={3} value={handoverNotes} onChange={e => { setError(null); setHandoverNotes(e.target.value); }} disabled={busy} /></Field>
      <Field label="Supporting document"><input ref={handoverFileInput} type="file" onChange={e => { setError(null); setHandoverFile(e.target.files?.[0] || null); }} disabled={busy} />{handoverFile && <><small>{handoverFile.name} (not uploaded)</small><button type="button" onClick={() => { setError(null); setHandoverFile(null); if (handoverFileInput.current) handoverFileInput.current.value = ''; }} disabled={busy}>Clear selected file</button></>}</Field>
    </>}
    <LoadState state={preview} />
    {invalidDates && <Feedback error="End date must be after the start date." />}
    {preview.data?.PreviewAvailable === false && preview.data.CanSubmit && <p className="help" role="status">No preview fixture matches these dates. Ask an approver to configure a development scenario before submitting.</p>}
    {preview.data && !preview.data.CanSubmit && <Feedback error={preview.data.Error || 'The selected leave dates cannot be submitted.'} />}
    <button className="primary" disabled={busy || hasHandoverDraft || invalidDates || preview.loading || !preview.data?.CanSubmit}>{busy ? 'Saving...' : hasHandoverDraft ? 'Clear handover draft to submit' : application ? 'Save changes' : 'Submit request'}</button>
  </form>;
}
