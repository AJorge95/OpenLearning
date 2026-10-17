import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildAuditActionOptions } from '../../src/audit-log-filter.ts';

test('audit action options preserve a selected action after its log rows are pruned', () => {
  const options = buildAuditActionOptions([
    { action: 'account.created', count: 12 },
    { action: 'course.published', count: 4 },
  ], 'course.deleted');

  assert.deepEqual(options, [
    { value: '', label: 'All actions' },
    { value: 'course.deleted', label: 'course.deleted (no longer retained)' },
    { value: 'account.created', label: 'account.created (12)' },
    { value: 'course.published', label: 'course.published (4)' },
  ]);
});

test('audit action options do not duplicate retained or empty selections', () => {
  const actions = [{ action: 'course.published', count: 4 }];

  assert.deepEqual(buildAuditActionOptions(actions, 'course.published'), [
    { value: '', label: 'All actions' },
    { value: 'course.published', label: 'course.published (4)' },
  ]);
  assert.deepEqual(buildAuditActionOptions(actions, ''), [
    { value: '', label: 'All actions' },
    { value: 'course.published', label: 'course.published (4)' },
  ]);
});

test('the audit action selector uses the retention-aware options', () => {
  const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

  assert.match(source, /const actionFilterOptions = useMemo\(\(\) => buildAuditActionOptions\(actions, action\), \[actions, action\]\)/);
  assert.match(source, /ariaLabel="Filter by action"[^\n]*options=\{actionFilterOptions\}/);
});

test('admin log filter options stay stable across unrelated page renders', () => {
  const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

  assert.match(source, /const SYSTEM_LOG_LEVEL_OPTIONS: AppSelectOption<string>\[\] = \[/);
  assert.match(source, /ariaLabel="Filter by severity"[^\n]*options=\{SYSTEM_LOG_LEVEL_OPTIONS\}/);
});
