import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  firstQuizTextIssue,
  MAX_QUIZ_TITLE_LENGTH,
  QUIZ_TITLE_REQUIRED_ERROR,
  QUIZ_TITLE_TOO_LONG_ERROR,
  validateQuizTitle,
} from '../../src/quiz-validation.ts';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

const validQuestion = {
  prompt: 'Which answer is correct?',
  choices: [{ text: 'First', isCorrect: true }, { text: 'Second', isCorrect: false }],
};

test('accepts an empty draft and complete quiz text', () => {
  assert.equal(firstQuizTextIssue([]), null);
  assert.equal(firstQuizTextIssue([validQuestion]), null);
});

test('returns the first blank question prompt after trimming whitespace', () => {
  assert.deepEqual(firstQuizTextIssue([
    validQuestion,
    { ...validQuestion, prompt: '  ' },
    { ...validQuestion, prompt: '' },
  ]), { questionIndex: 1 });
});

test('returns the first blank answer choice before later question issues', () => {
  assert.deepEqual(firstQuizTextIssue([
    { ...validQuestion, choices: [{ text: 'First', isCorrect: true }, { text: ' \t ', isCorrect: false }] },
    { ...validQuestion, prompt: '' },
  ]), { questionIndex: 0, choiceIndex: 1 });
});

test('quiz titles are trimmed, required, and limited to the server maximum', () => {
  assert.deepEqual(validateQuizTitle('  Safety check  '), { value: 'Safety check', error: null });
  assert.deepEqual(validateQuizTitle('x'.repeat(MAX_QUIZ_TITLE_LENGTH)), {
    value: 'x'.repeat(MAX_QUIZ_TITLE_LENGTH),
    error: null,
  });
  assert.deepEqual(validateQuizTitle('   '), { value: null, error: QUIZ_TITLE_REQUIRED_ERROR });
  assert.deepEqual(validateQuizTitle('x'.repeat(MAX_QUIZ_TITLE_LENGTH + 1)), {
    value: null,
    error: QUIZ_TITLE_TOO_LONG_ERROR,
  });
});

test('quiz editor validates its title inline and preserves the parent focus ref', () => {
  const source = fs.readFileSync(path.join(sourceDirectory, 'pages-manage.tsx'), 'utf8');
  const quizEditor = source.slice(source.indexOf('function QuizEditor('), source.indexOf('function LessonDetailsEditor('));
  const save = quizEditor.slice(quizEditor.indexOf('async function save()'), quizEditor.indexOf('async function remove('));

  assert.match(quizEditor, /const setQuizTitleInputRef = useCallback\(\(node: HTMLInputElement \| null\) => \{\s*quizTitleInputRef\.current = node;\s*titleInputRef\?\.\(node\);/);
  assert.match(quizEditor, /<input ref=\{setQuizTitleInputRef\} required aria-label=\{`Quiz title for \$\{quizContext\}`\} value=\{title\} maxLength=\{quizTitleLimit\} aria-invalid=\{titleError \? true : undefined\} aria-describedby=\{titleError \? `quiz-title-error-\$\{module\.id\}` : undefined\}/);
  assert.match(quizEditor, /id=\{`quiz-title-error-\$\{module\.id\}`\} className="quiz-title-error" role="alert">\{titleError\}/);
  assert.match(save, /validateQuizTitle\(title\)[\s\S]*?quizTitleInputRef\.current\?\.focus\(\)[\s\S]*?title: normalizedTitle/);
});
