import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');

test('editing a learning-path draft clears feedback from the previous action', () => {
  assert.match(source, /const updatePathEditorDirty = useCallback\(\(hasChanges: boolean\) => \{\s*pathEditorDirtyRef\.current = hasChanges;\s*if \(hasChanges\) \{\s*\/\/ Page-level feedback describes the last action, not the path now being edited\.\s*setError\(''\);\s*setNotice\(''\);\s*\}\s*\}, \[\]\);/);
  assert.match(source, /useEffect\(\(\) => onDirtyChange\(hasUnsavedChanges\), \[hasUnsavedChanges, onDirtyChange\]\)/);
});
