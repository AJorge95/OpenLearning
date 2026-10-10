import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const styles = fs.readFileSync(path.join(sourceDirectory, 'styles.css'), 'utf8');

test('program-card headings and descriptions wrap long unbroken text', () => {
  assert.match(styles, /\.program-card-heading h2\s*\{[^}]*overflow-wrap:\s*anywhere;/);
  assert.match(styles, /\.program-card-heading p\s*\{[^}]*overflow-wrap:\s*anywhere;/);
});
