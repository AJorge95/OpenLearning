import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const stylesPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/styles.css');

test('document and body can shrink to the usable mobile viewport width', () => {
  const styles = fs.readFileSync(stylesPath, 'utf8');
  const htmlRule = styles.match(/^html\s*\{([^}]*)\}/m);
  const bodyRule = styles.match(/^body\s*\{([^}]*)\}/m);

  assert.ok(htmlRule, 'expected the document root style');
  assert.ok(bodyRule, 'expected the document body style');
  assert.doesNotMatch(htmlRule[1], /min-width\s*:/);
  assert.doesNotMatch(bodyRule[1], /min-width\s*:/);
});
