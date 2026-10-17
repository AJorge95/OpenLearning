import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const authContext = fs.readFileSync(new URL('../../src/auth-context.tsx', import.meta.url), 'utf8');

test('authentication startup loads setup, user, and CSRF state concurrently', () => {
  const refreshBody = authContext.match(/const refresh = useCallback\(async \(options: Pick<RequestInit, 'signal'> = \{\}\) => \{([\s\S]*?)\n  \}, \[\]\);/)?.[1];
  assert.ok(refreshBody, 'the auth refresh callback should remain identifiable');

  const parallelRequests = refreshBody.match(/await Promise\.all\(\[([\s\S]*?)\]\)/)?.[1];
  assert.ok(parallelRequests, 'startup requests should be awaited together');
  assert.match(parallelRequests, /getSetupStatus\(options\)/);
  assert.match(parallelRequests, /getMe\(options\)/);
  assert.match(parallelRequests, /api\.refreshCsrf\(options\)/);
});

test('authentication startup times out, aborts the bootstrap reads, and exposes retry guidance', () => {
  const retryBody = authContext.match(/const retryStartup = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[refresh\]\);/)?.[1];
  assert.ok(retryBody, 'the startup retry callback should remain identifiable');

  assert.match(authContext, /const STARTUP_REQUEST_TIMEOUT_MS = 20_000;/);
  assert.match(retryBody, /startupController\.current\?\.abort\(\)/);
  assert.match(retryBody, /window\.setTimeout\([\s\S]*?controller\.abort\(\)[\s\S]*?STARTUP_REQUEST_TIMEOUT_MS\)/);
  assert.match(retryBody, /refresh\(\{ signal: controller\.signal \}\)/);
  assert.match(retryBody, /request_timeout/);
  assert.match(retryBody, /window\.clearTimeout\(timeoutId\)/);
  assert.match(authContext, /startupRequestId\.current \+= 1;\s+startupController\.current\?\.abort\(\);/);
});
