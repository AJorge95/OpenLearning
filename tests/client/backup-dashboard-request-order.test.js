import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-backups.tsx', import.meta.url), 'utf8');

test('backup dashboard ignores stale polling and refresh responses', () => {
  // Keep this source contract independent of harmless JSX line wrapping.
  const compactSource = source.replace(/\s+/g, ' ');
  assert.match(compactSource, /const dashboardRevisionRef = useRef\(0\);/);
  assert.match(compactSource, /if \(active && requestRevision === dashboardRevisionRef\.current\) \{ setDashboard\(result\); setRestorableRuns\(restorePoints\.runs\); setError\(''\); setLoading\(false\); \}/);
  assert.match(compactSource, /if \(active && requestRevision === dashboardRevisionRef\.current && !\(cause instanceof Error && cause\.name === 'AbortError'\)\)/);
  assert.match(compactSource, /if \(requestRevision !== dashboardRevisionRef\.current\) return; setDashboard\(result\); setRestorableRuns\(restorePoints\.runs\); setError\(''\);/);
  assert.match(compactSource, /if \(requestRevision !== dashboardRevisionRef\.current\) return; setError\(cause instanceof ApiError/);
});
