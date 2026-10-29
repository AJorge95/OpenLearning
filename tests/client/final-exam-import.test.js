import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { FinalExamImportFormatError, getFinalExamImportReadErrorMessage, parseDelimitedFinalExamFile, parseFinalExamImportRows } from '../../src/final-exam-import.ts';
import { formatCountLabel } from '../../src/count-label.ts';

test('CSV import preserves commas and escaped quotes before validating answer columns', () => {
  const rows = parseDelimitedFinalExamFile([
    'Question,Answer 1,Answer 2,Correct Answer,Explanation',
    '"Which planet is called the ""Red Planet""?","Venus","Mars","2","Iron-rich rocks, oxidized by air."',
  ].join('\r\n'), ',');

  assert.deepEqual(parseFinalExamImportRows(rows), {
    questions: [{
      prompt: 'Which planet is called the "Red Planet"?',
      explanation: 'Iron-rich rocks, oxidized by air.',
      choices: [{ text: 'Venus', isCorrect: false }, { text: 'Mars', isCorrect: true }],
    }],
    errors: [],
    skippedRows: 0,
  });
});

test('TSV import accepts letter and case-insensitive answer-text keys', () => {
  const rows = parseDelimitedFinalExamFile([
    'Prompt\tA\tB\tAnswer Key\tExplanation',
    'Pick south\tNorth\tSouth\tb\tDirection',
    'Pick the red planet\tMars\tVenus\tmars\t',
  ].join('\r\n'), '\t');
  const preview = parseFinalExamImportRows(rows);

  assert.deepEqual(preview.errors, []);
  assert.deepEqual(preview.questions.map((question) => question.choices.map((choice) => choice.isCorrect)), [[false, true], [true, false]]);
});

test('invalid rows report their spreadsheet row numbers and blank rows are skipped', () => {
  const preview = parseFinalExamImportRows([
    ['Question', 'Answer 1', 'Answer 2', 'Correct Answer'],
    ['', 'A', 'B', '1'],
    ['Missing answer', 'A', '', '2'],
    ['', '', '', ''],
  ]);

  assert.deepEqual(preview.questions, []);
  assert.deepEqual(preview.errors, [
    'Row 2: question is blank.',
    'Row 3: add between two and six non-empty answers; correct answer must be a listed answer number (1–6), letter (A–F), or exact answer text.',
  ]);
  assert.equal(preview.skippedRows, 1);
});

test('question imports are capped at 100 valid rows', () => {
  const rows = [
    ['Question', 'Answer 1', 'Answer 2', 'Correct Answer'],
    ...Array.from({ length: 101 }, (_, index) => [`Question ${index + 1}`, 'Yes', 'No', '1']),
  ];
  const preview = parseFinalExamImportRows(rows);

  assert.equal(preview.questions.length, 101);
  assert.deepEqual(preview.errors, ['This import has 101 valid questions. Import up to 100 questions at a time.']);
});

test('delimited imports reject an unclosed quoted cell', () => {
  assert.throws(
    () => parseDelimitedFinalExamFile('Question,Answer 1\n"unfinished,answer', ','),
    /quote that was not closed/,
  );
});

test('delimited imports stop before materializing more than 1,000 rows', () => {
  const csv = `Question,Answer 1,Answer 2,Correct Answer\n${'\n'.repeat(1000)}`;

  assert.throws(
    () => parseDelimitedFinalExamFile(csv, ','),
    (cause) => cause instanceof FinalExamImportFormatError
      && cause.message === 'The spreadsheet has more than 1,000 rows. Remove extra blank rows and try again.',
  );
});

test('workbook imports reject more than 1,000 rows before row validation', () => {
  const rows = Array.from({ length: 1001 }, () => []);

  assert.deepEqual(parseFinalExamImportRows(rows), {
    questions: [],
    errors: ['The spreadsheet has more than 1,000 rows. Remove extra blank rows and try again.'],
    skippedRows: 0,
  });
});

test('delimited imports stop after 100 columns', () => {
  const csv = `${'Answer,'.repeat(100)}Answer`;

  assert.throws(
    () => parseDelimitedFinalExamFile(csv, ','),
    (cause) => cause instanceof FinalExamImportFormatError
      && cause.message === 'The spreadsheet has more than 100 columns. Remove unused columns and try again.',
  );
});

test('workbook imports reject rows with more than 100 columns before validation', () => {
  const rows = [Array.from({ length: 101 }, () => '')];

  assert.deepEqual(parseFinalExamImportRows(rows), {
    questions: [],
    errors: ['The spreadsheet has more than 100 columns. Remove unused columns and try again.'],
    skippedRows: 0,
  });
});

test('import read errors show format guidance without exposing unexpected failures', () => {
  const formatError = new FinalExamImportFormatError('Remove extra blank rows and try again.');

  assert.equal(getFinalExamImportReadErrorMessage(formatError), formatError.message);
  assert.equal(getFinalExamImportReadErrorMessage(new Error('internal parser detail')), 'This spreadsheet could not be read. Check that the file is valid and try again.');
});

test('spreadsheet validation errors are announced when the preview appears', () => {
  const pageSource = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

  assert.match(pageSource, /className="final-exam-import-issues"[^>]*role="alert"/);
});

test('final exam import preview labels use singular or plural counts', () => {
  const pageSource = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

  assert.match(pageSource, /Add \$\{formatCountLabel\(importPreview\.questions\.length, 'question', 'questions'\)\} to bank/, 'the import button should use a count-aware label');
  assert.match(pageSource, /And \{formatCountLabel\(importPreview\.errors\.length - 8, 'additional issue', 'additional issues'\)\}\./, 'the remaining-issues hint should use a count-aware label');
  assert.equal(formatCountLabel(1, 'question', 'questions'), '1 question');
  assert.equal(formatCountLabel(2, 'question', 'questions'), '2 questions');
  assert.equal(formatCountLabel(1, 'additional issue', 'additional issues'), '1 additional issue');
});
