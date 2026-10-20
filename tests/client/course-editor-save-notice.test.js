import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const courseDetails = source.slice(
  source.indexOf('<section className="editor-section course-details-form"'),
  source.indexOf('<section className="editor-section course-governance-section"'),
);

test('editing course details clears the previous save or publication notice', () => {
  assert.equal((courseDetails.match(/setNotice\(''\)/g) || []).length, 6);
});
