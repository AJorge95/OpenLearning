import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const authContext = fs.readFileSync(new URL('../../src/auth-context.tsx', import.meta.url), 'utf8');

test('authentication startup loads setup, user, and CSRF state concurrently', () => {
  const refreshBody = authContext.match(/const refresh = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[\]\);/)?.[1];
  assert.ok(refreshBody, 'the auth refresh callback should remain identifiable');

  const parallelRequests = refreshBody.match(/await Promise\.all\(\[([\s\S]*?)\]\)/)?.[1];
  assert.ok(parallelRequests, 'startup requests should be awaited together');
  assert.match(parallelRequests, /getSetupStatus\(\)/);
  assert.match(parallelRequests, /getMe\(\)/);
  assert.match(parallelRequests, /api\.refreshCsrf\(\)/);
});
