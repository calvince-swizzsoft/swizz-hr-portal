import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Card, Feedback, LoadState, useLoad, useRefreshOnFocus } from './PortalUi.jsx';

const amount = value => value == null || value === '' || !Number.isFinite(Number(value))
  ? '—' : Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = value => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString() : '—';
const pageIndex = params => {
  const page = Number(params.get('page') || 1);
  return Number.isInteger(page) && page >= 1 && page <= 100001 ? page - 1 : 0;
};
const period = item => item.SalaryPeriodPostingPeriodDescription || '—';
const unavailable = 'Payslips are available through the ERP only. They are not available in development mode.';

function LoadingPayslips({ entries = false }) {
  return <div className="list-wrapper" role="status" aria-label={entries ? 'Loading payslip entries' : 'Loading payslips'}>
    {[0, 1, 2].map(row => <div key={row} className={`list-row payslip-skeleton ${entries ? 'payslip-entry-grid' : 'payslip-grid'}`} aria-hidden="true">
      {[0, 1, 2, 3].map(column => <span className="payslip-skeleton-bar" key={column} />)}
    </div>)}
  </div>;
}
function PayslipLoadState({ state, entries = false }) {
  if (state.loading) return <LoadingPayslips entries={entries} />;
  if (state.error?.status === 403) return <><Feedback error={{ message: 'Your account cannot access payslips. Contact HR to check your employee access.', correlationId: state.error.correlationId }} /><button onClick={state.retry}>Try again</button></>;
  if (state.error?.code === 'API_ROUTE_UNAVAILABLE' || state.error?.status === 404 && !entries)
    return <><Feedback error={{ message: 'Payslips are not available from the configured ERP service. Contact support to check the payroll API deployment.', correlationId: state.error.correlationId }} /><button onClick={state.retry}>Try again</button></>;
  if (state.error?.status === 404) return <><Feedback error={{ message: 'This payslip is unavailable. Return to My payslips or contact HR.', correlationId: state.error.correlationId }} /><button onClick={state.retry}>Try again</button></>;
  return <LoadState state={state} />;
}

export function PayslipListView({ state, page, onPageChange }) {
  const data = state.data;
  return <Card title="My payslips" action={<button onClick={state.retry} disabled={state.loading}>Refresh</button>}>
    <p className="muted section-intro">View your posted payslips and payroll entries.</p>
    <PayslipLoadState state={state} />
    {data && <><div className="list-wrapper">
      <div className="list-header payslip-grid"><span>Payroll period</span><span>Net pay</span><span>Status</span><span>Details</span></div>
      {data.PageCollection.length ? data.PageCollection.map(item => <div className="list-row payslip-grid" key={item.Id}>
        <div><strong>{item.SalaryPeriodMonthDescription || '—'}</strong><small>{period(item)}</small></div>
        <span><small className="payslip-cell-label">Net pay</small>{amount(item.NetPay)}</span>
        <span><span className="badge payslip-posted">{item.StatusDescription || 'Posted'}</span></span>
        <div className="row-actions"><Link className="button-link" to={`/payslips/${encodeURIComponent(item.Id)}?page=${page + 1}`} aria-label={`View ${item.SalaryPeriodMonthDescription || ''} ${period(item)} payslip`}>View</Link></div>
      </div>) : <div className="empty">No posted payslips are available.</div>}
    </div><div className="pagination">
      <button disabled={state.loading || page === 0} onClick={() => onPageChange(page - 1)}>Prev</button>
      <span>Page {page + 1} of {Math.max(1, data.TotalPages)}</span>
      <button disabled={state.loading || page + 1 >= data.TotalPages} onClick={() => onPageChange(page + 1)}>Next</button>
    </div></>}
  </Card>;
}

export function Payslips({ api }) {
  const [params, setParams] = useSearchParams();
  const page = pageIndex(params);
  const state = useLoad(async signal => {
    if (!api.canViewPayslips) return null;
    const data = await api.payslips(page, { signal });
    if (!Array.isArray(data?.PageCollection) || data.PageCollection.some(item => !item?.Id) || !Number.isInteger(data.TotalPages) || data.TotalPages < 0)
      throw new Error('The payroll service returned an invalid payslip list. Refresh or contact HR.');
    return data;
  }, [api, page]);
  useRefreshOnFocus(state.retry);
  if (!api.canViewPayslips) return <Card title="My payslips"><div className="empty">{unavailable}</div></Card>;
  return <PayslipListView state={state} page={page} onPageChange={next => setParams(next ? { page: String(next + 1) } : {})} />;
}

export function PayslipDetailView({ state, backTo }) {
  const item = state.data?.payslip;
  const entries = state.data?.entries;
  return <Card title="Payslip" action={<div className="row-actions"><button onClick={state.retry} disabled={state.loading}>Refresh</button><Link className="button-link" to={backTo}>Back to my payslips</Link></div>}>
    <PayslipLoadState state={state} entries />
    {item && <>
      <dl className="details-grid">{[
        ['Payroll period', period(item)], ['Month', item.SalaryPeriodMonthDescription],
        ['Status', item.StatusDescription || 'Posted'], ['Net pay', amount(item.NetPay)], ['Created', date(item.CreatedDate)],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? '—'}</dd></div>)}</dl>
      <h2>Payroll entries</h2><div className="list-wrapper">
        <div className="list-header payslip-entry-grid"><span>Description</span><span>Type / category</span><span>Principal</span><span>Interest</span></div>
        {entries.length ? entries.map(entry => <div className="list-row payslip-entry-grid" key={entry.Id}>
          <strong>{entry.Description || '—'}</strong>
          <div><span>{entry.SalaryHeadTypeDescription || '—'}</span><small>{entry.SalaryHeadCategoryDescription || '—'}</small></div>
          <span><small className="payslip-cell-label">Principal</small>{amount(entry.Principal)}</span>
          <span><small className="payslip-cell-label">Interest</small>{amount(entry.Interest)}</span>
        </div>) : <div className="empty">No payroll entries are available for this payslip.</div>}
      </div>
    </>}
  </Card>;
}

export function PayslipDetail({ api }) {
  const { id } = useParams();
  const [params] = useSearchParams();
  const page = pageIndex(params);
  const backTo = page ? `/payslips?page=${page + 1}` : '/payslips';
  const state = useLoad(async signal => {
    if (!api.canViewPayslips) return null;
    const payslip = await api.payslip(id, { signal });
    if (!payslip?.Id || String(payslip.Id).toLowerCase() !== String(id).toLowerCase())
      throw new Error('The payroll service returned unexpected payslip details. Refresh or contact HR.');
    const entries = await api.payslipEntries(id, { signal });
    if (!Array.isArray(entries) || entries.some(entry => !entry?.Id || String(entry.PaySlipId).toLowerCase() !== String(payslip.Id).toLowerCase()))
      throw new Error('The payroll service returned invalid payslip entries. Refresh or contact HR.');
    return { payslip, entries };
  }, [api, id]);
  useRefreshOnFocus(state.retry);
  if (!api.canViewPayslips) return <Card title="Payslip"><div className="empty">{unavailable}</div></Card>;
  return <PayslipDetailView state={state} backTo={backTo} />;
}
