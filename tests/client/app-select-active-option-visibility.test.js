import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const componentSource = fs.readFileSync(new URL('../../src/components.tsx', import.meta.url), 'utf8');

test('AppSelect keeps its active option visible when opening and navigating the listbox', () => {
  assert.match(componentSource, /useEffect\(\(\) => \{\s*if \(!menuOpen\) return;\s*\/\/ Keep the active descendant visible when opening or moving through a scrollable listbox\.\s*menuRef\.current\?\.querySelector<HTMLElement>\(`#\$\{menuId\}-option-\$\{activeOptionIndex\}`\)\?\.scrollIntoView\(\{ block: 'nearest' \}\);\s*\}, \[activeOptionIndex, menuId, menuOpen\]\);/);
  assert.doesNotMatch(componentSource, /menuRef\.current\?\.querySelector<HTMLElement>\(`#\$\{menuId\}-option-\$\{nextIndex\}`\)/);
});
