import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { courseRowActionStatus } from '../../src/course-row-action-status.ts';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx');
const stylesPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/styles.css');

test('course row actions have concise progress messages', () => {
  assert.deepEqual(
    ['publish', 'unpublish', 'archive', 'delete'].map(courseRowActionStatus),
    ['Publishing…', 'Unpublishing…', 'Archiving…', 'Deleting…'],
  );
});

test('course status cells announce pending actions after the action menu closes', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const styles = fs.readFileSync(stylesPath, 'utf8');

  assert.match(source, /busyAction && <span className="course-list-action-status" role="status" aria-live="polite" aria-atomic="true">\{courseRowActionStatus\(busyAction\)\}<\/span>/);
  assert.match(styles, /\.course-list-action-status\s*\{[^}]*color:\s*var\(--muted\);[^}]*font-size:\s*11px;/);
});
