import { randomInt } from 'node:crypto';

export function selectRandomQuizQuestions(questions, count, chooseIndex = (maximum) => randomInt(0, maximum)) {
  if (!Array.isArray(questions) || !Number.isInteger(count) || count < 0 || count > questions.length) {
    throw new RangeError('The requested question count is outside the available question bank.');
  }
  const selected = [...questions];
  for (let index = 0; index < count; index += 1) {
    const swapIndex = index + chooseIndex(selected.length - index);
    [selected[index], selected[swapIndex]] = [selected[swapIndex], selected[index]];
  }
  return selected.slice(0, count);
}
