import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { createSecurityHeaders } from '../../server/security-headers.js';
import { mountWebClient } from '../../server/web-client.js';
import { checkWebClient } from '../../scripts/check-web-client.js';

const checkWebClientScript = fileURLToPath(new URL('../../scripts/check-web-client.js', import.meta.url));
const projectRoot = path.dirname(path.dirname(checkWebClientScript));

async function fixture(t, { development = false, legacyHeaders = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearning-web-client-'));
  fs.mkdirSync(path.join(directory, 'assets'));
  fs.writeFileSync(path.join(directory, 'index.html'), '<div id="root"></div><script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">');
  fs.writeFileSync(path.join(directory, 'assets/app.js'), 'document.getElementById("root").textContent = "OpenLearning";');
  fs.writeFileSync(path.join(directory, 'assets/app.css'), 'body { color: black; }');
  fs.writeFileSync(path.join(directory, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  if (development) {
    // This fixture has no dependencies to prebundle. Keep Vite's cache and
    // optimization lifecycle independent of the real project and other tests.
    fs.writeFileSync(path.join(directory, 'vite.config.mjs'), `export default ${JSON.stringify({
      cacheDir: path.join(directory, '.vite'),
      optimizeDeps: { noDiscovery: true, include: [] },
    })};`);
    fs.mkdirSync(path.join(directory, 'src'));
    fs.writeFileSync(path.join(directory, 'src/main.js'), 'document.getElementById("root").textContent = "Development";');
    fs.writeFileSync(path.join(directory, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.js"></script>');
  }
  const app = express();
  const server = createServer(app);
  const client = await (async () => {
    app.use(legacyHeaders ? helmet() : createSecurityHeaders(development ? 'development' : 'production'));
    app.get('/api/version', (_req, res) => res.json({ version: 'test' }));
    app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));
    return mountWebClient(app, server, { nodeEnv: development ? 'development' : 'production', clientDir: directory, projectDir: directory });
  })();
  t.after(async () => {
    await client?.close();
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { directory, base: `http://127.0.0.1:${server.address().port}` };
}

test('production HTTP serves the page, assets, API and client routes on the same port', async (t) => {
  const { base } = await fixture(t);
  const page = await fetch(base);
  assert.equal(page.status, 200);
  const policy = page.headers.get('content-security-policy');
  assert.doesNotMatch(policy, /upgrade-insecure-requests/);
  assert.match(policy, /script-src 'self'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('cache-control'), 'no-cache');
  assert.equal(await checkWebClient(base), 2);
  assert.match(await (await fetch(`${base}/login`)).text(), /id="root"/);
  assert.equal((await fetch(`${base}/favicon.svg`)).headers.get('content-type'), 'image/svg+xml');
  assert.deepEqual(await (await fetch(`${base}/api/version`)).json(), { version: 'test' });
  const missing = await fetch(`${base}/assets/missing.js`);
  assert.equal(missing.status, 404);
  assert.doesNotMatch(await missing.text(), /id="root"/);
});

test('installer web checks reject the former HTTP-to-HTTPS policy and missing chunks', async (t) => {
  const legacy = await fixture(t, { legacyHeaders: true });
  await assert.rejects(checkWebClient(legacy.base), /forces assets onto HTTPS/);
  const current = await fixture(t);
  fs.unlinkSync(path.join(current.directory, 'assets/app.js'));
  await assert.rejects(checkWebClient(current.base), /app.js returned HTTP 404/);
});

test('installer web checks follow lazy JavaScript and nested stylesheet assets', async (t) => {
  const current = await fixture(t);
  fs.writeFileSync(path.join(current.directory, 'assets/app.js'), 'import("./pages.js");');
  fs.writeFileSync(path.join(current.directory, 'assets/pages.js'), 'import "./shared.js";');
  fs.writeFileSync(path.join(current.directory, 'assets/shared.js'), 'export const page = true;');
  fs.writeFileSync(path.join(current.directory, 'assets/app.css'), '@import "./theme.css";');
  fs.writeFileSync(path.join(current.directory, 'assets/theme.css'), 'body { background: url(./tokens.css); }');
  fs.writeFileSync(path.join(current.directory, 'assets/tokens.css'), ':root { --surface: white; }');

  assert.equal(await checkWebClient(current.base), 6);

  fs.unlinkSync(path.join(current.directory, 'assets/shared.js'));
  await assert.rejects(checkWebClient(current.base), /shared\.js returned HTTP 404/);
});

test('web-client checker explains its required base URL', async () => {
  const child = spawn(process.execPath, [checkWebClientScript], {
    cwd: projectRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(child, 'close');

  assert.equal(code, 2);
  assert.equal(stderr.trim(), '[openlearning] Usage: node scripts/check-web-client.js <base-url>');
});

test('production startup rejects a missing built client', async () => {
  const app = express();
  await assert.rejects(mountWebClient(app, createServer(app), {
    nodeEnv: 'production', clientDir: path.join(os.tmpdir(), `openlearning-missing-client-${process.pid}`),
  }), /Built web client is missing/);
});

test('development serves live source and the API through the same HTTP listener', async (t) => {
  const { base } = await fixture(t, { development: true });
  const page = await (await fetch(base)).text();
  assert.match(page, /\/src\/main.js/);
  assert.match(page, /\/@vite\/client/);
  const source = await fetch(`${base}/src/main.js`);
  assert.equal(source.status, 200);
  assert.match(source.headers.get('content-type'), /javascript/);
  assert.deepEqual(await (await fetch(`${base}/api/version`)).json(), { version: 'test' });
  assert.equal((await fetch(`${base}/api/missing`)).status, 404);
});
