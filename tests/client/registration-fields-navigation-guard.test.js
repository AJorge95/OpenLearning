import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const page = source.slice(source.indexOf('export function AdminRegistrationFieldsPage()'), source.indexOf('\ntype AuditLogEntry'));

test('registration field edits block in-app and browser navigation until saved or discarded', () => {
  assert.match(page, /const \[savedFields, setSavedFields\] = useState<RegistrationField\[\] \| null>\(null\)/);
  assert.match(page, /hasUnsavedRegistrationFieldChanges\(fields, savedFields\)/);
  assert.equal((page.match(/setSavedFields\(result\.fields\)/g) || []).length, 2, 'load and successful save must both establish the saved baseline');
  assert.match(page, /return locationChanged && \(hasUnsavedChanges \|\| saving\)/);
  assert.match(page, /const navigationBlocker = useBlocker\(shouldBlockNavigation\)/);
  assert.match(page, /if \(!hasUnsavedChanges && !saving\) return;[\s\S]*?event\.preventDefault\(\)/);
  assert.match(page, /useBeforeUnload\(preventUnsavedRegistrationFieldExit\)/);
  assert.match(page, /navigationBlocker\.state === 'blocked' && !hasUnsavedChanges && !saving\) navigationBlocker\.proceed\(\)/);
});

test('registration field navigation offers clear save and discard actions', () => {
  assert.match(page, /title=\{saving \? 'Registration save in progress' : 'Discard unsaved registration fields\?'\}/);
  assert.match(page, /cancelLabel=\{saving \? 'Stay on page' : 'Keep editing'\}/);
  assert.match(page, /confirmLabel=\{saving \? 'Saving…' : 'Discard changes'\}/);
  assert.match(page, /confirmDisabled=\{saving\}/);
  assert.match(page, /onCancel=\{\(\) => navigationBlocker\.reset\(\)\}/);
  assert.match(page, /onConfirm=\{\(\) => navigationBlocker\.proceed\(\)\}/);
});
