import assert from 'node:assert/strict';
import test from 'node:test';
import { lessonResourceUrlError } from '../../src/resource-validation.ts';

test('lesson resource URLs accept credential-free HTTP and HTTPS links', () => {
  assert.equal(lessonResourceUrlError('https://example.com/resource?q=course'), null);
  assert.equal(lessonResourceUrlError('http://example.com/resource'), null);
  assert.equal(lessonResourceUrlError('  https://example.com/resource  '), null);
});

test('lesson resource URLs reject other protocols and embedded credentials', () => {
  const message = 'Links must use HTTP or HTTPS and cannot contain embedded credentials.';
  assert.equal(lessonResourceUrlError('ftp://example.com/resource'), message);
  assert.equal(lessonResourceUrlError('mailto:learner@example.com'), message);
  assert.equal(lessonResourceUrlError('https://teacher:secret@example.com/resource'), message);
});

test('lesson resource URL validation reports malformed input', () => {
  assert.equal(lessonResourceUrlError('not a URL'), 'Enter a valid link URL.');
});
