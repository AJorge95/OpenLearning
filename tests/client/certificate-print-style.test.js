import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const styles = fs.readFileSync(path.join(sourceDirectory, 'styles.css'), 'utf8');
const certificateAccents = [...styles.matchAll(/\.certificate-paper::before\s*\{([^}]*)\}/g)]
  .map((match) => match[1])
  .filter((rule) => rule.includes('background: var(--purple)'));

test('the modern certificate accent clears the legacy circle decoration', () => {
  assert.equal(certificateAccents.length, 1, 'Expected one modern certificate accent rule.');

  const [accent] = certificateAccents;
  assert.match(accent, /left:\s*0/);
  assert.match(accent, /right:\s*0/);
  assert.match(accent, /width:\s*auto/);
  assert.match(accent, /border:\s*0/);
  assert.match(accent, /border-radius:\s*0/);
  assert.match(accent, /box-shadow:\s*none/);
});
