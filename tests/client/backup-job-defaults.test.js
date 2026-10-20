import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-backups.tsx', import.meta.url), 'utf8');
const defaultJob = source.slice(source.indexOf('function defaultJob('), source.indexOf('function isJobInputDirty('));
const editor = source.slice(source.indexOf('function JobEditor('), source.indexOf('export function AdminBackupsPage('));

test('new daily backup jobs omit the weekday required only for weekly schedules', () => {
  assert.match(defaultJob, /frequency: 'daily', weekday: null/);
});

test('switching backup frequency clears weekday for daily and initializes it for weekly', () => {
  assert.match(editor, /weekday: event\.target\.value === 'weekly' \? current\.weekday \?\? 1 : null/);
});
