import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDelimitedFinalExamFile, parseFinalExamImportRows } from '../../src/final-exam-import.ts';

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
