import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-backups.tsx', import.meta.url), 'utf8');
const compactSource = source.replace(/\s+/g, ' ');

test('backup dashboard ignores manual refreshes after the page unmounts', () => {
  assert.match(compactSource, /const dashboardMountedRef = useRef\(false\);/);
  assert.match(compactSource, /let active = true;[\s\S]*?dashboardMountedRef\.current = true;/);
  assert.match(compactSource, /active = false; dashboardMountedRef\.current = false;[\s\S]*?dashboardRevisionRef\.current \+= 1;/);
  assert.match(compactSource, /if \(!dashboardMountedRef\.current \|\| requestRevision !== dashboardRevisionRef\.current\) return; setDashboard\(result\);/);
  assert.match(compactSource, /if \(!dashboardMountedRef\.current \|\| requestRevision !== dashboardRevisionRef\.current\) return; setError\(cause instanceof ApiError/);
});
