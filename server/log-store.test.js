import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const isolatedConfig = {
  NODE_ENV: 'test',
  DATA_DIR: '',
  DB_PATH: '',
  MEDIA_ROOT: '',
  SESSION_SECRET: 'isolated-log-store-tests-use-a-local-secret',
  TRUST_PROXY: 'false',
  PORT: '3000',
  MAX_UPLOAD_BYTES: '2147483648',
  REQUEST_TIMEOUT_MS: '300000',
};
const previousConfig = new Map(Object.keys(isolatedConfig).map((key) => [key, process.env[key]]));
let fixtureDirectory;
let database;
let logStore;

function createFixtureDirectory() {
  const tempBase = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempBase, 'openlearning-log-store-'));
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-log-store-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolvedDirectory;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const tempBase = path.resolve(os.tmpdir());
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-log-store-')) {
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
  ({ db: database } = await import('./db.js'));
  logStore = await import('./log-store.js');
});

after(() => {
  if (database?.open) database.close();
  removeFixtureDirectory(fixtureDirectory);
  for (const [key, value] of previousConfig) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('log writes redact credentials and retain only the newest configured rows', () => {
  const seedAudit = database.prepare(`INSERT INTO audit_logs (actor_username, action, entity_type, summary)
    VALUES ('System', 'seed', 'test', ?)`);
  const seedSystem = database.prepare(`INSERT INTO system_logs (level, source, message)
    VALUES ('info', 'seed', ?)`);
  const seedRows = database.transaction(() => {
    for (let index = 1; index <= 10_003; index += 1) seedAudit.run(`seed-audit-${index}`);
    for (let index = 1; index <= 5_003; index += 1) seedSystem.run(`seed-system-${index}`);
  });
  seedRows();

  const auditId = logStore.writeAuditLog({
    action: 'test.latest', entityType: 'test', summary: 'Newest audit event',
    details: { password: 'audit-sensitive-password', result: 'saved' },
  });
  const systemId = logStore.writeSystemLog(
    'error',
    'test',
    'Authorization: Bearer sensitive-auth-token; password=sensitive-password',
    { apiKey: 'sensitive-api-key', note: 'token=sensitive-detail-token' },
  );

  assert.equal(auditId, 10_004);
  assert.equal(systemId, 5_004);
  assert.deepEqual(
    database.prepare('SELECT COUNT(*) AS count, MIN(id) AS oldestId, MAX(id) AS newestId FROM audit_logs').get(),
    { count: 10_000, oldestId: 5, newestId: auditId },
  );
  assert.deepEqual(
    database.prepare('SELECT COUNT(*) AS count, MIN(id) AS oldestId, MAX(id) AS newestId FROM system_logs').get(),
    { count: 5_000, oldestId: 5, newestId: systemId },
  );

  const auditDetails = JSON.parse(database.prepare('SELECT details_json FROM audit_logs WHERE id = ?').get(auditId).details_json);
  const systemEntry = database.prepare('SELECT message, details_json FROM system_logs WHERE id = ?').get(systemId);
  const systemDetails = JSON.parse(systemEntry.details_json);
  assert.equal(auditDetails.password, '[redacted]');
  assert.equal(auditDetails.result, 'saved');
  assert.doesNotMatch(systemEntry.message, /sensitive-auth-token|sensitive-password/);
  assert.equal(systemDetails.apiKey, '[redacted]');
  assert.match(systemDetails.note, /\[redacted\]/);
  assert.doesNotMatch(systemEntry.details_json, /sensitive-api-key|sensitive-detail-token/);
});
