import { randomUUID } from 'node:crypto';
import { db, setting } from './db.js';
import { courseSummaries, courseSummary } from './course-service.js';
import { logicalCourseId, publishedVersionForLogicalCourse } from './course-versioning.js';

const certificateBatchSize = 200;

export function certificatePayload(row) {
  return {
    id: row.id,
    courseId: row.course_id,
    courseVersionId: row.course_version_id ?? null,
    certificateCode: row.certificate_code,
    recipientName: row.recipient_name,
    recipientEmail: row.recipient_email ?? '',
    courseTitle: row.course_title,
    platformName: row.platform_name,
    issuedAt: row.issued_at,
  };
}

export function findCourseCertificate(courseId, userId, versionId) {
  const logicalId = logicalCourseId(courseId) || courseId;
  const currentVersionId = versionId ?? publishedVersionForLogicalCourse(logicalId)?.id ?? null;
  return findCertificateForVersion(logicalId, userId, currentVersionId);
}

function findCertificateForVersion(courseId, userId, versionId) {
  return db.prepare(`SELECT * FROM course_certificates WHERE course_id = ? AND user_id = ?
    AND (course_version_id = ? OR (? IS NULL AND course_version_id IS NULL)) ORDER BY issued_at DESC LIMIT 1`)
    .get(courseId, userId, versionId, versionId);
}

function saveCertificate(course, account, versionId) {
  const id = randomUUID();
  const code = `OL-${randomUUID().replaceAll('-', '').toUpperCase()}`;
  db.prepare(`INSERT OR IGNORE INTO course_certificates
      (id, certificate_code, user_id, course_id, course_version_id, recipient_name, recipient_email, course_title, platform_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, code, account.id, course.id, versionId,
      `${account.first_name.trim()} ${account.last_name.trim()}`, account.email || '', course.title,
      setting('platform_name') || 'OpenLearning');
  const issued = findCertificateForVersion(course.id, account.id, versionId);
  return issued ? certificatePayload(issued) : null;
}

export function issueCertificateIfComplete(courseId, user) {
  if (user.role !== 'learner') return null;
  const logicalId = logicalCourseId(courseId) || courseId;
  const version = publishedVersionForLogicalCourse(logicalId);
  const versionId = version?.id ?? null;
  const existing = findCertificateForVersion(logicalId, user.id, versionId);
  if (existing) return certificatePayload(existing);
  const account = db.prepare('SELECT id, username, email, first_name, last_name, role FROM users WHERE id = ?').get(user.id);
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(logicalId);
  if (!account || !account.first_name?.trim() || !account.last_name?.trim()
      || !course || course.status !== 'published' || !courseSummary(course, user).completed) return null;
  return saveCertificate(course, account, versionId);
}

export function issueCompletedCertificatesForUser(userId) {
  const user = db.prepare('SELECT id, role, first_name, last_name, email FROM users WHERE id = ?').get(userId);
  if (!user || user.role !== 'learner' || !user.first_name?.trim() || !user.last_name?.trim()) return [];
  const courseCandidates = `SELECT * FROM courses c
    WHERE c.status = 'published' AND c.logical_course_id IS NULL AND c.id IN (
      SELECT COALESCE(storage.logical_course_id, storage.id)
      FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id
      JOIN course_modules m ON m.id = l.module_id JOIN courses storage ON storage.id = m.course_id
      WHERE p.user_id = ?
      UNION
      SELECT COALESCE(storage.logical_course_id, storage.id)
      FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id
      JOIN course_modules m ON m.id = q.module_id JOIN courses storage ON storage.id = m.course_id
      WHERE a.user_id = ? AND a.passed = 1
    )`;
  const firstCourseBatch = db.prepare(`${courseCandidates} ORDER BY c.id LIMIT ?`);
  let nextCourseBatch;
  const newlyIssued = [];
  let lastCourseId = null;
  while (true) {
    // Page candidates too, so a learner's full course history is never loaded at once.
    const batch = lastCourseId === null
      ? firstCourseBatch.all(userId, userId, certificateBatchSize)
      : (nextCourseBatch ??= db.prepare(`${courseCandidates} AND c.id > ? ORDER BY c.id LIMIT ?`))
        .all(userId, userId, lastCourseId, certificateBatchSize);
    if (batch.length === 0) break;
    lastCourseId = batch[batch.length - 1].id;
    const courseIds = batch.map((course) => course.id);
    const placeholders = courseIds.map(() => '?').join(', ');
    const versions = new Map(db.prepare(`SELECT v.course_id, v.id
      FROM course_versions v
      JOIN (
        SELECT course_id, MAX(version_number) AS version_number
        FROM course_versions WHERE course_id IN (${placeholders}) GROUP BY course_id
      ) latest ON latest.course_id = v.course_id AND latest.version_number = v.version_number`)
      .all(...courseIds).map((version) => [version.course_id, version.id]));
    const existingByCourse = new Map();
    for (const certificate of db.prepare(`SELECT course_id, course_version_id FROM course_certificates
      WHERE user_id = ? AND course_id IN (${placeholders})`).all(userId, ...courseIds)) {
      const versionsForCourse = existingByCourse.get(certificate.course_id) ?? new Set();
      versionsForCourse.add(certificate.course_version_id ?? null);
      existingByCourse.set(certificate.course_id, versionsForCourse);
    }
    const candidates = batch.filter((course) => !existingByCourse.get(course.id)?.has(versions.get(course.id) ?? null));
    const summaries = courseSummaries(candidates, user);
    for (let index = 0; index < candidates.length; index += 1) {
      if (!summaries[index].completed) continue;
      const certificate = saveCertificate(candidates[index], user, versions.get(candidates[index].id) ?? null);
      if (certificate) newlyIssued.push(certificate);
    }
  }
  return newlyIssued;
}
