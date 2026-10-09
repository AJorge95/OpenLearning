export type QuizTextIssue = { questionIndex: number; choiceIndex?: number };

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
