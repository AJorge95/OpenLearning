import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-backups.tsx', import.meta.url), 'utf8');

test('backup empty states wait for a successful dashboard response', () => {
  assert.match(source, /const dashboardLoaded = dashboard !== null;/);
  assert.match(source, /dashboardLoaded && !editor && <div className="backup-empty-state"><strong>No backup jobs configured<\/strong>/);
  assert.match(source, /dashboardLoaded && <div className="backup-empty-state">No backup runs yet\./);
});
