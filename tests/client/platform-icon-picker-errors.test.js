import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const componentSource = fs.readFileSync(path.join(repositoryRoot, 'src/components.tsx'), 'utf8');
const pickerStart = componentSource.indexOf('export function PlatformIconPicker');
const pickerEnd = componentSource.indexOf('\nfunction useSignOutAction', pickerStart);
const picker = componentSource.slice(pickerStart, pickerEnd);

test('platform icon validation errors are associated with the file input', () => {
  assert.ok(pickerStart >= 0 && pickerEnd > pickerStart, 'expected the platform icon picker component');
  assert.match(picker, /const iconErrorId = `\$\{iconHelpId\}-error`;/);
  assert.match(picker, /aria-invalid=\{error \? true : undefined\}/);
  assert.match(picker, /aria-describedby=\{error \? `\$\{iconHelpId\} \$\{iconErrorId\}` : iconHelpId\}/);
  assert.match(picker, /\{error && <span id=\{iconErrorId\} className="form-error platform-icon-error" role="alert">\{error\}<\/span>\}/);
});
