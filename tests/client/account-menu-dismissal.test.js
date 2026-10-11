import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/components.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const header = source.match(/export function Header\(\) \{([\s\S]*?)\n\}\n\nexport function AppFrame/);
assert.ok(header, 'Expected to find the shared learner header.');
const dismissalEffect = header[1].match(/useEffect\(\(\) => \{([\s\S]*?)\}, \[\]\);/);
assert.ok(dismissalEffect, 'Expected the account-menu dismissal effect to install once.');

test('account menu closes on outside pointer and focus without intercepting its own controls', () => {
  const effect = dismissalEffect[1];

  assert.match(effect, /const closeWhenOutside = \(event: Event\)/);
  assert.match(effect, /if \(!menu\?\.open \|\| !\(event\.target instanceof Node\) \|\| menu\.contains\(event\.target\)\) return;/);
  assert.match(effect, /document\.addEventListener\('pointerdown', closeWhenOutside\)/);
  assert.match(effect, /document\.addEventListener\('focusin', closeWhenOutside\)/);
  assert.match(effect, /document\.removeEventListener\('pointerdown', closeWhenOutside\)/);
  assert.match(effect, /document\.removeEventListener\('focusin', closeWhenOutside\)/);
});

test('Escape closes the account menu and returns focus to its summary', () => {
  const effect = dismissalEffect[1];

  assert.match(effect, /if \(event\.key !== 'Escape' \|\| !menu\?\.open\) return;/);
  assert.match(effect, /event\.preventDefault\(\);\s*menu\.open = false;\s*menu\.querySelector\('summary'\)\?\.focus\(\);/);
  assert.match(effect, /document\.addEventListener\('keydown', closeOnEscape\)/);
  assert.match(effect, /document\.removeEventListener\('keydown', closeOnEscape\)/);
});
