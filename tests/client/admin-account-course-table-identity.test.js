import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

test('account course activity uses course names as row headers without changing their data-cell styling', () => {
  const source = fs.readFileSync(path.join(sourceRoot, 'pages-manage.tsx'), 'utf8');
  const accountCourseSection = source.slice(
    source.indexOf('<section className="analytics-section account-courses-section">'),
    source.indexOf('</section>', source.indexOf('<section className="analytics-section account-courses-section">')),
  );
  assert.match(accountCourseSection, /<th scope="row"><strong>\{course\.title\}<\/strong><small><CourseStatus status=\{course\.status\} \/><\/small><\/th>/);
  assert.match(accountCourseSection, /<table className="analytics-table">[\s\S]*?<tbody>\{courses\.map\(\(course\) => <tr key=\{course\.id\}>/);

  const styles = fs.readFileSync(path.join(sourceRoot, 'styles.css'), 'utf8');
  assert.match(styles, /\.analytics-table td, \.analytics-table tbody th\s*\{[^}]*padding:\s*13px 12px;[^}]*border-bottom:\s*1px solid var\(--line\);[^}]*vertical-align:\s*top;/);
  assert.match(styles, /\.analytics-table tbody th\s*\{[^}]*background:\s*transparent;[^}]*font-weight:\s*400;[^}]*text-align:\s*left;/);
  assert.match(styles, /\.analytics-table tbody tr:last-child td, \.analytics-table tbody tr:last-child th\s*\{ border-bottom: 0; \}/);
});
