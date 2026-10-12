import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const learnerPageSource = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');
const apiSource = fs.readFileSync(new URL('../../src/api.ts', import.meta.url), 'utf8');

test('overview and lesson player request compact metadata while quiz pages request only their questions', () => {
  const overviewStart = learnerPageSource.indexOf('export function CourseOverviewPage()');
  const playerStart = learnerPageSource.indexOf('export function CoursePlayerPage()', overviewStart);
  const quizStart = learnerPageSource.indexOf('export function QuizPage()', playerStart);
  const overviewSource = learnerPageSource.slice(overviewStart, playerStart);
  const playerSource = learnerPageSource.slice(playerStart, quizStart);
  const quizSource = learnerPageSource.slice(quizStart);

  assert.match(overviewSource, /fetchCourse\(courseId, false, \{ signal: requestController\.signal, includeQuizQuestions: false, includeLatestAttempts: false \}\)/);
  assert.match(playerSource, /fetchCourse\(requestedCourseId, false, \{ signal: requestController\.signal, includeQuizQuestions: false, includeLatestAttempts: false \}\)/);
  assert.match(quizSource, /fetchCourse\(courseId, false, \{ signal: requestController\.signal, quizId \}\)/);
  assert.match(apiSource, /params\.set\('quizId', quizId\)/);
  assert.match(apiSource, /params\.set\('includeQuizQuestions', '0'\)/);
  assert.match(apiSource, /params\.set\('includeLatestAttempts', '0'\)/);
});
