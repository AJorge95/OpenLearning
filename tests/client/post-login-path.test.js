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

test('new account registration retains the requested route through sign-up', () => {
  const authSource = fs.readFileSync(path.join(sourceDirectory, 'pages-auth.tsx'), 'utf8');

  assert.match(authSource, /<Link to="\/register" state=\{\{ from: postLoginPath \}\}>Create an account<\/Link>/);
  assert.match(authSource, /export function RegisterPage\(\) \{[\s\S]{0,360}getPostLoginPath\(location\.state\?\.from\)/);
  assert.match(authSource, /await signUp\([\s\S]*?navigate\(postLoginPath, \{ replace: true \}\)/);
});

test('login copy explains when sign-in will return to a requested page', () => {
  const authSource = fs.readFileSync(path.join(sourceDirectory, 'pages-auth.tsx'), 'utf8');

  assert.match(authSource, /const hasRequestedDestination = postLoginPath !== '\/courses';/);
  assert.match(authSource, /hasRequestedDestination \? 'Sign in to return to the page you requested\.' : 'Sign in to continue learning\.'/);
});

test('login guidance is associated with the autofocus username field', () => {
  const authSource = fs.readFileSync(path.join(sourceDirectory, 'pages-auth.tsx'), 'utf8');

  assert.match(authSource, /<p id="login-description" className="auth-description">/);
  assert.match(authSource, /<input aria-describedby="login-description" required maxLength=\{32\} autoComplete="username" autoFocus/);
});
