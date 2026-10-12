import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const appSource = fs.readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
const appFile = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

// Keep all routes backed by the large staff module behind named dynamic imports.
const staffPages = [
  'CourseAccessPage',
  'CourseAnalyticsPage',
  'CourseEditorPage',
  'CourseManagementPage',
  'AdminAuditLogPage',
  'AdminSettingsPage',
  'AdminRegistrationFieldsPage',
  'AdminSystemLogPage',
  'AdminUserCreatePage',
  'AdminUserDetailsPage',
  'AdminUsersPage',
];

const routedStaffPages = [
  ['/manage/courses', 'CourseManagementPage'],
  ['/manage/courses/:courseId/analytics', 'CourseAnalyticsPage'],
  ['/manage/courses/:courseId/access', 'CourseAccessPage'],
  ['/admin/audit-log', 'AdminAuditLogPage'],
  ['/admin/settings', 'AdminSettingsPage'],
  ['/admin/settings/registration-fields', 'AdminRegistrationFieldsPage'],
  ['/admin/system-log', 'AdminSystemLogPage'],
  ['/admin/users/new', 'AdminUserCreatePage'],
  ['/admin/users/:userId', 'AdminUserDetailsPage'],
  ['/admin/users', 'AdminUsersPage'],
];

test('staff pages remain out of the entry bundle until their route is opened', () => {
  const eagerManagementImports = appFile.statements.filter((statement) => (
    ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier)
    && statement.moduleSpecifier.text === './pages-manage'
  ));
  assert.deepEqual(eagerManagementImports, [], 'The entry module must not import staff pages eagerly.');
  for (const page of staffPages) {
    assert.match(appSource, new RegExp(`const ${page} = lazy\\(\\(\\) => import\\('./pages-manage'\\).then\\(\\(pages\\) => \\(\\{ default: pages\\.${page} \\}\\)\\)\\);`));
  }

  const outlet = appSource.match(/function StaffPageOutlet\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(outlet, 'Expected a shared boundary for management-page chunks.');
  assert.match(outlet, /ManagementPageBoundary key=\{pathname\}/);
  assert.match(outlet, /<Suspense fallback=\{<div className="page-loading" role="status" aria-live="polite">Loading management page…<\/div>\}>/);
  assert.match(outlet, /<Outlet \/>/);

  const staffOnlyIndex = appSource.indexOf('<Route element={<StaffOnly />}>');
  const staffFrameIndex = appSource.indexOf('<Route element={<StaffFrame />}>', staffOnlyIndex);
  const staffOutletIndex = appSource.indexOf('<Route element={<StaffPageOutlet />}>', staffFrameIndex);
  assert.ok(staffOnlyIndex >= 0 && staffFrameIndex > staffOnlyIndex && staffOutletIndex > staffFrameIndex);
  for (const [path, page] of routedStaffPages) {
    assert.ok(appSource.includes(`<Route path="${path}" element={<${page} />} />`), `${path} should render its lazy ${page}.`);
    assert.ok(appSource.indexOf(`<Route path="${path}"`) > staffOutletIndex, `${path} should remain within the staff page boundary.`);
  }
  assert.ok(/function CourseEditorRoute\(\) \{[\s\S]*?<CourseEditorPage key=\{pathname\} \/>/.test(appSource), 'Course editor routes should render the lazy page export.');
});

test('management chunk failures keep an actionable route-level recovery state', () => {
  const boundary = appSource.match(/class ManagementPageBoundary[\s\S]*?\n\}/)?.[0];
  assert.ok(boundary, 'Expected a route-level boundary for management-page chunks.');
  assert.match(boundary, /getDerivedStateFromError/);
  assert.match(boundary, /role="alert"/);
  assert.match(boundary, /This management page could not be loaded\. Reload to try again\./);
  assert.match(boundary, /window\.location\.reload\(\)/);
});
