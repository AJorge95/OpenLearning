import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');
const editorSource = source.slice(source.indexOf('function PathEditor'), source.indexOf('export function LearningPathsPage'));
const pageSource = source.slice(source.indexOf('export function LearningPathsPage'), source.indexOf('export function CalendarPage'));

test('editing a learning path moves focus into its name field without stealing focus on initial load', () => {
  assert.match(editorSource, /const pathTitleInputRef = useRef<HTMLInputElement>\(null\);/);
  assert.match(editorSource, /useEffect\(\(\) => \{\s*if \(!existing\) return;[\s\S]*?pathTitleInputRef\.current\?\.focus\(\);[\s\S]*?\}, \[existing\]\);/);
  assert.match(editorSource, /<label>Path name<input ref=\{pathTitleInputRef\}/);
});

test('cancelling a path edit returns focus to its initiating row or the path filters', () => {
  assert.match(pageSource, /pathEditorReturnFocusRef\.current = event\.currentTarget; setEditing\(path\);/);
  assert.match(pageSource, /function cancelPathEdit\(\) \{[\s\S]*?if \(trigger\?\.isConnected\) trigger\.focus\(\);\s*else pathStatusFilterButtonsRef\.current\.all\?\.focus\(\);/);
  assert.match(pageSource, /onCancel=\{cancelPathEdit\}/);
});

test('saving a path restores focus after refreshing the list and falls back when its row moved', () => {
  assert.match(pageSource, /function restorePathEditorFocus\(\) \{[\s\S]*?window\.requestAnimationFrame\(\(\) => \{\s*if \(trigger\.isConnected\) trigger\.focus\(\);\s*else pathStatusFilterButtonsRef\.current\.all\?\.focus\(\);/);
  assert.match(pageSource, /await load\(1, 'all'\);\s*restorePathEditorFocus\(\);/);
});
