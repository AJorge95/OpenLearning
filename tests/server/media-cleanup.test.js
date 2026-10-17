import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cleanupOrphanedCourseMedia, getOrphanedMediaCleanupLog } from '../../server/media-cleanup.js';

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

test('startup cleanup logs clean passes and retains bounded failure diagnostics', () => {
  assert.deepEqual(getOrphanedMediaCleanupLog({
    removed: 0,
    failed: 0,
    courseDirectoriesScanned: 0,
    directoryEntriesScanned: 0,
    failureSamples: [],
  }, 7), {
    level: 'info',
    message: 'Completed orphaned course media cleanup during startup',
    details: {
      removed: 0,
      failed: 0,
      courseDirectoriesScanned: 0,
      directoryEntriesScanned: 0,
      durationMs: 7,
    },
  });

  const failureSample = { stage: 'read_course_directory', errorCode: 'EACCES' };
  const failedLog = getOrphanedMediaCleanupLog({
    removed: 1,
    failed: 1,
    courseDirectoriesScanned: 3,
    directoryEntriesScanned: 12,
    failureSamples: [failureSample],
  }, 19);
  assert.equal(failedLog.level, 'warn');
  assert.equal(failedLog.message, 'Some orphaned course media files could not be removed during startup');
  assert.deepEqual(failedLog.details, {
    removed: 1,
    failed: 1,
    courseDirectoriesScanned: 3,
    directoryEntriesScanned: 12,
    durationMs: 19,
    failureSamples: [failureSample],
  });
});

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

    assert.deepEqual(result, {
      removed: 1,
      failed: 0,
      courseDirectoriesScanned: 1,
      directoryEntriesScanned: 6,
      failureSamples: [],
    });
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
      courseDirectoriesScanned: 0,
      directoryEntriesScanned: 0,
      failureSamples: [],
    });
    await assert.rejects(cleanupOrphanedCourseMedia(database, root, -1), TypeError);
  } finally {
    database.close();
    await removeFixtureDirectory(root);
  }
});

test('orphan cleanup propagates inaccessible media-root errors', async () => {
  const root = await createFixtureDirectory();
  const database = createDatabase();
  const originalReaddir = fs.readdir;
  try {
    fs.readdir = async (target, options) => {
      if (path.resolve(target) === path.resolve(root)) {
        throw Object.assign(new Error('Media root is not readable.'), { code: 'EACCES' });
      }
      return Reflect.apply(originalReaddir, fs, [target, options]);
    };

    await assert.rejects(cleanupOrphanedCourseMedia(database, root, 0), { code: 'EACCES' });
  } finally {
    fs.readdir = originalReaddir;
    database.close();
    await removeFixtureDirectory(root);
  }
});

test('orphan cleanup continues after directory errors and caps diagnostic samples', async () => {
  const root = await createFixtureDirectory();
  const database = createDatabase();
  const originalReaddir = fs.readdir;
  const courseIds = Array.from({ length: 12 }, (_, index) => (
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
  ));
  try {
    await Promise.all(courseIds.map((courseId) => fs.mkdir(path.join(root, courseId))));
    fs.readdir = async (target, options) => {
      if (path.resolve(target) !== path.resolve(root)) {
        throw Object.assign(new Error('Directory is not readable.'), { code: 'EACCES' });
      }
      return Reflect.apply(originalReaddir, fs, [target, options]);
    };

    const result = await cleanupOrphanedCourseMedia(database, root, 0);

    assert.equal(result.removed, 0);
    assert.equal(result.failed, courseIds.length);
    assert.equal(result.courseDirectoriesScanned, courseIds.length);
    assert.equal(result.directoryEntriesScanned, 0);
    assert.equal(result.failureSamples.length, 10);
    assert.ok(result.failureSamples.every((sample) => (
      sample.stage === 'read_course_directory' && sample.errorCode === 'EACCES'
    )));
  } finally {
    fs.readdir = originalReaddir;
    database.close();
    await removeFixtureDirectory(root);
  }
});

test('orphan cleanup ignores files lost to races and preserves files after inspection or removal errors', async () => {
  const root = await createFixtureDirectory();
  const database = createDatabase();
  const courseId = '123e4567-e89b-12d3-a456-426614174000';
  const courseDirectory = path.join(root, courseId);
  const disappearedName = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.txt';
  const inspectionFailureName = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.txt';
  const removalFailureName = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc.txt';
  const originalLstat = fs.lstat;
  const originalUnlink = fs.unlink;
  try {
    await fs.mkdir(courseDirectory);
    await Promise.all([disappearedName, inspectionFailureName, removalFailureName]
      .map((name) => fs.writeFile(path.join(courseDirectory, name), 'orphan')));
    const oldTime = new Date(Date.now() - 60_000);
    await Promise.all([disappearedName, inspectionFailureName, removalFailureName]
      .map((name) => fs.utimes(path.join(courseDirectory, name), oldTime, oldTime)));

    fs.lstat = async (filePath) => {
      const fileName = path.basename(filePath);
      if (fileName === disappearedName) {
        await Reflect.apply(originalUnlink, fs, [filePath]);
        throw Object.assign(new Error('File disappeared.'), { code: 'ENOENT' });
      }
      if (fileName === inspectionFailureName) {
        throw Object.assign(new Error('File cannot be inspected.'), { code: 'EACCES' });
      }
      return Reflect.apply(originalLstat, fs, [filePath]);
    };
    fs.unlink = async (filePath) => {
      if (path.basename(filePath) === removalFailureName) {
        throw Object.assign(new Error('File cannot be removed.'), { code: 'EACCES' });
      }
      return Reflect.apply(originalUnlink, fs, [filePath]);
    };

    const result = await cleanupOrphanedCourseMedia(database, root, 0);

    assert.equal(result.removed, 0);
    assert.equal(result.failed, 2);
    assert.equal(result.courseDirectoriesScanned, 1);
    assert.equal(result.directoryEntriesScanned, 3);
    assert.deepEqual(result.failureSamples.map((sample) => sample.stage).sort(), ['inspect_file', 'remove_file']);
    assert.ok(result.failureSamples.every((sample) => sample.errorCode === 'EACCES'));
    await assert.rejects(fs.stat(path.join(courseDirectory, disappearedName)), { code: 'ENOENT' });
    await fs.access(path.join(courseDirectory, inspectionFailureName));
    await fs.access(path.join(courseDirectory, removalFailureName));
  } finally {
    fs.lstat = originalLstat;
    fs.unlink = originalUnlink;
    database.close();
    await removeFixtureDirectory(root);
  }
});
