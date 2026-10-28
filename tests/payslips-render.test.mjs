import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

test('payslip screens render payroll data, paging and honest unavailable/error states in the Operational shell', async () => {
  const server = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, mode: 'development' });
  try {
    const { PayslipListView, PayslipDetailView, Payslips, PayslipDetail } = await server.ssrLoadModule('/src/components/Payslips.jsx');
    const render = (View, props) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(View, props)));
    const ready = data => ({ data, error: null, loading: false, retry() {} });
    const slip = { Id: 'test-slip', SalaryPeriodPostingPeriodDescription: 'Test payroll year', SalaryPeriodMonthDescription: 'October', StatusDescription: 'Posted', NetPay: 1234.5, CreatedDate: '2026-10-01' };
    const list = render(PayslipListView, { state: ready({ PageCollection: [slip], TotalPages: 3 }), page: 1, onPageChange() {} });
    assert.match(list, /page-card/); assert.match(list, /card-header/); assert.match(list, /list-wrapper/);
    assert.match(list, /October/); assert.match(list, /Test payroll year/); assert.match(list, /1,234\.50/);
    assert.match(list, /Page 2 of 3/); assert.match(list, /\/payslips\/test-slip\?page=2/);
    const empty = render(PayslipListView, { state: ready({ PageCollection: [], TotalPages: 0 }), page: 0 });
    assert.match(empty, /No posted payslips are available/); assert.match(empty, /Page 1 of 1/);
    const detail = render(PayslipDetailView, { state: ready({ payslip: slip, entries: [{ Id: 'test-entry', PaySlipId: slip.Id, Description: '<Test earning>', SalaryHeadTypeDescription: 'Earning', SalaryHeadCategoryDescription: 'Basic', Principal: 1500, Interest: 0 }] }), backTo: '/payslips?page=2' });
    assert.match(detail, /Payroll entries/); assert.match(detail, /&lt;Test earning&gt;/); assert.match(detail, /1,500\.00/);
    assert.match(detail, /href="\/payslips\?page=2"/);
    assert.match(render(PayslipDetailView, { state: ready({ payslip: slip, entries: [] }), backTo: '/payslips' }), /No payroll entries are available/);
    for (const [status, text] of [[403, /Your account cannot access payslips/], [404, /This payslip is unavailable/]]) {
      assert.match(render(PayslipDetailView, { state: { data: null, error: { status }, loading: false, retry() {} }, backTo: '/payslips' }), text);
    }
    const routeError = { loading: false, data: null, error: { status: 404, code: 'API_ROUTE_UNAVAILABLE' }, retry() {} };
    for (const View of [PayslipListView, PayslipDetailView]) {
      const missingRoute = render(View, { state: routeError, page: 0, backTo: '/payslips' });
      assert.match(missingRoute, /check the payroll API deployment/);
      assert.doesNotMatch(missingRoute, /This payslip is unavailable/);
    }
    assert.match(render(PayslipListView, { state: { loading: true, data: null, retry() {} }, page: 0 }), /Loading payslips/);
    assert.match(render(Payslips, { api: { canViewPayslips: false } }), /available through the ERP only/);
    assert.match(render(PayslipDetail, { api: { canViewPayslips: false } }), /available through the ERP only/);
  } finally { await server.close(); }
});
