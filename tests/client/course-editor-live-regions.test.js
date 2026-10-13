import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx');

test('course editor mounts the reorder announcement only while moving curriculum', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');

  assert.match(source, /\{movingCurriculumItems\.size > 0 && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">Updating course content order…<\/p>\}/);
  assert.doesNotMatch(source, /movingCurriculumItems\.size \? 'Updating course content order…' : ''/);
});
