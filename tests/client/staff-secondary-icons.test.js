import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

test('staff navigation and management links hide decorative back arrows', () => {
  for (const label of ['Back to courses', 'Back to course', 'Back to users']) {
    assert.match(source, new RegExp(`<ArrowLeft size=\\{(?:16|17)\\} aria-hidden="true" \\/>${label}`), `${label} should hide its back arrow`);
  }
});

test('staff actions and informational cues hide redundant glyphs', () => {
  for (const pattern of [
    /<BookOpen size=\{22\} aria-hidden="true" \/>/,
    /<Upload size=\{16\} aria-hidden="true" \/>/,
    /<Plus size=\{16\} aria-hidden="true" \/>Add first module/,
    /<Trash2 size=\{16\} aria-hidden="true" \/>\{deletingCourse/,
    /<LockKeyhole size=\{15\} aria-hidden="true" \/>Assigned learners/,
    /<Plus size=\{17\} aria-hidden="true" \/>Create account/,
    /<Trash2 size=\{15\} aria-hidden="true" \/>Remove/,
  ]) assert.match(source, pattern);
});
