import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = fs.readFileSync(path.join(root, 'src/pages-manage.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');

test('lesson video upload keeps a reliable target at every responsive size', () => {
  assert.match(source, /className=\{`button button-upload-small file-button/);

  const uploadRules = [...styles.matchAll(/\.button-upload-small\s*\{([^}]*)\}/g)]
    .map((match) => match[1]);
  assert.equal(uploadRules.length, 2, 'expected base and narrow upload-button rules');
  for (const rule of uploadRules) {
    assert.match(rule, /min-height:\s*40px/);
  }

  assert.match(styles, /\.file-button:focus-within\s*,\s*\.platform-icon-upload:focus-within/);
});
