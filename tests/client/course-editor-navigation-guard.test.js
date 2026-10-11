import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const appSource = fs.readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
const pageSource = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

test('the application uses a data router so route transitions can be blocked', () => {
  assert.match(appSource, /createBrowserRouter\(\[\{[\s\S]*?path: '\*'[\s\S]*?<AuthRoutes \/>/);
  assert.match(appSource, /<RouterProvider router=\{applicationRouter\} \/>/);
  assert.doesNotMatch(appSource, /<BrowserRouter>/);
});

test('course detail edits block in-app and browser navigation until saved or discarded', () => {
  assert.match(pageSource, /const shouldBlockCourseNavigation = useCallback<BlockerFunction>\(\(\{ currentLocation, nextLocation \}\) => \{[\s\S]*?locationChanged[\s\S]*?\(courseDetailsChanged \|\| saving\)/);
  assert.match(pageSource, /const navigationBlocker = useBlocker\(shouldBlockCourseNavigation\)/);
  assert.match(pageSource, /const preventUnsavedCourseExit = useCallback\(\(event: BeforeUnloadEvent\) => \{[\s\S]*?if \(!courseDetailsChanged && !saving\) return;[\s\S]*?event\.preventDefault\(\)/);
  assert.match(pageSource, /useBeforeUnload\(preventUnsavedCourseExit\)/);
  assert.match(pageSource, /navigationBlocker\.state === 'blocked' && !courseDetailsChanged && !saving\) navigationBlocker\.proceed\(\)/);
  assert.match(pageSource, /title=\{saving \? 'Course save in progress' : 'Discard unsaved course details\?'\}/);
  assert.match(pageSource, /cancelLabel=\{saving \? 'Stay on page' : 'Keep editing'\}/);
  assert.match(pageSource, /confirmLabel=\{saving \? 'Saving…' : 'Discard changes'\}/);
  assert.match(pageSource, /confirmDisabled=\{saving\}/);
});

test('successful course deletion can leave without a stale unsaved-details prompt', () => {
  const deleteHandler = pageSource.match(/async function deleteArchivedCourse[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(deleteHandler, /skipCourseNavigationPromptRef\.current = true;\s*navigate\('\/manage\/courses'\)/);
});
