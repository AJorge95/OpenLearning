import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

test('course-editor quiz and resource icons stay decorative beside labels', () => {
  const quizEditor = source.match(/function QuizEditor[\s\S]*?function LessonDetailsEditor/)?.[0];
  assert.ok(quizEditor, 'Expected the quiz and lesson editor source.');
  assert.match(quizEditor, /<CircleHelp size=\{15\} aria-hidden="true" \/>Module quiz/);
  assert.match(quizEditor, /<Trash2 size=\{16\} aria-hidden="true" \/>/);
  assert.match(quizEditor, /<Trash2 size=\{15\} aria-hidden="true" \/>/);
  assert.match(quizEditor, /<Plus size=\{15\} aria-hidden="true" \/>Add answer choice/);
  assert.match(quizEditor, /<Plus size=\{16\} aria-hidden="true" \/>/);

  assert.match(source, /\{resource\.kind === 'link' \? <Link2 size=\{16\} aria-hidden="true" \/> : <FileText size=\{16\} aria-hidden="true" \/>\}/);
  assert.match(source, /<Link2 size=\{15\} aria-hidden="true" \/>Add link/);
  assert.match(source, /<Upload size=\{15\} aria-hidden="true" \/>Choose document/);
  assert.match(source, /<FileText size=\{16\} aria-hidden="true" \/>/);
  assert.match(source, /<Trash2 size=\{15\} aria-hidden="true" \/>/);
  assert.match(source, /<Upload size=\{15\} aria-hidden="true" \/>Upload captions/);
});
