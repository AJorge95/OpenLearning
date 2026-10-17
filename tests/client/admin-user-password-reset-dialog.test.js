import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manageSource = fs.readFileSync(path.join(repositoryRoot, 'src/pages-manage.tsx'), 'utf8');
const dialogEffectStart = manageSource.indexOf('useEffect(() => {\n    if (!resetUser) return;');
const dialogEffectEnd = manageSource.indexOf('  async function updateUser', dialogEffectStart);
const dialogEffect = manageSource.slice(dialogEffectStart, dialogEffectEnd);

test('administrator password reset dialog exposes its accessible name and description', () => {
  assert.match(manageSource,
    /role="dialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-description" tabIndex=\{-1\}/);
  assert.match(manageSource, /<h2 id="reset-title">Reset password<\/h2>/);
  assert.match(manageSource, /<p id="reset-description">Set a temporary password for/);
  assert.match(manageSource, /label="New password"[^>]*autoFocus/);
});

test('administrator password reset dialog closes on Escape and wraps Tab in both directions', () => {
  assert.ok(dialogEffectStart >= 0, 'expected a password reset dialog focus effect');
  assert.ok(dialogEffectEnd > dialogEffectStart, 'expected the focus effect to end before user updates');
  assert.match(dialogEffect, /if \(event\.key === 'Escape'\)[\s\S]*?event\.preventDefault\(\);[\s\S]*?closePasswordReset\(\);/);
  assert.match(dialogEffect, /event\.shiftKey[\s\S]*?last\.focus\(\)/);
  assert.match(dialogEffect, /!event\.shiftKey[\s\S]*?first\.focus\(\)/);
  assert.match(dialogEffect, /document\.activeElement === dialog \|\| !dialog\?\.contains\(document\.activeElement\)/);
});

test('administrator password reset dialog removes its key listener and restores trigger focus', () => {
  assert.match(dialogEffect, /dialog\?\.querySelector<HTMLElement>\('\[autofocus\]'\)\?\.focus\(\)/);
  assert.match(dialogEffect, /document\.addEventListener\('keydown', handleDialogKeyDown\)/);
  assert.match(dialogEffect, /document\.removeEventListener\('keydown', handleDialogKeyDown\)/);
  assert.match(dialogEffect, /if \(previousFocus\?\.isConnected\) previousFocus\.focus\(\)/);
});
