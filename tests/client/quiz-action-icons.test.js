import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');
const quizStart = source.indexOf('export function QuizPage');
const quiz = source.slice(quizStart);

test('quiz actions and result indicators hide decorative icons', () => {
  for (const [icon, size] of [['ArrowLeft', 17], ['ArrowRight', 17], ['ArrowRight', 16], ['Check', 22], ['Clock3', 22], ['Award', 17]]) {
    assert.match(quiz, new RegExp(`<${icon} size=\\{${size}\\}[^>]*aria-hidden="true"`), `${icon} ${size}px icon should be decorative`);
  }
});
