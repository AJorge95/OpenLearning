import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const managementSource = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

test('course row menu keyboard focus has a distinct visible outline', () => {
  const hoverRule = styles.match(/\.row-menu-popover button:hover, \.row-menu-popover a:hover\s*\{([^}]+)\}/);
  const focusRule = styles.match(/\.row-menu-popover \[role="menuitem"\]:focus-visible\s*\{([^}]+)\}/);

  assert.ok(hoverRule, 'expected hover styling to remain on pointer interactions');
  assert.ok(focusRule, 'expected a separate focus-visible rule for menu items');
  assert.doesNotMatch(hoverRule[1], /outline\s*:\s*(?:none|0)/);
  assert.match(focusRule[1], /outline:\s*2px solid var\(--purple\)/);
  assert.match(focusRule[1], /outline-offset:\s*-2px/);
});

test('course row actions restore focus or move it to the persistent search', () => {
  const menuStart = managementSource.indexOf('function CourseRowMenu(');
  const menuEnd = managementSource.indexOf('\nfunction defaultQuizTitle', menuStart);
  const pageStart = managementSource.indexOf('export function CourseManagementPage()');
  const pageEnd = managementSource.indexOf('\nfunction Percentage', pageStart);
  const menu = managementSource.slice(menuStart, menuEnd);
  const page = managementSource.slice(pageStart, pageEnd);

  assert.match(menu, /closeMenu\(true\); onStatusChange\(course, 'published'\)/);
  assert.match(menu, /closeMenu\(true\); onStatusChange\(course, 'draft'\)/);
  assert.match(menu, /closeMenu\(true\); onStatusChange\(course, 'archived'\)/);
  assert.match(menu, /closeMenu\(true\); onDelete\(course\)/);
  assert.match(page, /await load\(\);\s*if \(filtersRef\.current\.status !== 'all' && filtersRef\.current\.status !== nextStatus\) \{[\s\S]*?courseSearchInputRef\.current\?\.focus\(\);/);
  assert.match(page, /await api\.delete\(`\/api\/manage\/courses\/\$\{course\.id\}`\);\s*await load\(\);[\s\S]*?courseSearchInputRef\.current\?\.focus\(\);/);
});
