import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');

test('learning-path availability choices stay stable while the editor changes', () => {
  assert.match(source, /const PATH_AVAILABILITY_OPTIONS: AppSelectOption<'draft' \| 'published'>\[\] = \[/);
  assert.match(source, /ariaLabel="Path availability" value=\{status\} onChange=\{setStatus\} options=\{PATH_AVAILABILITY_OPTIONS\}/);
});
