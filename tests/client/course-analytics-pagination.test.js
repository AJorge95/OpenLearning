import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');

test('course analytics loads the summary once and fetches learner pages independently', () => {
  assert.match(source, /api\.get<CourseAnalytics>\(`\/api\/manage\/courses\/\$\{courseId\}\/analytics\?page=1`/);
  assert.match(source, /api\.get<CourseAnalyticsLearnerPage>\(`\/api\/manage\/courses\/\$\{courseId\}\/analytics\?page=\$\{page\}&learnersOnly=1`/);
  assert.match(source, /summary:\s*\{\s*\.\.\.current\.summary,\s*learnerCount:\s*result\.learnerCount/);

  const pageRequestStart = source.indexOf('if (!data || data.course.id !== courseId || page === data.page) return;');
  const pageRequestEnd = source.indexOf('}, [courseId, page, learnerPageRetryVersion, data?.course.id, data?.page]);', pageRequestStart);
  assert.ok(pageRequestStart >= 0 && pageRequestEnd > pageRequestStart, 'learner-page effect should guard loaded pages and stale course data');
  assert.doesNotMatch(source.slice(pageRequestStart, pageRequestEnd), /setData\(null\)/);

  assert.match(source, /className="analytics-section analytics-learners-section" aria-busy=\{learnerPageLoading\}/);
  assert.match(source, /learnerPageLoading \? <p[^>]*role="status"[^>]*>Loading learner progress page/);
  assert.match(source, /learnerPageError \? <div[^>]*role="alert"/);
  assert.match(source, /page=\{page\} pageSize=\{data\.pageSize\} total=\{data\.summary\.learnerCount\} loading=\{learnerPageLoading\}/);
});
