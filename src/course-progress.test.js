import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeCourseProgress } from './course-progress.ts';

const lesson = (id, completed) => ({ id, completed });
const quiz = (id, passed) => ({ id, passed });

test('course progress counts completed lessons and passed quizzes as activities', () => {
  const modules = [
    { lessons: [lesson('lesson-1', true), lesson('lesson-2', false)], quiz: quiz('quiz-1', true) },
    { lessons: [lesson('lesson-3', false)], quiz: quiz('quiz-2', false) },
  ];

  assert.deepEqual(summarizeCourseProgress(modules), {
    completedLessons: 1,
    progress: 40,
    completed: false,
  });
});

test('course progress reaches completion only when every lesson and quiz is complete', () => {
  const modules = [{ lessons: [lesson('lesson-1', true)], quiz: quiz('quiz-1', true) }];

  assert.deepEqual(summarizeCourseProgress(modules), {
    completedLessons: 1,
    progress: 100,
    completed: true,
  });
});

test('a course without activities has zero progress and is not complete', () => {
  assert.deepEqual(summarizeCourseProgress([]), {
    completedLessons: 0,
    progress: 0,
    completed: false,
  });
});
