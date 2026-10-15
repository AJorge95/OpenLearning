import assert from 'node:assert/strict';
import fs from 'node:fs';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { appVersion } from '../../server/app-version.js';
import { versionRouter } from '../../server/routes-version.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('app version is displayed in x.y form from package metadata', () => {
  const packageVersion = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version;
  assert.equal(appVersion, packageVersion.split('.').slice(0, 2).join('.'));
});

test('public version endpoint returns the current app version without authentication', async (t) => {
  const app = express();
  app.use('/api', versionRouter);
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    if (!server.listening) return;
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/version`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { version: appVersion });
});
