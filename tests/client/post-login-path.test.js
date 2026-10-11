import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPostLoginPath } from '../../src/post-login-path.ts';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

test('post-login navigation preserves an internal route, query, and hash', () => {
  assert.equal(getPostLoginPath('/admin/users/user-1?tab=details#platform-role'), '/admin/users/user-1?tab=details#platform-role');
});

test('post-login navigation falls back for missing or external destinations', () => {
  for (const value of [undefined, null, {}, 'https://example.test/admin', '//example.test/admin', '/\\example.test/admin', '']) {
    assert.equal(getPostLoginPath(value), '/courses');
  }
});

test('post-login navigation avoids returning to authentication routes', () => {
  for (const value of ['/login', '/login?next=/admin', '/register', '/setup']) {
    assert.equal(getPostLoginPath(value), '/courses');
  }
});

test('protected route redirects retain the location and login consumes it', () => {
  const appSource = fs.readFileSync(path.join(sourceDirectory, 'App.tsx'), 'utf8');
  const authSource = fs.readFileSync(path.join(sourceDirectory, 'pages-auth.tsx'), 'utf8');

  assert.match(appSource, /const from = `\$\{location\.pathname\}\$\{location\.search\}\$\{location\.hash\}`;/);
  assert.match(appSource, /<Navigate to="\/login" replace state=\{\{ from \}\} \/>/);
  assert.match(authSource, /getPostLoginPath\(location\.state\?\.from\)/);
  assert.match(authSource, /navigate\(postLoginPath, \{ replace: true \}\)/);
});
