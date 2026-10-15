import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

test('course list revision badges keep the published and pending states distinct', () => {
  const badge = source.slice(source.indexOf('function CourseRevisionBadge'), source.indexOf('export function CourseManagementPage'));
  const page = source.slice(source.indexOf('export function CourseManagementPage'), source.indexOf('\nfunction Percentage'));

  assert.match(badge, /aria-hidden="true">\{label\}<\/span>/);
  assert.match(badge, /function courseRevisionAnnouncement\(status: Course\['reviewStatus'\]\)/);
  assert.match(badge, /A revision is awaiting review\./);
  assert.match(badge, /A revision has changes requested\./);
  assert.match(badge, /There are unpublished draft changes\./);
  assert.match(page, /<CourseRevisionBadge status=\{course\.reviewStatus\} \/><span className="sr-only">\{courseRevisionAnnouncement\(course\.reviewStatus\)\}<\/span>/);
});
