import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

test('Settings renders the ERP password form without depending on a username', async () => {
  const server = await createServer({
    configFile: false,
    plugins: [react()],
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    mode: 'development',
  });
  try {
    const { Settings } = await server.ssrLoadModule('/src/App.jsx');
    const markup = renderToStaticMarkup(React.createElement(MemoryRouter, null,
      React.createElement(Settings, {
        api: { source: 'erp' },
        profile: { Id: 'local-test', CustomerFullName: 'Local test' },
        preferences: { language: 'en', displayName: '', textSize: 'medium', highContrast: false, reduceMotion: false },
        isApprover: false,
      })));
    assert.match(markup, /Change password/);
    assert.match(markup, /Current password/);
    assert.match(markup, /Account preferences/);
    assert.match(markup, /My account information/);
    assert.doesNotMatch(markup, /Your sign-in name is unavailable/);
  } finally {
    await server.close();
  }
});
