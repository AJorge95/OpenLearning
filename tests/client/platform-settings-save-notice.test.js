import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const settingsPage = source.slice(
  source.indexOf('export function AdminSettingsPage()'),
  source.indexOf('export function AdminRegistrationFieldsPage()'),
);

test('editing platform settings clears the previous save confirmation', () => {
  assert.match(settingsPage, /function clearSettingsSuccess\(\)\s*\{\s*\/\/ A saved confirmation describes these values only until the next setting changes\.\s*setSuccess\(''\);\s*\}/);
  assert.match(settingsPage, /setName\(event\.target\.value\); setPlatformNameError\(''\); clearSettingsSuccess\(\);/);
  assert.match(settingsPage, /setIcon\(nextIcon\); setIconEdited\(true\); clearSettingsSuccess\(\);/);
  assert.match(settingsPage, /function choosePalette\(nextPalette: BrandingPalette\)\s*\{[\s\S]*?clearSettingsSuccess\(\);/);
  assert.match(settingsPage, /function setProtocol\(nextProtocol: ConnectionProtocol\)\s*\{\s*setProtocolState\(nextProtocol\);\s*clearSettingsSuccess\(\);\s*\}/);
  assert.match(settingsPage, /ariaLabel="Public connection protocol" describedBy="protocol-help" value=\{protocol\} onChange=\{setProtocol\} options=\{CONNECTION_PROTOCOL_OPTIONS\}/);
  assert.match(settingsPage, /setAllowRegistration\(event\.target\.checked\); clearSettingsSuccess\(\);/);
  assert.match(settingsPage, /setRequireRegistrationApproval\(event\.target\.checked\); clearSettingsSuccess\(\);/);
  assert.match(settingsPage, /setUserLimitValue\(event\.target\.value\); setUserLimitError\(''\); clearSettingsSuccess\(\);/);
});
