import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeCourseProgress } from '../../src/course-progress.ts';

const lesson = (id, completed) => ({ id, completed });
const quiz = (id, passed, requiredForCompletion = true) => ({ id, passed, requiredForCompletion });

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

test('optional module quizzes do not affect course progress or completion', () => {
  assert.deepEqual(summarizeCourseProgress([
    { lessons: [lesson('lesson-1', true)], quiz: quiz('practice-quiz', false, false) },
  ]), {
    completedLessons: 1,
    progress: 100,
    completed: true,
  });

  assert.deepEqual(summarizeCourseProgress([
    { lessons: [], quiz: quiz('practice-quiz', false, false) },
  ]), {
    completedLessons: 0,
    progress: 0,
    completed: false,
  });
});

test('a course without activities has zero progress and is not complete', () => {
  assert.deepEqual(summarizeCourseProgress([]), {
    completedLessons: 0,
    progress: 0,
    completed: false,
  });
});

test('a required final exam is included in completion while a practice exam is ignored', () => {
  const modules = [{ lessons: [lesson('lesson-1', true)], quiz: null }];

  assert.deepEqual(summarizeCourseProgress(modules, { id: 'exam-1', requiredForCompletion: true, passed: false }), {
    completedLessons: 1,
    progress: 50,
    completed: false,
  });
  assert.deepEqual(summarizeCourseProgress(modules, { id: 'exam-1', requiredForCompletion: true, passed: true }), {
    completedLessons: 1,
    progress: 100,
    completed: true,
  });
  assert.deepEqual(summarizeCourseProgress(modules, { id: 'practice-1', requiredForCompletion: false, passed: false }), {
    completedLessons: 1,
    progress: 100,
    completed: true,
  });
});

test('a required exam can be the only course completion activity', () => {
  assert.deepEqual(summarizeCourseProgress([], { id: 'exam-1', requiredForCompletion: true, passed: true }), {
    completedLessons: 0,
    progress: 100,
    completed: true,
  });
});
