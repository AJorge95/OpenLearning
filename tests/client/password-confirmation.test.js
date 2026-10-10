import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { getPasswordConfirmationError } from '../../src/password-confirmation.ts';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

test('password confirmation accepts identical values without trimming', () => {
  assert.equal(getPasswordConfirmationError('correct horse battery staple', 'correct horse battery staple'), null);
  assert.equal(getPasswordConfirmationError(' password ', ' password '), null);
});

test('password confirmation reports mismatched values', () => {
  assert.equal(getPasswordConfirmationError('correct horse battery staple', 'correct horse battery stapler'), 'Passwords do not match.');
  assert.equal(getPasswordConfirmationError('password', ' password'), 'Passwords do not match.');
});

test('all password confirmation forms use the shared client validation', () => {
  const countValidationCalls = (fileName) => {
    const source = fs.readFileSync(path.join(sourceDirectory, fileName), 'utf8');
    return source.match(/getPasswordConfirmationError\(/g)?.length ?? 0;
  };

  assert.equal(countValidationCalls('pages-auth.tsx'), 3);
  assert.equal(countValidationCalls('pages-manage.tsx'), 3);
});
