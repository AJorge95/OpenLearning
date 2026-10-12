import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const appSource = fs.readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
const learnerPages = [
  ['/courses', 'CatalogPage'],
  ['/courses/:courseId', 'CourseOverviewPage'],
  ['/courses/:courseId/learn/:lessonId', 'CoursePlayerPage'],
  ['/courses/:courseId/quiz/:quizId', 'QuizPage'],
  ['/my-learning', 'MyLearningPage'],
  ['/my-learning/certificates/:courseId', 'CourseCertificatePage'],
];

test('learner pages load on demand inside a polite route-level fallback', () => {
  assert.doesNotMatch(appSource, /import\s*\{[^}]+\}\s*from\s*['"]\.\/pages-learner['"]/);
  for (const [, page] of learnerPages) {
    assert.match(appSource, new RegExp(`const ${page} = lazy\\(\\(\\) => import\\('./pages-learner'\\).then\\(\\(pages\\) => \\(\\{ default: pages\\.${page} \\}\\)\\)\\);`));
  }

  const outlet = appSource.match(/function LearnerPageOutlet\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(outlet, 'Expected a shared Suspense boundary for learner pages.');
  assert.match(outlet, /role="status" aria-live="polite">Loading learning page…/);
  assert.match(outlet, /<Outlet \/>/);

  const routeGroup = appSource.match(/<Route element=\{<LearnerPageOutlet \/>\}>([\s\S]*?)<\/Route>/)?.[1] || '';
  for (const [path, page] of learnerPages) {
    assert.ok(routeGroup.includes(`<Route path="${path}" element={<${page} />} />`), `${path} should render its lazy ${page}.`);
  }
  assert.match(appSource, /<Route path="\/account\/security" element=\{<AccountSecurityPage \/>} \/>/);
});
