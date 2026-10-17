import assert from 'node:assert/strict';
import test from 'node:test';
import { completedCourseActionLabel, courseActivityActionLabel, courseCardActionLabel, nextCourseActivity, nextCourseActivityAfterLesson, shouldEnrollBeforeCourseActivity } from '../../src/course-navigation.ts';

const lesson = (id, completed) => ({ id, completed });
const quiz = (id, passed) => ({ id, passed });

test('continues to the first unfinished lesson in course order', () => {
  const modules = [
    { lessons: [lesson('lesson-1', true), lesson('lesson-2', false)], quiz: quiz('quiz-1', false) },
    { lessons: [lesson('lesson-3', false)], quiz: null },
  ];

  assert.deepEqual(nextCourseActivity(modules), { type: 'lesson', id: 'lesson-2' });
});

test('continues to an unpassed module quiz after its lessons and before later modules', () => {
  const modules = [
    { lessons: [lesson('lesson-1', true)], quiz: quiz('quiz-1', false) },
    { lessons: [lesson('lesson-2', false)], quiz: null },
  ];

  assert.deepEqual(nextCourseActivity(modules), { type: 'quiz', id: 'quiz-1' });
});

test('skips passed quizzes and advances to the next module lesson', () => {
  const modules = [
    { lessons: [lesson('lesson-1', true)], quiz: quiz('quiz-1', true) },
    { lessons: [lesson('lesson-2', false)], quiz: null },
  ];

  assert.deepEqual(nextCourseActivity(modules), { type: 'lesson', id: 'lesson-2' });
});

test('keeps lesson review available after all course activities are complete', () => {
  const modules = [{ lessons: [lesson('lesson-1', true)], quiz: quiz('quiz-1', true) }];

  assert.deepEqual(nextCourseActivity(modules), { type: 'lesson', id: 'lesson-1' });
  assert.equal(courseActivityActionLabel({ starting: false, completed: true, nextActivity: nextCourseActivity(modules), progress: 100 }), 'Review course');
});

test('labels course cards according to exact completion and progress state', () => {
  assert.equal(completedCourseActionLabel(true), 'Review course');
  assert.equal(completedCourseActionLabel(false), null);
  assert.equal(courseCardActionLabel({ completed: false, progress: 0 }), 'Start course');
  assert.equal(courseCardActionLabel({ completed: false, progress: 45 }), 'Continue course');
  assert.equal(courseCardActionLabel({ completed: false, progress: 100 }), 'Continue course');
  assert.equal(courseCardActionLabel({ completed: true, progress: 100 }), 'Review course');
});

test('keeps the continuation label when rounded progress is 100 but an activity remains', () => {
  const nextActivity = { type: 'quiz', id: 'quiz-1' };

  assert.equal(courseActivityActionLabel({ starting: false, completed: false, nextActivity, progress: 100 }), 'Continue to quiz');
});

test('shows the pending label before completed-course review', () => {
  assert.equal(courseActivityActionLabel({ starting: true, completed: true, nextActivity: { type: 'lesson', id: 'lesson-1' }, progress: 100 }), 'Starting…');
});

test('returns no activity when the course has no modules or lessons', () => {
  assert.equal(nextCourseActivity(undefined), null);
  assert.equal(nextCourseActivity([{ lessons: [], quiz: null }]), null);
});

test('only learners create an enrollment before opening course activities', () => {
  assert.equal(shouldEnrollBeforeCourseActivity('learner'), true);
  assert.equal(shouldEnrollBeforeCourseActivity('moderator'), false);
  assert.equal(shouldEnrollBeforeCourseActivity('admin'), false);
  assert.equal(shouldEnrollBeforeCourseActivity(null), false);
  assert.equal(shouldEnrollBeforeCourseActivity(undefined), false);
});

test('continues to the next lesson before the module quiz', () => {
  const modules = [{ lessons: [lesson('lesson-1', true), lesson('lesson-2', false)], quiz: quiz('quiz-1', false) }];

  assert.deepEqual(nextCourseActivityAfterLesson(modules, 'lesson-1'), { type: 'lesson', id: 'lesson-2' });
});

test('continues from a module’s last lesson to its unpassed quiz before later lessons', () => {
  const modules = [
    { lessons: [lesson('lesson-1', true)], quiz: quiz('quiz-1', false) },
    { lessons: [lesson('lesson-2', false)], quiz: null },
  ];

  assert.deepEqual(nextCourseActivityAfterLesson(modules, 'lesson-1'), { type: 'quiz', id: 'quiz-1' });
});

test('skips a passed quiz and continues to the next module lesson', () => {
  const modules = [
    { lessons: [lesson('lesson-1', true)], quiz: quiz('quiz-1', true) },
    { lessons: [lesson('lesson-2', false)], quiz: null },
  ];

  assert.deepEqual(nextCourseActivityAfterLesson(modules, 'lesson-1'), { type: 'lesson', id: 'lesson-2' });
});

test('continues to an unpassed quiz in a later module without lessons', () => {
  const modules = [
    { lessons: [lesson('lesson-1', true)], quiz: null },
    { lessons: [], quiz: quiz('quiz-2', false) },
  ];

  assert.deepEqual(nextCourseActivityAfterLesson(modules, 'lesson-1'), { type: 'quiz', id: 'quiz-2' });
});

test('returns no next activity when the lesson is missing or the course is finished', () => {
  const modules = [{ lessons: [lesson('lesson-1', true)], quiz: quiz('quiz-1', true) }];

  assert.equal(nextCourseActivityAfterLesson(modules, 'missing'), null);
  assert.equal(nextCourseActivityAfterLesson(modules, 'lesson-1'), null);
});

test('adds the final exam after module lessons and quizzes, including exam-only courses', () => {
  const exam = { id: 'final-exam', passed: false };
  const modules = [{ lessons: [lesson('lesson-1', true)], quiz: quiz('quiz-1', true) }];

  assert.deepEqual(nextCourseActivity(modules, exam), { type: 'exam', id: 'final-exam' });
  assert.deepEqual(nextCourseActivity([], exam), { type: 'exam', id: 'final-exam' });
  assert.deepEqual(nextCourseActivityAfterLesson(modules, 'lesson-1', exam), { type: 'exam', id: 'final-exam' });
  assert.deepEqual(nextCourseActivityAfterLesson([], 'lesson-1', exam), null);
  assert.equal(courseActivityActionLabel({ starting: false, completed: false, nextActivity: { type: 'exam', id: 'final-exam' }, progress: 0 }), 'Start final exam');
});
