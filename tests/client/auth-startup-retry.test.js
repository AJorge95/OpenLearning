import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const authContext = fs.readFileSync(new URL('../../src/auth-context.tsx', import.meta.url), 'utf8');

test('authentication startup retries only bounded transient failures', () => {
  const retryBody = authContext.match(/const retryStartup = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[refresh\]\);/)?.[1];
  assert.ok(retryBody, 'the auth startup callback should remain identifiable');

  assert.match(authContext, /const STARTUP_RETRY_DELAYS_MS = \[250, 750\] as const;/);
  assert.match(authContext, /function isTransientStartupError\(cause: unknown\) \{[\s\S]*?cause\.status === 0 \|\| cause\.status >= 500/);
  assert.match(retryBody, /while \(true\)/);
  assert.match(retryBody, /isTransientStartupError\(cause\)/);
  assert.match(retryBody, /retryAttempt >= STARTUP_RETRY_DELAYS_MS\.length/);
  assert.match(retryBody, /window\.setTimeout\(resolve, STARTUP_RETRY_DELAYS_MS\[retryAttempt\]\)/);
});
