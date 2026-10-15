import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('admin settings loads and displays the public app version', () => {
  const apiSource = fs.readFileSync(path.join(projectRoot, 'src/api.ts'), 'utf8');
  const manageSource = fs.readFileSync(path.join(projectRoot, 'src/pages-manage.tsx'), 'utf8');
  assert.match(apiSource, /fetchAppVersion[\s\S]*?api\.get<\{ version: string \}>\('\/api\/version'/);
  const settingsPage = manageSource.slice(manageSource.indexOf('export function AdminSettingsPage()'), manageSource.indexOf('function AdminSettingsTabs()'));
  assert.match(settingsPage, /Application version/);
  assert.match(settingsPage, /fetchAppVersion\(\{ signal: controller\.signal \}\)/);
  assert.match(settingsPage, /Current version/);
});
