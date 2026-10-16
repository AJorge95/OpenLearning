import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = fs.readFileSync(path.resolve('src/components.tsx'), 'utf8');
const styles = fs.readFileSync(path.resolve('src/styles.css'), 'utf8');

test('shared platform icon actions keep reliable targets and file semantics', () => {
  assert.match(source, /className="button button-secondary platform-icon-upload"[^>]*>.*?<input type="file"/s);
  assert.match(source, /className="button button-quiet platform-icon-remove"[^>]*onClick=/);
  assert.match(styles, /\.platform-icon-upload\s*\{[^}]*min-height:\s*40px;/);
  assert.match(styles, /\.platform-icon-remove\s*\{[^}]*min-height:\s*40px;/);
  assert.match(styles, /\.platform-icon-upload input\s*\{[^}]*inset:\s*0;[^}]*opacity:\s*0;[^}]*cursor:\s*pointer;/);
  assert.match(styles, /\.platform-icon-actions\s*\{[^}]*flex-wrap:\s*nowrap;/);
});
