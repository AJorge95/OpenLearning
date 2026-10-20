import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const pageSource = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('course-group descriptions preserve line breaks in the rendered group cards', () => {
  assert.match(pageSource, /<p>\{group\.description \|\| 'No description added\.'\}<\/p>/);
  assert.match(styles, /\.course-groups-list \.program-card p\s*\{[^}]*white-space:\s*pre-wrap;/);
});
