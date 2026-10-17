import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { coursePublishedNotice } from '../../src/course-published-notice.ts';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx');

test('public course publication confirms learner availability', () => {
  assert.equal(coursePublishedNotice('public'), 'Course published for learners.');
});

test('private course publication explains the access requirement', () => {
  assert.equal(
    coursePublishedNotice('private'),
    'Course published privately. Learners need an active course assignment or access through an unlocked learning path.',
  );
});

test('the editor uses the server-confirmed visibility in its publication notice', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert.match(source, /setNotice\(status === 'published' \? coursePublishedNotice\(response\.course\.visibility\) : status === 'draft'/);
});
