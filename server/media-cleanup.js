import fs from 'node:fs/promises';
import path from 'node:path';

const courseDirectoryPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const generatedUploadPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(?:mp4|jpe?g|png|webp|pdf|txt|md|rtf|docx?|pptx?|xlsx?|csv|tsv|odt|odp|ods|vtt)$/i;
const maxFailureSamples = 10;

export async function cleanupOrphanedCourseMedia(database, mediaRoot, minAgeMs) {
  if (!Number.isSafeInteger(minAgeMs) || minAgeMs < 0) throw new TypeError('Media cleanup age must be a non-negative safe integer.');

  const referencedFiles = new Map();
  const rows = database.prepare(`
    SELECT course_id, file_name FROM media_files
    UNION ALL
    SELECT m.course_id, lr.file_name
    FROM lesson_resources lr
    JOIN lessons l ON l.id = lr.lesson_id
    JOIN course_modules m ON m.id = l.module_id
    WHERE lr.resource_type = 'document' AND lr.file_name IS NOT NULL
    UNION ALL
    SELECT m.course_id, lc.file_name
    FROM lesson_captions lc
    JOIN lessons l ON l.id = lc.lesson_id
    JOIN course_modules m ON m.id = l.module_id
  `).all();
  for (const row of rows) {
    if (typeof row.course_id !== 'string' || typeof row.file_name !== 'string') continue;
    const files = referencedFiles.get(row.course_id) ?? new Set();
    files.add(row.file_name);
    referencedFiles.set(row.course_id, files);
  }

  const root = path.resolve(mediaRoot);
  let directories;
  try {
    directories = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return { removed: 0, failed: 0, failureSamples: [] };
    throw error;
  }

  const cutoff = Date.now() - minAgeMs;
  let removed = 0;
  let failed = 0;
  const failureSamples = [];
  const recordFailure = (stage, courseId, fileName, error) => {
    failed++;
    if (failureSamples.length >= maxFailureSamples) return;
    failureSamples.push({
      stage,
      courseId,
      ...(fileName ? { fileName } : {}),
      errorName: String(error?.name || 'Error').slice(0, 100),
      ...(typeof error?.code === 'string' ? { errorCode: error.code.slice(0, 100) } : {}),
    });
  };

  for (const directory of directories) {
    if (!directory.isDirectory() || !courseDirectoryPattern.test(directory.name)) continue;
    const courseDirectory = path.join(root, directory.name);
    let files;
    try {
      files = await fs.readdir(courseDirectory, { withFileTypes: true });
    } catch (error) {
      recordFailure('read_course_directory', directory.name, null, error);
      continue;
    }
    const referenced = referencedFiles.get(directory.name) ?? new Set();
    for (const file of files) {
      if (!file.isFile() || !generatedUploadPattern.test(file.name) || referenced.has(file.name)) continue;
      const filePath = path.join(courseDirectory, file.name);
      let stats;
      try {
        stats = await fs.lstat(filePath);
      } catch (error) {
        if (error?.code !== 'ENOENT') recordFailure('inspect_file', directory.name, file.name, error);
        continue;
      }
      if (!stats.isFile() || stats.mtimeMs > cutoff) continue;
      try {
        await fs.unlink(filePath);
        removed++;
      } catch (error) {
        if (error?.code !== 'ENOENT') recordFailure('remove_file', directory.name, file.name, error);
      }
    }
  }
  return { removed, failed, failureSamples };
}
