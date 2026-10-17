import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = fs.readFileSync(path.join(root, 'src/pages-manage.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');

test('lesson document upload keeps a reliable target and native file semantics', () => {
  assert.match(source, /className="lesson-document-upload"/);
  assert.match(source, /className="button button-secondary file-button"[^>]*><Upload[^>]*aria-hidden="true" \/>Choose document<input type="file"/);

  const documentUploadRule = styles.match(/\.lesson-document-upload \.button\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(documentUploadRule, /min-height:\s*40px/);
  assert.match(documentUploadRule, /font-size:\s*11px/);
  assert.match(styles, /\.file-button:focus-within\s*,\s*\.platform-icon-upload:focus-within\s*\{[^}]*outline:\s*2px solid var\(--purple\)/);
  assert.match(styles, /\.file-button input\s*\{[^}]*width:\s*1px;[^}]*height:\s*1px;[^}]*opacity:\s*0/);
});
