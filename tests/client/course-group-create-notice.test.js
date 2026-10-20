import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const pageStart = source.indexOf('export function CourseGroupsPage()');
const nextPageStart = source.indexOf('\nexport function ', pageStart + 1);
const courseGroupsPage = source.slice(pageStart, nextPageStart);

test('editing a new course-group form clears the previous creation confirmation', () => {
  assert.match(courseGroupsPage, /<label>Group name<input[\s\S]*?onChange=\{\(event\) => \{ setNotice\(''\); setName\(event\.target\.value\); \}\}/);
  assert.match(courseGroupsPage, /<label>Description \(optional\)<textarea[\s\S]*?onChange=\{\(event\) => \{ setNotice\(''\); setDescription\(event\.target\.value\); \}\}/);
});
