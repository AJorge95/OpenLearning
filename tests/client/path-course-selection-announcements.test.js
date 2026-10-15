import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('learning-path course selection count announces ordinary changes as well as the limit', () => {
  const source = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');

  assert.match(source, /className=\{`path-course-selection-count\$\{selectionOverLimit \? ' over-limit' : selectionAtLimit \? ' at-limit' : ''\}`\} role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(source, /\$\{selected\.length\} of \$\{MAX_LEARNING_PATH_COURSES\} courses selected\./);
});
