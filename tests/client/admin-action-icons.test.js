import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const componentSource = fs.readFileSync(path.join(repositoryRoot, 'src/components.tsx'), 'utf8');
const managementSource = fs.readFileSync(path.join(repositoryRoot, 'src/pages-manage.tsx'), 'utf8');
const programSource = fs.readFileSync(path.join(repositoryRoot, 'src/pages-programs.tsx'), 'utf8');

test('admin and settings action icons remain decorative beside visible labels', () => {
  assert.match(componentSource, /fallback=\{<BookOpen size=\{23\} aria-hidden="true" \/>\}/);
  assert.match(componentSource, /<ImagePlus size=\{16\} aria-hidden="true" \/>Upload icon/);
  assert.match(componentSource, /<X size=\{15\} aria-hidden="true" \/>Remove/);
  assert.match(managementSource, /<span className="settings-icon" aria-hidden="true"><Settings2 size=\{19\} \/><\/span>/);
  assert.match(managementSource, /<span className="settings-icon" aria-hidden="true"><UsersRound size=\{19\} \/><\/span>/);
  assert.match(managementSource, /<Plus size=\{16\} aria-hidden="true" \/>Add field/);
  assert.match(programSource, /<Plus size=\{16\} aria-hidden="true" \/>\{saving \? 'Adding…' : 'Add competency'\}/);
});
