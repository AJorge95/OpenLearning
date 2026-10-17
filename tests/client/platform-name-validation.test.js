import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MAX_PLATFORM_NAME_LENGTH, MIN_PLATFORM_NAME_LENGTH, normalizePlatformName, platformNameValidationError } from '../../src/platform-name-validation.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const authSource = fs.readFileSync(path.join(root, 'src/pages-auth.tsx'), 'utf8');
const manageSource = fs.readFileSync(path.join(root, 'src/pages-manage.tsx'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server/routes-auth.js'), 'utf8');

test('platform names use the shared server trim and length rules', () => {
  assert.equal(MIN_PLATFORM_NAME_LENGTH, 2);
  assert.equal(MAX_PLATFORM_NAME_LENGTH, 80);
  assert.equal(normalizePlatformName('  Open Learning  '), 'Open Learning');
  assert.equal(platformNameValidationError('  Open Learning  '), null);
  assert.equal(platformNameValidationError('  '), 'Platform name must be between 2 and 80 characters.');
  assert.equal(platformNameValidationError('A'), 'Platform name must be between 2 and 80 characters.');
  assert.equal(platformNameValidationError('a'.repeat(MAX_PLATFORM_NAME_LENGTH + 1)), 'Platform name must be between 2 and 80 characters.');
  assert.equal(platformNameValidationError(null), 'Platform name must be between 2 and 80 characters.');
});

test('setup keeps platform-name errors with the visible input', () => {
  const setupPage = authSource.slice(authSource.indexOf('export function SetupPage()'), authSource.indexOf('function BookOpenMark()'));
  assert.match(setupPage, /platformNameValidationError\(platformName\)[\s\S]*setupPlatformNameInputRef\.current\?\.focus\(\)/);
  assert.match(setupPage, /cause\.code === 'invalid_platform_name'[\s\S]*setStep\(1\)[\s\S]*setupPlatformNameInputRef\.current\?\.focus\(\)/);
  assert.match(setupPage, /minLength=\{MIN_PLATFORM_NAME_LENGTH\} maxLength=\{MAX_PLATFORM_NAME_LENGTH\}/);
  assert.match(setupPage, /aria-invalid=\{platformNameError \? true : undefined\} aria-describedby=\{platformNameError \? setupPlatformNameErrorId : undefined\}/);
});

test('administrator settings mark and focus the name field for client and server errors', () => {
  const settingsPage = manageSource.slice(manageSource.indexOf('export function AdminSettingsPage()'), manageSource.indexOf('export function AdminSettingsTabs()'));
  assert.match(settingsPage, /platformNameValidationError\(name\)[\s\S]*platformNameInputRef\.current\?\.focus\(\)/);
  assert.match(settingsPage, /cause\.code === 'invalid_platform_name'[\s\S]*setPlatformNameError\(cause\.message\)[\s\S]*platformNameInputRef\.current\?\.focus\(\)/);
  assert.match(settingsPage, /minLength=\{MIN_PLATFORM_NAME_LENGTH\} maxLength=\{MAX_PLATFORM_NAME_LENGTH\}/);
  assert.match(settingsPage, /aria-invalid=\{platformNameError \? true : undefined\} aria-describedby=\{platformNameError \? platformNameErrorId : undefined\}/);
});

test('setup and platform settings use the shared server parser', () => {
  assert.match(serverSource, /import \{ normalizePlatformName, platformNameValidationError \} from '\.\.\/src\/platform-name-validation\.ts'/);
  assert.match(serverSource, /function parsePlatformName\(value\)[\s\S]*platformNameValidationError\(value\)[\s\S]*normalizePlatformName\(value\)/);
  assert.equal((serverSource.match(/parsePlatformName\(/g) || []).length, 3);
});
