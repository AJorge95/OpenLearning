import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const pageSource = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');

test('the lesson completion toggle exposes its current state and reverse action', () => {
  const playerSource = pageSource.slice(
    pageSource.indexOf('export function CoursePlayerPage()'),
    pageSource.indexOf('export function QuizPage()'),
  );

  assert.match(playerSource, /const completionButtonLabel = saving[\s\S]*?current\.completed[\s\S]*?Mark lesson incomplete/);
  assert.match(playerSource, /aria-label=\{completionButtonLabel\}/);
  assert.match(playerSource, /aria-pressed=\{current\.completed\}/);
  assert.match(playerSource, /title=\{current\.completed && !saving \? completionButtonLabel : undefined\}/);
});
