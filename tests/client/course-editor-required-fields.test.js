import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx');

test('core course-editor required fields show decorative cues without changing accessible names', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const requiredCue = '<small className="form-required-indicator" aria-hidden="true">Required</small>';

  assert.equal((source.match(new RegExp(requiredCue, 'g')) || []).length >= 3, true);
  assert.match(source, /<span className="form-label-row"><span>Course title<\/span>\s*<small className="form-required-indicator" aria-hidden="true">Required<\/small><\/span>[\s\S]*?courseTitleInputRef[\s\S]*?required/);
  assert.match(source, /<span className="form-label-row"><span>Category<\/span>\s*<small className="form-required-indicator" aria-hidden="true">Required<\/small><\/span>[\s\S]*?courseCategoryInputRef[\s\S]*?required/);
  assert.match(source, /<span className="form-label-row"><span>Quiz title<\/span>\s*<small className="form-required-indicator" aria-hidden="true">Required<\/small><\/span>[\s\S]*?setQuizTitleInputRef[\s\S]*?required/);
});
