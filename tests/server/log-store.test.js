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
  ({ db: database } = await import('../../server/db.js'));
  logStore = await import('../../server/log-store.js');
});

after(() => {
  if (database?.open) database.close();
  removeFixtureDirectory(fixtureDirectory);
  for (const [key, value] of previousConfig) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('filtered log pages use indexes for newest-first ordering', () => {
  const auditPlan = database.prepare(`EXPLAIN QUERY PLAN SELECT id, occurred_at, actor_username, action, entity_type, entity_id, summary, details_json
    FROM audit_logs WHERE action = ? ORDER BY id DESC LIMIT ? OFFSET ?`).all('account.created', 50, 0)
    .map((step) => step.detail).join('\n');
  const systemPlan = database.prepare(`EXPLAIN QUERY PLAN SELECT id, occurred_at, level, source, message, details_json
    FROM system_logs WHERE level = ? ORDER BY id DESC LIMIT ? OFFSET ?`).all('error', 50, 0)
    .map((step) => step.detail).join('\n');

  assert.match(auditPlan, /USING INDEX audit_logs_action \(action=\?\)/);
  assert.doesNotMatch(auditPlan, /USE TEMP B-TREE FOR ORDER BY/);
  assert.match(systemPlan, /USING INDEX system_logs_level \(level=\?\)/);
  assert.doesNotMatch(systemPlan, /USE TEMP B-TREE FOR ORDER BY/);
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

test('audit retention recounts after the caller transaction rolls back a write', async () => {
  database.exec('DELETE FROM audit_logs');
  const rollbackAwareLogStore = await import('../../server/log-store.js?caller-rollback-test');
  const abortAfterAuditWrite = database.transaction(() => {
    assert.ok(rollbackAwareLogStore.writeAuditLog({ action: 'test.rolled_back', entityType: 'test', summary: 'Rolled-back audit' }));
    throw new Error('abort outer transaction');
  });
  assert.throws(abortAfterAuditWrite, /abort outer transaction/);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM audit_logs').get().count, 0);

  const seedAudit = database.prepare(`INSERT INTO audit_logs (actor_username, action, entity_type, summary)
    VALUES ('System', 'seed', 'test', ?)`);
  const seedRows = database.transaction(() => {
    for (let index = 1; index <= 10_000; index += 1) seedAudit.run(`rollback-recovery-seed-${index}`);
  });
  seedRows();
  const oldestSeedId = database.prepare('SELECT MIN(id) AS id FROM audit_logs').get().id;

  const recoveredId = rollbackAwareLogStore.writeAuditLog({
    action: 'test.after_rollback', entityType: 'test', summary: 'Retention counter recovered',
  });
  assert.ok(recoveredId);
  assert.deepEqual(
    database.prepare('SELECT COUNT(*) AS count, MIN(id) AS oldestId, MAX(id) AS newestId FROM audit_logs').get(),
    { count: 10_000, oldestId: oldestSeedId + 1, newestId: recoveredId },
  );
});

test('reuses prepared insert statements for repeated audit and system log writes', () => {
  const originalPrepare = database.prepare;
  let auditInsertPreparations = 0;
  let systemInsertPreparations = 0;
  database.prepare = (sql) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (normalized.startsWith('INSERT INTO audit_logs')) auditInsertPreparations += 1;
    if (normalized.startsWith('INSERT INTO system_logs')) systemInsertPreparations += 1;
    return originalPrepare.call(database, sql);
  };
  let auditIds;
  let systemIds;
  try {
    auditIds = [
      logStore.writeAuditLog({ action: 'test.cached_one', entityType: 'test', summary: 'Cached audit one' }),
      logStore.writeAuditLog({ action: 'test.cached_two', entityType: 'test', summary: 'Cached audit two' }),
    ];
    systemIds = [
      logStore.writeSystemLog('info', 'test', 'Cached system one'),
      logStore.writeSystemLog('info', 'test', 'Cached system two'),
    ];
  } finally {
    database.prepare = originalPrepare;
  }

  assert.ok(auditIds.every(Number.isFinite));
  assert.ok(systemIds.every(Number.isFinite));
  assert.equal(auditInsertPreparations, 0);
  assert.equal(systemInsertPreparations, 0);
});
