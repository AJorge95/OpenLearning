export type QuizTextIssue = { questionIndex: number; choiceIndex?: number };

export const MAX_QUIZ_TITLE_LENGTH = 160;
export const QUIZ_TITLE_REQUIRED_ERROR = 'Quiz title is required.';
export const QUIZ_TITLE_TOO_LONG_ERROR = `Quiz title must be ${MAX_QUIZ_TITLE_LENGTH} characters or fewer.`;

export function validateQuizTitle(rawValue: string): { value: string; error: null } | { value: null; error: string } {
  // Match the API's trimmed title validation before a save can fail on the server.
  const value = rawValue.trim();
  if (!value) return { value: null, error: QUIZ_TITLE_REQUIRED_ERROR };
  if (value.length > MAX_QUIZ_TITLE_LENGTH) return { value: null, error: QUIZ_TITLE_TOO_LONG_ERROR };
  return { value, error: null };
}

export function firstQuizTextIssue(
  questions: ReadonlyArray<{ prompt: string; choices: ReadonlyArray<{ text: string }> }>,
): QuizTextIssue | null {
  for (const [questionIndex, question] of questions.entries()) {
    if (!question.prompt.trim()) return { questionIndex };
    const choiceIndex = question.choices.findIndex((choice) => !choice.text.trim());
    if (choiceIndex >= 0) return { questionIndex, choiceIndex };
  }
  return null;
}
