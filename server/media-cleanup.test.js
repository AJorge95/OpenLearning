import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cleanupOrphanedCourseMedia } from './media-cleanup.js';

async function createFixtureDirectory() {
  const tempBase = path.resolve(os.tmpdir());
  const directory = path.resolve(await fs.mkdtemp(path.join(tempBase, 'openlearning-media-cleanup-')));
  if (path.dirname(directory) !== tempBase
    || !path.basename(directory).startsWith('openlearning-media-cleanup-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return directory;
}

async function removeFixtureDirectory(directory) {
  if (!directory) return;
  const tempBase = path.resolve(os.tmpdir());
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-media-cleanup-')) {
    throw new Error('Refusing to remove an unexpected temporary directory.');
  }
  await fs.rm(resolvedDirectory, { recursive: true, force: true });
}

function createDatabase() {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE media_files (course_id TEXT, file_name TEXT);
    CREATE TABLE lesson_resources (lesson_id TEXT, resource_type TEXT, file_name TEXT);
    CREATE TABLE lessons (id TEXT, module_id TEXT);
    CREATE TABLE course_modules (id TEXT, course_id TEXT);
    CREATE TABLE lesson_captions (lesson_id TEXT, file_name TEXT);
  `);
  return database;
}

test('orphan cleanup removes only stale generated files not referenced by course data', async () => {
  const root = await createFixtureDirectory();
  const database = createDatabase();
  try {
    const courseId = '123e4567-e89b-12d3-a456-426614174000';
    const mediaName = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4';
    const documentName = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf';
    const captionName = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc.vtt';
    const staleName = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd.txt';
    const recentName = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.csv';
    const unrecognizedName = 'teacher-notes.json';
    const courseDirectory = path.join(root, courseId);
    await fs.mkdir(courseDirectory, { recursive: true });

    for (const fileName of [mediaName, documentName, captionName, staleName, recentName, unrecognizedName]) {
      await fs.writeFile(path.join(courseDirectory, fileName), fileName);
    }
    const oldTime = new Date(Date.now() - 120_000);
    for (const fileName of [mediaName, documentName, captionName, staleName, unrecognizedName]) {
      await fs.utimes(path.join(courseDirectory, fileName), oldTime, oldTime);
    }

    database.prepare('INSERT INTO media_files (course_id, file_name) VALUES (?, ?)').run(courseId, mediaName);
    database.prepare('INSERT INTO course_modules (id, course_id) VALUES (?, ?)').run('module-1', courseId);
    database.prepare('INSERT INTO lessons (id, module_id) VALUES (?, ?)').run('lesson-1', 'module-1');
    database.prepare('INSERT INTO lesson_resources (lesson_id, resource_type, file_name) VALUES (?, ?, ?)')
      .run('lesson-1', 'document', documentName);
    database.prepare('INSERT INTO lesson_captions (lesson_id, file_name) VALUES (?, ?)').run('lesson-1', captionName);

    const result = await cleanupOrphanedCourseMedia(database, root, 60_000);

    assert.deepEqual(result, { removed: 1, failed: 0, failureSamples: [] });
    await assert.rejects(fs.stat(path.join(courseDirectory, staleName)), { code: 'ENOENT' });
    for (const fileName of [mediaName, documentName, captionName, recentName, unrecognizedName]) {
      await fs.access(path.join(courseDirectory, fileName));
    }
  } finally {
    database.close();
    await removeFixtureDirectory(root);
  }
});

test('orphan cleanup treats a missing media root as empty and rejects invalid age bounds', async () => {
  const root = await createFixtureDirectory();
  const database = createDatabase();
  try {
    const missingRoot = path.join(root, 'not-created');
    assert.deepEqual(await cleanupOrphanedCourseMedia(database, missingRoot, 0), {
      removed: 0,
      failed: 0,
      failureSamples: [],
    });
    await assert.rejects(cleanupOrphanedCourseMedia(database, root, -1), TypeError);
  } finally {
    database.close();
    await removeFixtureDirectory(root);
  }
});
