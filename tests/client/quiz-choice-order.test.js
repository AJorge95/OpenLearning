import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { shuffleQuizChoices } from '../../src/quiz-choice-order.ts';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

test('shuffles choices into a permutation without changing the source array', () => {
  const choices = ['A', 'B', 'C'];
  const shuffled = shuffleQuizChoices(choices, () => 0);

  assert.deepEqual(shuffled, ['B', 'C', 'A']);
  assert.deepEqual(choices, ['A', 'B', 'C']);
  assert.deepEqual([...shuffled].sort(), ['A', 'B', 'C']);
});

test('learner choice order stays fixed for an attempt and changes when retrying', () => {
  const page = fs.readFileSync(path.join(sourceDirectory, 'pages-learner.tsx'), 'utf8');

  assert.match(page, /const choiceOrders = useMemo\(\(\) => new Map\(\(quiz\?\.questions \?\? \[\]\)\.map/);
  assert.match(page, /shuffleQuizChoices\(question\.choices\)/);
  assert.match(page, /\[quiz\?\.questions, routeKey, choiceShuffleGeneration\]/);
  assert.match(page, /setChoiceShuffleGeneration\(\(generation\) => generation \+ 1\)/);
  assert.match(page, /choiceOrders\.get\(question\.id \|\| String\(index\)\)/);
});

test('learner results preserve aggregate scores without answer review and only offer a retry after failure', () => {
  const page = fs.readFileSync(path.join(sourceDirectory, 'pages-learner.tsx'), 'utf8');

  assert.match(page, /hasQuizAttemptBreakdown\(currentResult\) \? `\$\{currentResult\.correctCount\} of \$\{currentResult\.questionCount\} correct` : 'Question breakdown unavailable'/);
  assert.match(page, /\{formatPercentage\(currentResult\.score\)\}/);
  assert.doesNotMatch(page, /Review your answers|Correct answer:|Your answer is (?:correct|incorrect)/);
  assert.match(page, /!currentResult\.passed && <Button variant="secondary" onClick=\{retryQuiz\}>Try again<\/Button>/);
  assert.match(page, /currentResult\?\.passed && !courseFinished \? nextCourseActivity/);
});
