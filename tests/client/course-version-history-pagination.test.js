import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

test('course version history keeps the current version visible and collapses older versions by default', () => {
  const page = fs.readFileSync(path.join(sourceDirectory, 'pages-manage.tsx'), 'utf8');
  const routes = fs.readFileSync(path.resolve(sourceDirectory, '../server/routes-programs.js'), 'utf8');
  const styles = fs.readFileSync(path.join(sourceDirectory, 'styles.css'), 'utf8');

  assert.match(routes, /SELECT COUNT\(\*\) AS count, MAX\(version_number\) AS currentVersionNumber FROM course_versions WHERE course_id = \?/);
  assert.match(routes, /historySummary\.count - Number\(currentVersionNumber !== null\)/);
  assert.match(routes, /currentVersion, versions: courseVersionHistoryPage\(courseId, COURSE_VERSION_PAGE_SIZE,[\s\S]*\(page - 1\) \* COURSE_VERSION_PAGE_SIZE \+ Number\(currentVersionNumber !== null\)/);
  assert.doesNotMatch(routes, /currentVersionNumber, revision:/);
  assert.match(page, /api\.get<CourseVersionHistoryPage[^>]*>\(`\/api\/manage\/courses\/\$\{id\}\/versions\?page=1`/);
  assert.match(page, /api\.get<CourseVersionHistoryPage>\(`\/api\/manage\/courses\/\$\{id\}\/versions\?page=\$\{requestedPage\}`/);
  assert.match(page, /<ol className="course-version-current"><li key=\{currentVersion\.id\}>/);
  assert.match(page, /<details className="course-version-history-disclosure">\s*<summary>Previous versions <span>\{versionTotal\}<\/span><\/summary>/);
  assert.match(page, /<ol>\{versions\.map\(\(version\) => \{/);
  assert.match(page, /setCurrentVersion\(history\.currentVersion\)/);
  assert.match(page, /setCurrentVersion\(result\.currentVersion\)/);
  assert.match(page, /versionTotal > 0 \|\| currentVersion/);
  assert.match(page, /aria-label=\{`Restore version \$\{version\.version_number\} as a new course version`\}/);
  assert.match(page, /disabled=\{restoring \|\| reviewPending\} aria-busy=\{restoring\}/);
  assert.match(page, /\{restoring \? 'Restoring version…' : 'Restore as new version'\}/);
  assert.match(page, /<nav className="course-version-pagination" aria-label="Course version history pages">/);
  assert.match(page, /role="status" aria-live="polite">Showing previous versions \{lastVersion\}–\{firstVersion\} of \{total\}/);
  assert.match(page, />Newer<\/Button>[\s\S]*?>Older<\/Button>/);
  assert.match(page, /onClick=\{\(\) => void loadVersionHistory\(versionPage\)\}>Retry version history/);
  assert.match(styles, /\.course-version-pagination\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(styles, /\.course-version-pagination\s*>\s*div\s*\{\s*width:\s*100%;\s*justify-content:\s*space-between;/);
  assert.match(styles, /\.course-version-history-disclosure\s*> summary/);
});
