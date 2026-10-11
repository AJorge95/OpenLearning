import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import Database from 'better-sqlite3';

const isolatedConfig = {
  NODE_ENV: 'test', DATA_DIR: '', DB_PATH: '', MEDIA_ROOT: '',
  SESSION_SECRET: 'isolated-platform-reset-tests', TRUST_PROXY: 'false', PORT: '3000',
  MAX_UPLOAD_BYTES: '2147483648', REQUEST_TIMEOUT_MS: '300000',
};
const previousConfig = new Map(Object.keys(isolatedConfig).map((key) => [key, process.env[key]]));
let fixtureDirectory;
let database;
let settings;
let reset;
let ApiError;
let writeAuditLog;
let writeSystemLog;
let actor;

function createFixtureDirectory() {
  const tempBase = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempBase, 'openlearning-platform-reset-'));
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== tempBase || !path.basename(resolved).startsWith('openlearning-platform-reset-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolved;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const tempBase = path.resolve(os.tmpdir());
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== tempBase || !path.basename(resolved).startsWith('openlearning-platform-reset-')) {
    throw new Error('Refusing to remove an unexpected temporary directory.');
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function assertApiError(action, status, code) {
  assert.throws(action, (error) => error instanceof ApiError && error.status === status && error.code === code);
}

async function assertApiErrorAsync(action, status, code) {
  await assert.rejects(action, (error) => error instanceof ApiError && error.status === status && error.code === code);
}

function seedBaseline() {
  database.exec(`
    INSERT OR IGNORE INTO users (id, username, password_hash, role)
      VALUES ('reset-admin', 'reset_admin', 'not-used', 'admin');
    INSERT OR IGNORE INTO users (id, username, password_hash, role)
      VALUES ('reset-learner', 'reset_learner', 'not-used', 'learner');
    INSERT OR IGNORE INTO courses (id, title, status, created_by, updated_by)
      VALUES ('reset-course', 'Reset fixture course', 'published', 'reset-admin', 'reset-admin');
    INSERT OR IGNORE INTO course_modules (id, course_id, title, position)
      VALUES ('reset-module', 'reset-course', 'Reset fixture module', 0);
    INSERT OR IGNORE INTO lessons (id, module_id, title, position)
      VALUES ('reset-lesson', 'reset-module', 'Reset fixture lesson', 0);
    INSERT OR REPLACE INTO sessions (sid, session_data, expires_at, user_id)
      VALUES ('reset-admin-session', '{"userId":"reset-admin"}', 4102444800000, 'reset-admin');
    INSERT OR REPLACE INTO sessions (sid, session_data, expires_at, user_id)
      VALUES ('reset-learner-session', '{"userId":"reset-learner"}', 4102444800000, 'reset-learner');
  `);
  settings.setSetting('setup_complete', '1');
  settings.setSetting('platform_name', 'Reset fixture platform');
  settings.setSetting('theme_palette', 'blue');
  settings.setSetting('connection_protocol', 'https');
  settings.setSetting('registration_enabled', '0');
  settings.setSetting('user_limit', '25');
  settings.setSetting('registration_fields', '[{"id":"department"}]');
  writeAuditLog({ actor, action: 'reset.fixture', entityType: 'platform', summary: 'Existing audit entry' });
  writeSystemLog('info', 'reset-test', 'Existing system entry');
}

before(async () => {
  fixtureDirectory = createFixtureDirectory();
  Object.assign(process.env, {
    ...isolatedConfig,
    DATA_DIR: fixtureDirectory,
    DB_PATH: path.join(fixtureDirectory, 'openlearning.sqlite'),
    MEDIA_ROOT: path.join(fixtureDirectory, 'course-media'),
  });

  settings = await import('../../server/db.js');
  database = settings.db;
  ({ ApiError } = await import('../../server/http.js'));
  ({ writeAuditLog, writeSystemLog } = await import('../../server/log-store.js'));
  reset = await import('../../server/platform-reset.js');
  actor = { id: 'reset-admin', username: 'reset_admin', role: 'admin' };
});

beforeEach(async () => {
  reset.finishPlatformReset();
  database.exec('DELETE FROM audit_logs; DELETE FROM system_logs;');
  seedBaseline();
  await fs.promises.rm(process.env.MEDIA_ROOT, { recursive: true, force: true });
  await fs.promises.mkdir(process.env.MEDIA_ROOT, { recursive: true });
  await fs.promises.writeFile(path.join(process.env.MEDIA_ROOT, 'lesson-video.mp4'), 'fixture-media');
});

after(() => {
  reset?.finishPlatformReset();
  if (database?.open) database.close();
  removeFixtureDirectory(fixtureDirectory);
  for (const [key, value] of previousConfig) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('reset preparation drains active requests and blocks new API and media requests', async () => {
  const listeners = new Map();
  const activeResponse = {
    once(event, callback) { listeners.set(event, callback); return this; },
  };
  let activeRequestContinued = false;
  reset.platformResetGate({ path: '/api/courses' }, activeResponse, () => { activeRequestContinued = true; });
  assert.equal(activeRequestContinued, true);

  let preparationSettled = false;
  const preparation = reset.preparePlatformReset(actor).then((state) => {
    preparationSettled = true;
    return state;
  });
  try {
    await Promise.resolve();
    assert.equal(preparationSettled, false);
    assert.equal(reset.getPlatformResetStatus(actor.id).phase, 'preparing');

    for (const pathname of ['/api/courses', '/media/course/video.mp4']) {
      let continued = false;
      const blockedResponse = {
        statusCode: 200,
        payload: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.payload = payload; return this; },
      };
      reset.platformResetGate({ path: pathname }, blockedResponse, () => { continued = true; });
      assert.equal(continued, false);
      assert.equal(blockedResponse.statusCode, 503);
      assert.equal(blockedResponse.payload.code, 'platform_reset_in_progress');
    }

    listeners.get('finish')();
    const prepared = await preparation;
    assert.equal(prepared.phase, 'ready');
    reset.cancelPlatformReset(actor, prepared.confirmationId);
  } finally {
    listeners.get('finish')?.();
    await preparation.catch(() => null);
    const state = reset.getPlatformResetStatus(actor.id);
    if (state.phase === 'ready') reset.cancelPlatformReset(actor, state.confirmationId);
  }
});

test('reset preparation verifies a restorable backup and cancellation preserves platform data', async () => {
  const prepared = await reset.preparePlatformReset(actor);
  assert.equal(prepared.pending, true);
  assert.equal(prepared.phase, 'ready');
  assert.equal(reset.isPlatformResetActive(), true);
  assert.deepEqual(reset.getPlatformResetStatus('another-admin'), { pending: true, phase: 'ready' });

  const backupDirectory = path.join(fixtureDirectory, prepared.backupLocation);
  const manifest = JSON.parse(await fs.promises.readFile(path.join(backupDirectory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.mediaFileCount, 1);
  assert.equal(manifest.mediaBytes, Buffer.byteLength('fixture-media'));
  assert.equal(await fs.promises.readFile(path.join(backupDirectory, 'course-media', 'lesson-video.mp4'), 'utf8'), 'fixture-media');
  const backupDatabase = new Database(path.join(backupDirectory, 'openlearning.sqlite'), { readonly: true, fileMustExist: true });
  try {
    assert.ok(backupDatabase.pragma('quick_check').every((row) => row.quick_check === 'ok'));
    assert.equal(backupDatabase.prepare('SELECT 1 FROM courses WHERE id = ?').get('reset-course') !== undefined, true);
  } finally {
    backupDatabase.close();
  }

  assert.deepEqual(reset.cancelPlatformReset(actor, prepared.confirmationId), {
    canceled: true,
    backupLocation: prepared.backupLocation,
  });
  assert.equal(reset.isPlatformResetActive(), false);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users').get().count, 2);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM courses').get().count, 1);
  assert.equal(await fs.promises.readFile(path.join(process.env.MEDIA_ROOT, 'lesson-video.mp4'), 'utf8'), 'fixture-media');
  assert.equal(fs.existsSync(backupDirectory), true);
});

test('reset confirmation requires the exact phrase and retains only the administrator and logs', async () => {
  const prepared = await reset.preparePlatformReset(actor);
  await assertApiErrorAsync(() => reset.confirmPlatformReset(actor, prepared.confirmationId, 'reset'), 400, 'platform_reset_confirmation_phrase');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM courses').get().count, 1);
  assert.equal(reset.isPlatformResetActive(), true);

  const result = await reset.confirmPlatformReset(actor, prepared.confirmationId, 'RESET');
  assert.equal(result.reset, true);
  assert.equal(result.backupLocation, prepared.backupLocation);
  assert.equal(database.prepare('SELECT id FROM users').get().id, actor.id);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM courses').get().count, 0);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'reset.fixture'").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'platform.reset'").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM system_logs WHERE source = 'reset-test'").get().count, 1);
  assert.equal(settings.setting('platform_name'), '');
  assert.equal(settings.setting('theme_palette'), 'violet');
  assert.equal(settings.setting('connection_protocol'), 'http');
  assert.equal(settings.setting('registration_enabled'), '1');
  assert.equal(settings.setting('user_limit'), '0');
  assert.equal(settings.setting('registration_fields'), '[]');
  assert.deepEqual(await fs.promises.readdir(process.env.MEDIA_ROOT), []);
  assert.equal(fs.existsSync(path.join(fixtureDirectory, result.backupLocation, 'manifest.json')), true);
  assert.equal(reset.isPlatformResetActive(), true);
  reset.finishPlatformReset();
  assert.equal(reset.isPlatformResetActive(), false);
});

test('only one administrator confirmation can reset a prepared platform', async () => {
  const prepared = await reset.preparePlatformReset(actor);
  const confirmation = reset.confirmPlatformReset(actor, prepared.confirmationId, 'RESET');

  assert.equal(reset.getPlatformResetStatus(actor.id).phase, 'resetting');
  await assertApiErrorAsync(
    () => reset.confirmPlatformReset(actor, prepared.confirmationId, 'RESET'),
    409,
    'platform_reset_confirmation_invalid',
  );
  assertApiError(
    () => reset.cancelPlatformReset(actor, prepared.confirmationId),
    409,
    'platform_reset_confirmation_invalid',
  );

  const result = await confirmation;
  assert.equal(result.reset, true);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM courses').get().count, 0);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
  reset.finishPlatformReset();
});

test('a reset transaction failure restores the original media and leaves database rows intact', async () => {
  const prepared = await reset.preparePlatformReset(actor);
  database.exec(`CREATE TRIGGER fail_platform_reset_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'platform.reset' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;`);
  const originalConsoleError = console.error;
  console.error = (message, ...details) => {
    if (message === 'Unable to persist audit entry:' && details[0] === 'fixture failure') return;
    originalConsoleError(message, ...details);
  };
  try {
    await assertApiErrorAsync(() => reset.confirmPlatformReset(actor, prepared.confirmationId, 'RESET'), 500, 'audit_unavailable');
  } finally {
    console.error = originalConsoleError;
    database.exec('DROP TRIGGER fail_platform_reset_audit;');
  }

  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users').get().count, 2);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM courses').get().count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 2);
  assert.equal(await fs.promises.readFile(path.join(process.env.MEDIA_ROOT, 'lesson-video.mp4'), 'utf8'), 'fixture-media');
  assert.equal(reset.isPlatformResetActive(), false);
  assert.equal(fs.existsSync(path.join(fixtureDirectory, prepared.backupLocation, 'manifest.json')), true);
});

test('backup path checks resolve a symlinked media root before checking overlap', async (t) => {
  const mediaTarget = process.env.MEDIA_ROOT;
  const mediaAlias = path.join(fixtureDirectory, 'media-root-alias');
  try {
    await fs.promises.symlink(mediaTarget, mediaAlias, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'EINVAL'].includes(error.code)) {
      t.skip(`Directory symlinks are unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  await assert.rejects(
    reset.assertResetBackupPathsSafe({
      mediaRoot: mediaAlias,
      databasePath: process.env.DB_PATH,
      backupDirectory: path.join(mediaTarget, 'unsafe-backup'),
    }),
    /backup location overlaps the course media directory/,
  );
});

test('backup path checks resolve a database path through a symlinked media directory', async (t) => {
  const databaseTarget = path.join(process.env.MEDIA_ROOT, 'database.sqlite');
  const mediaAlias = path.join(fixtureDirectory, 'database-media-alias');
  const backupParent = path.join(fixtureDirectory, 'safe-backup-parent');
  await fs.promises.copyFile(process.env.DB_PATH, databaseTarget);
  await fs.promises.mkdir(backupParent, { recursive: true });
  try {
    await fs.promises.symlink(process.env.MEDIA_ROOT, mediaAlias, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'EINVAL'].includes(error.code)) {
      t.skip(`Directory symlinks are unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  await assert.rejects(
    reset.assertResetBackupPathsSafe({
      mediaRoot: process.env.MEDIA_ROOT,
      databasePath: path.join(mediaAlias, 'database.sqlite'),
      backupDirectory: path.join(backupParent, 'platform-reset'),
    }),
    /database path is inside the course media directory/,
  );
});

test('reset clears the target of a symlinked media root and keeps the configured link usable', async (t) => {
  const configuredMediaPath = process.env.MEDIA_ROOT;
  const mediaTarget = path.join(fixtureDirectory, 'course-media-target');
  await fs.promises.rename(configuredMediaPath, mediaTarget);
  try {
    await fs.promises.symlink(mediaTarget, configuredMediaPath, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    await fs.promises.rename(mediaTarget, configuredMediaPath);
    if (['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'EINVAL'].includes(error.code)) {
      t.skip(`Directory symlinks are unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  const prepared = await reset.preparePlatformReset(actor);
  const result = await reset.confirmPlatformReset(actor, prepared.confirmationId, 'RESET');
  assert.equal(await fs.promises.readFile(path.join(fixtureDirectory, result.backupLocation, 'course-media', 'lesson-video.mp4'), 'utf8'), 'fixture-media');
  assert.equal(fs.lstatSync(configuredMediaPath).isSymbolicLink(), true);
  assert.equal(await fs.promises.realpath(configuredMediaPath), await fs.promises.realpath(mediaTarget));
  assert.deepEqual(await fs.promises.readdir(mediaTarget), []);
  reset.finishPlatformReset();
});
