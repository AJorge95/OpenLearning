import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = fs.readFileSync(path.resolve(import.meta.dirname, '../../src/pages-manage.tsx'), 'utf8');
const curriculum = source.match(/<section className="editor-section curriculum-editor-section">([\s\S]*?)\n    <\/section>/);
assert.ok(curriculum, 'Expected to find the course curriculum editor.');

test('course curriculum controls hide decorative glyphs', () => {
  const curriculumSource = curriculum[1];
  for (const icon of ['Plus', 'ChevronDown', 'BookOpen', 'ArrowUp', 'ArrowDown', 'Trash2', 'FileText', 'Check', 'Upload', 'Pencil', 'CircleHelp']) {
    assert.match(curriculumSource, new RegExp(`<${icon}[^>]*aria-hidden="true"`), `${icon} should be decorative`);
  }
});
