import { createServer } from 'vite';
import { readdir } from 'node:fs/promises';

const server = await createServer({ server: { middlewareMode: true }, mode: 'development', optimizeDeps: { noDiscovery: true, include: [] } });
try {
  async function check(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await check(path);
      else if (/\.(jsx?|css)$/.test(path)) {
        await server.transformRequest(`/${path}`);
        console.log(`Checked ${path}`);
      }
    }
  }
  await check('src');
  console.log('Development transforms passed.');
} finally { await server.close(); }
