import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

test('course version history uses bounded requests and preserves current-version actions across pages', () => {
  const page = fs.readFileSync(path.join(sourceDirectory, 'pages-manage.tsx'), 'utf8');
  const routes = fs.readFileSync(path.resolve(sourceDirectory, '../server/routes-programs.js'), 'utf8');
  const styles = fs.readFileSync(path.join(sourceDirectory, 'styles.css'), 'utf8');

  assert.match(routes, /SELECT COUNT\(\*\) AS count, MAX\(version_number\) AS currentVersionNumber FROM course_versions WHERE course_id = \?/);
  assert.match(routes, /courseVersionHistoryPage\(courseId, COURSE_VERSION_PAGE_SIZE, \(page - 1\) \* COURSE_VERSION_PAGE_SIZE\)/);
  assert.match(page, /api\.get<CourseVersionHistoryPage[^>]*>\(`\/api\/manage\/courses\/\$\{id\}\/versions\?page=1`/);
  assert.match(page, /api\.get<CourseVersionHistoryPage>\(`\/api\/manage\/courses\/\$\{id\}\/versions\?page=\$\{requestedPage\}`/);
  assert.match(page, /version\.version_number === currentVersionNumber && <span className="current-version-label">Current<\/span>/);
  assert.match(page, /version\.version_number !== currentVersionNumber && <Button type="button"/);
  assert.match(page, />Restore as new version<\/Button>/);
  assert.match(page, /<nav className="course-version-pagination" aria-label="Course version history pages">/);
  assert.match(page, /role="status" aria-live="polite">Showing versions/);
  assert.match(page, />Newer<\/Button>[\s\S]*?>Older<\/Button>/);
  assert.match(page, /onClick=\{\(\) => void loadVersionHistory\(versionPage\)\}>Retry version history/);
  assert.match(styles, /\.course-version-pagination\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(styles, /\.course-version-pagination\s*>\s*div\s*\{\s*width:\s*100%;\s*justify-content:\s*space-between;/);
});
