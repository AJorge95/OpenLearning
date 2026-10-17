export type ImportedFinalExamQuestion = {
  prompt: string;
  explanation: string;
  choices: Array<{ text: string; isCorrect: boolean }>;
};

export type FinalExamImportPreview = {
  questions: ImportedFinalExamQuestion[];
  errors: string[];
  skippedRows: number;
};

const MAX_IMPORT_QUESTIONS = 100;

function normalizeHeader(value: unknown) {
  return String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function cellText(value: unknown) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function answerColumn(header: string): number | null {
  const numbered = header.match(/^(?:answer|choice|option)\s*([1-6])$/);
  if (numbered) return Number(numbered[1]);
  const lettered = header.match(/^(?:(?:answer|choice|option)\s*)?([a-f])$/);
  return lettered ? lettered[1].toUpperCase().charCodeAt(0) - 64 : null;
}

export function parseFinalExamImportRows(rows: readonly (readonly unknown[])[]): FinalExamImportPreview {
  const errors: string[] = [];
  const headerIndex = rows.findIndex((row) => row.some((cell) => cellText(cell) !== ''));
  if (headerIndex < 0) return { questions: [], errors: ['The spreadsheet is empty.'], skippedRows: 0 };

  const headers = rows[headerIndex].map(normalizeHeader);
  const questionColumns = headers.flatMap((header, column) => ['question', 'prompt'].includes(header) ? [column] : []);
  const correctColumns = headers.flatMap((header, column) => ['correct', 'correct answer', 'answer key'].includes(header) ? [column] : []);
  const explanationColumns = headers.flatMap((header, column) => header === 'explanation' ? [column] : []);
  const questionColumn = questionColumns[0] ?? -1;
  const correctColumn = correctColumns[0] ?? -1;
  const explanationColumn = explanationColumns[0] ?? -1;
  const choiceColumns = headers.flatMap((header, column) => {
    const number = answerColumn(header);
    return number === null ? [] : [{ number, column }];
  }).sort((left, right) => left.number - right.number);

  if (questionColumn < 0) errors.push('Add a “Question” or “Prompt” column.');
  if (questionColumns.length > 1) errors.push('Use only one “Question” or “Prompt” column.');
  if (correctColumn < 0) errors.push('Add a “Correct Answer” column with an answer number (1–6) or letter (A–F).');
  if (correctColumns.length > 1) errors.push('Use only one “Correct Answer” column.');
  if (explanationColumns.length > 1) errors.push('Use only one “Explanation” column.');
  if (choiceColumns.length < 2) errors.push('Add at least two answer columns, such as “Answer 1” and “Answer 2”.');
  const duplicateChoiceNumber = choiceColumns.find((choice, index) => choiceColumns[index - 1]?.number === choice.number);
  if (duplicateChoiceNumber) errors.push(`There is more than one answer column for answer ${duplicateChoiceNumber.number}.`);
  if (headers.some((header) => /^(?:answer|choice|option)\s*(?:[7-9]\d*|[g-z])$/.test(header))) {
    errors.push('Final exam questions can have at most six answer columns.');
  }
  if (errors.length) return { questions: [], errors, skippedRows: 0 };

  const questions: ImportedFinalExamQuestion[] = [];
  let skippedRows = 0;
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row.some((cell) => cellText(cell) !== '')) {
      skippedRows += 1;
      continue;
    }

    const rowNumber = index + 1;
    const prompt = cellText(row[questionColumn]);
    const explanation = explanationColumn < 0 ? '' : cellText(row[explanationColumn]);
    const choices = choiceColumns.map(({ number, column }) => ({ number, text: cellText(row[column]) })).filter((choice) => choice.text !== '');
    const rowErrors: string[] = [];
    if (!prompt) rowErrors.push('question is blank');
    else if (prompt.length > 1000) rowErrors.push('question is longer than 1,000 characters');
    if (choices.length < 2 || choices.length > 6) rowErrors.push('add between two and six non-empty answers');
    if (choices.some((choice) => choice.text.length > 500)) rowErrors.push('an answer is longer than 500 characters');
    if (explanation.length > 1000) rowErrors.push('explanation is longer than 1,000 characters');

    const correctAnswer = cellText(row[correctColumn]);
    const answerNumber = /^[1-6]$/.test(correctAnswer) ? Number(correctAnswer)
      : /^[a-f]$/i.test(correctAnswer) ? correctAnswer.toUpperCase().charCodeAt(0) - 64
        : null;
    let correctChoice = answerNumber === null ? -1 : choices.findIndex((choice) => choice.number === answerNumber);
    if (answerNumber === null && correctAnswer) {
      const matchingChoices = choices.flatMap((choice, choiceIndex) => choice.text.toLowerCase() === correctAnswer.toLowerCase() ? [choiceIndex] : []);
      if (matchingChoices.length === 1) correctChoice = matchingChoices[0];
      else if (matchingChoices.length > 1) rowErrors.push('correct answer text matches more than one answer');
    }
    if (correctChoice < 0 && !rowErrors.some((message) => message.startsWith('correct answer'))) {
      rowErrors.push(correctAnswer ? 'correct answer must be a listed answer number (1–6), letter (A–F), or exact answer text' : 'correct answer is blank');
    }

    if (rowErrors.length) errors.push(`Row ${rowNumber}: ${rowErrors.join('; ')}.`);
    else questions.push({
      prompt,
      explanation,
      choices: choices.map((choice, choiceIndex) => ({ text: choice.text, isCorrect: choiceIndex === correctChoice })),
    });
  }

  if (questions.length > MAX_IMPORT_QUESTIONS) errors.push(`This import has ${questions.length} valid questions. Import up to ${MAX_IMPORT_QUESTIONS} questions at a time.`);
  if (questions.length === 0 && errors.length === 0) errors.push('No question rows were found beneath the header.');
  return { questions, errors, skippedRows };
}

export function parseDelimitedFinalExamFile(text: string, delimiter: ',' | '\t') {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('The CSV or TSV file has a quote that was not closed.');
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function downloadFinalExamImportTemplate() {
  const content = [
    ['Question', 'Answer 1', 'Answer 2', 'Answer 3', 'Answer 4', 'Correct Answer', 'Explanation'],
    ['Which planet is known as the Red Planet?', 'Venus', 'Mars', 'Jupiter', 'Saturn', '2', 'Mars appears red because iron minerals in its soil oxidize.'],
  ].map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${content}\r\n`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'final-exam-questions-template.csv';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
