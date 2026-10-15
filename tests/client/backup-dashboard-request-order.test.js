import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-backups.tsx', import.meta.url), 'utf8');

test('backup dashboard ignores stale polling and refresh responses', () => {
  assert.match(source, /const dashboardRevisionRef = useRef\(0\);/);
  assert.match(source, /if \(active && requestRevision === dashboardRevisionRef\.current\) \{ setDashboard\(result\);/);
  assert.match(source, /if \(active && requestRevision === dashboardRevisionRef\.current && !\(cause instanceof Error && cause\.name === 'AbortError'\)\)/);
  assert.match(source, /if \(requestRevision !== dashboardRevisionRef\.current\) return;\n      setDashboard\(result\);/);
  assert.match(source, /if \(requestRevision !== dashboardRevisionRef\.current\) return;\n      setError\(cause instanceof ApiError/);
});
