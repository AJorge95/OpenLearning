import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import { after, before, test } from 'node:test';

const isolatedConfig = {
  NODE_ENV: 'test',
  DATA_DIR: '',
  DB_PATH: '',
  MEDIA_ROOT: '',
  SESSION_SECRET: 'isolated-lesson-comment-moderation-tests',
  TRUST_PROXY: 'false',
  PORT: '3000',
  MAX_UPLOAD_BYTES: '2147483648',
  REQUEST_TIMEOUT_MS: '300000',
};
const previousConfig = new Map(Object.keys(isolatedConfig).map((key) => [key, process.env[key]]));
let fixtureDirectory;
let database;
let server;

function createFixtureDirectory() {
  const tempBase = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempBase, 'openlearning-comment-moderation-'));
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-comment-moderation-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolvedDirectory;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const tempBase = path.resolve(os.tmpdir());
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-comment-moderation-')) {
    throw new Error('Refusing to remove an unexpected temporary directory.');
  }
  fs.rmSync(resolvedDirectory, { recursive: true, force: true });
}

before(async () => {
  fixtureDirectory = createFixtureDirectory();
  Object.assign(process.env, {
    ...isolatedConfig,
    DATA_DIR: fixtureDirectory,
    DB_PATH: path.join(fixtureDirectory, 'openlearning.sqlite'),
    MEDIA_ROOT: path.join(fixtureDirectory, 'course-media'),
  });

  ({ db: database } = await import('../../server/db.js'));
  const [{ courseRouter }, { errorHandler }] = await Promise.all([
    import('../../server/routes-courses.js'),
    import('../../server/http.js'),
  ]);
  database.exec(`
    INSERT INTO users (id, username, password_hash, role) VALUES
      ('admin-1', 'admin', 'not-used', 'admin'),
      ('moderator-1', 'moderator', 'not-used', 'moderator'),
      ('learner-1', 'learner', 'not-used', 'learner'),
      ('learner-2', 'other-learner', 'not-used', 'learner');
    INSERT INTO courses (id, title, visibility, status, created_by, updated_by) VALUES
      ('course-public', 'Public course', 'public', 'published', 'admin-1', 'admin-1'),
      ('course-private', 'Private course', 'private', 'published', 'admin-1', 'admin-1');
    INSERT INTO course_modules (id, course_id, title, position) VALUES
      ('module-public', 'course-public', 'Public module', 0),
      ('module-private', 'course-private', 'Private module', 0);
    INSERT INTO lessons (id, module_id, title, position) VALUES
      ('lesson-public', 'module-public', 'Public lesson', 0),
      ('lesson-private', 'module-private', 'Private lesson', 0);
    INSERT INTO lesson_comments (id, lesson_id, user_id, body) VALUES
      ('comment-public', 'lesson-public', 'learner-1', 'A public course comment'),
      ('comment-private', 'lesson-private', 'learner-1', 'A private course comment');
    INSERT INTO lesson_reactions (lesson_id, user_id, reaction)
      VALUES ('lesson-public', 'learner-1', 'like');
  `);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.currentUser = database.prepare('SELECT id, username, role, disabled FROM users WHERE id = ?')
      .get(req.get('x-test-user'));
    next();
  });
  app.use('/api', courseRouter);
  app.use(errorHandler);
  server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
});

after(async () => {
  if (server?.listening) {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  }
  if (database?.open) database.close();
  removeFixtureDirectory(fixtureDirectory);
  for (const [key, value] of previousConfig) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function apiUrl(pathname) {
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}/api${pathname}`;
}

function userHeaders(userId) {
  return { 'x-test-user': userId, connection: 'close' };
}

test('course managers can review published private-course comments without learner reaction data', async () => {
  const response = await fetch(apiUrl('/lessons/lesson-private/feedback'), { headers: userHeaders('moderator-1') });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.total, 1);
  assert.deepEqual(result.comments.map(({ id, body, username }) => ({ id, body, username })), [
    { id: 'comment-private', body: 'A private course comment', username: 'learner' },
  ]);
  assert.equal(result.reaction, null);
  assert.deepEqual(result.counts, { like: 0, dislike: 0 });

  const learnerResponse = await fetch(apiUrl('/lessons/lesson-public/feedback'), { headers: userHeaders('learner-1') });
  assert.equal(learnerResponse.status, 200);
  const learnerFeedback = await learnerResponse.json();
  assert.equal(learnerFeedback.reaction, 'like');
  assert.deepEqual(learnerFeedback.counts, { like: 1, dislike: 0 });
});

test('the first feedback page reads its total alongside the comments', async () => {
  const originalPrepare = database.prepare;
  let commentQueries = 0;
  database.prepare = function countedPrepare(sql, ...args) {
    if (sql.includes('FROM lesson_comments c')) commentQueries += 1;
    return Reflect.apply(originalPrepare, this, [sql, ...args]);
  };
  let result;
  try {
    const response = await fetch(apiUrl('/lessons/lesson-public/feedback'), { headers: userHeaders('learner-1') });
    assert.equal(response.status, 200);
    result = await response.json();
  } finally {
    database.prepare = originalPrepare;
  }

  assert.equal(commentQueries, 1);
  assert.equal(result.total, 1);
  assert.deepEqual(result.comments.map(({ id }) => id), ['comment-public']);
});

test('feedback clamps an out-of-range page to the last available page', async () => {
  const response = await fetch(apiUrl('/lessons/lesson-public/feedback?page=99'), { headers: userHeaders('learner-1') });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.page, 1);
  assert.equal(result.total, 1);
  assert.deepEqual(result.comments.map(({ id }) => id), ['comment-public']);
});

test('learner feedback reads aggregate reaction counts and the learner reaction in one query', async () => {
  database.prepare("INSERT INTO lesson_reactions (lesson_id, user_id, reaction) VALUES ('lesson-public', 'learner-2', 'dislike')").run();
  const originalPrepare = database.prepare;
  let reactionQueries = 0;
  database.prepare = function countedPrepare(sql, ...args) {
    if (sql.includes('lesson_reactions')) reactionQueries += 1;
    return Reflect.apply(originalPrepare, this, [sql, ...args]);
  };
  let result;
  try {
    const response = await fetch(apiUrl('/lessons/lesson-public/feedback'), { headers: userHeaders('learner-1') });
    assert.equal(response.status, 200);
    result = await response.json();
  } finally {
    database.prepare = originalPrepare;
    database.prepare("DELETE FROM lesson_reactions WHERE lesson_id = 'lesson-public' AND user_id = 'learner-2'").run();
  }

  assert.equal(reactionQueries, 1);
  assert.equal(result.reaction, 'like');
  assert.deepEqual(result.counts, { like: 1, dislike: 1 });
});

test('learners cannot remove comments, and staff cannot post learner comments', async () => {
  const removal = await fetch(apiUrl('/lessons/lesson-public/comments/comment-public'), {
    method: 'DELETE',
    headers: userHeaders('learner-1'),
  });
  assert.equal(removal.status, 403);
  assert.equal(database.prepare('SELECT 1 FROM lesson_comments WHERE id = ?').get('comment-public') !== undefined, true);

  const post = await fetch(apiUrl('/lessons/lesson-public/comments'), {
    method: 'POST',
    headers: { ...userHeaders('moderator-1'), 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'Staff must use moderation instead.' }),
  });
  assert.equal(post.status, 403);
});

test('moderators can remove a comment and the audit entry excludes its body', async () => {
  const response = await fetch(apiUrl('/lessons/lesson-private/comments/comment-private'), {
    method: 'DELETE',
    headers: userHeaders('moderator-1'),
  });
  assert.equal(response.status, 204);
  assert.equal(database.prepare('SELECT 1 FROM lesson_comments WHERE id = ?').get('comment-private'), undefined);

  const audit = database.prepare(`SELECT actor_username, action, entity_type, entity_id, summary, details_json
    FROM audit_logs WHERE action = 'course.comment_removed'`).get();
  assert.equal(audit.actor_username, 'moderator');
  assert.equal(audit.entity_type, 'lesson_comment');
  assert.equal(audit.entity_id, 'comment-private');
  assert.match(audit.summary, /Private lesson/);
  assert.deepEqual(JSON.parse(audit.details_json), {
    courseId: 'course-private',
    courseTitle: 'Private course',
    lessonId: 'lesson-private',
    lessonTitle: 'Private lesson',
    commentAuthorId: 'learner-1',
    commentAuthorUsername: 'learner',
  });
  assert.equal(audit.summary.includes('A private course comment'), false);
  assert.equal(audit.details_json.includes('A private course comment'), false);
});

test('a failed moderation audit rolls the comment removal back', async () => {
  const auditCount = database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.comment_removed'").get().count;
  database.exec(`CREATE TRIGGER reject_comment_moderation_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'course.comment_removed' BEGIN SELECT RAISE(FAIL, 'audit storage unavailable'); END;`);
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const response = await fetch(apiUrl('/lessons/lesson-public/comments/comment-public'), {
      method: 'DELETE',
      headers: userHeaders('admin-1'),
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: 'The comment could not be removed because the audit log is unavailable.',
      code: 'audit_unavailable',
    });
    assert.equal(database.prepare('SELECT 1 FROM lesson_comments WHERE id = ?').get('comment-public') !== undefined, true);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'course.comment_removed'").get().count, auditCount);
  } finally {
    console.error = originalConsoleError;
    database.exec('DROP TRIGGER reject_comment_moderation_audit');
  }
});

test('a comment from another lesson cannot be removed through the wrong lesson route', async () => {
  const response = await fetch(apiUrl('/lessons/lesson-private/comments/comment-public'), {
    method: 'DELETE',
    headers: userHeaders('admin-1'),
  });
  assert.equal(response.status, 404);
  assert.equal(database.prepare('SELECT 1 FROM lesson_comments WHERE id = ?').get('comment-public') !== undefined, true);
});

test('learners without access cannot read private-course comments', async () => {
  const response = await fetch(apiUrl('/lessons/lesson-private/feedback'), { headers: userHeaders('learner-2') });
  assert.equal(response.status, 403);
});

test('an empty first feedback page reports zero comments and stays on page one', async () => {
  const response = await fetch(apiUrl('/lessons/lesson-private/feedback'), { headers: userHeaders('moderator-1') });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.page, 1);
  assert.equal(result.total, 0);
  assert.deepEqual(result.comments, []);
});

test('posting a comment returns its row and updated total in one read', async () => {
  const originalPrepare = database.prepare;
  let commentQueries = 0;
  let commentId;
  database.prepare = function countedPrepare(sql, ...args) {
    if (sql.includes('lesson_comments')) commentQueries += 1;
    return Reflect.apply(originalPrepare, this, [sql, ...args]);
  };
  let result;
  try {
    const response = await fetch(apiUrl('/lessons/lesson-public/comments'), {
      method: 'POST',
      headers: { ...userHeaders('learner-1'), 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'A newly posted comment' }),
    });
    assert.equal(response.status, 201);
    result = await response.json();
    commentId = result.comment.id;
  } finally {
    database.prepare = originalPrepare;
    if (commentId) database.prepare('DELETE FROM lesson_comments WHERE id = ?').run(commentId);
  }

  assert.equal(commentQueries, 2);
  assert.equal(result.comment.body, 'A newly posted comment');
  assert.equal(result.total, 2);
});
