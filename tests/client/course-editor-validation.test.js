import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMPLETION_WINDOW_ERROR, validateCompletionWindowDays } from '../../src/course-editor-validation.ts';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

test('completion windows accept a blank value and whole days within the supported range', () => {
  assert.deepEqual(validateCompletionWindowDays(''), { value: null, error: null });
  assert.deepEqual(validateCompletionWindowDays('  '), { value: null, error: null });
  assert.deepEqual(validateCompletionWindowDays('1'), { value: 1, error: null });
  assert.deepEqual(validateCompletionWindowDays('3650'), { value: 3650, error: null });
});

test('completion windows reject values the editor API cannot save', () => {
  for (const value of ['0', '-1', '1.5', '3651', 'Infinity', 'not a number']) {
    assert.deepEqual(validateCompletionWindowDays(value), { value: null, error: COMPLETION_WINDOW_ERROR }, value);
  }
});

test('course editor describes invalid completion-window values and validates before save requests', () => {
  const source = fs.readFileSync(path.join(sourceDirectory, 'pages-manage.tsx'), 'utf8');
  assert.match(source, /step="1"[^>]*aria-invalid=\{completionWindow\.error \? true : undefined\}/);
  assert.match(source, /aria-describedby=\{completionWindow\.error \? 'completion-window-help completion-window-error' : 'completion-window-help'\}/);
  assert.match(source, /id="completion-window-error" className="completion-window-error"/);
  assert.equal((source.match(/if \(completionWindow\.error\) \{/g) || []).length, 2);
  assert.match(source, /completionWindowInputRef\.current\?\.focus\(\);\s*throw new ApiError\(400, completionWindow\.error, 'validation_error'\)/);
  assert.match(source, /completionWindowDays: completionWindow\.value/);
});
