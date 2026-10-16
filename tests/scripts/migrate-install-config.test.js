import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const helperPath = fileURLToPath(new URL('../../scripts/migrate-install-config.js', import.meta.url));
const tempBase = path.resolve(os.tmpdir());

function withFixture(run) {
  const directory = fs.mkdtempSync(path.join(tempBase, 'openlearning-install-config-'));
  const root = path.resolve(directory);
  if (path.dirname(root) !== tempBase || !path.basename(root).startsWith('openlearning-install-config-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  try { run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function migrate(root, source, portOverride = '') {
  const sourcePath = path.join(root, 'legacy.env');
  const targetPath = path.join(root, 'new', '.env');
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(sourcePath, source);
  const result = spawnSync(process.execPath, [helperPath], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      OLD_WORKING_DIRECTORY: '/opt/openlearning/current',
      OLD_ENV_FILE: sourcePath,
      NEW_ENV_FILE: targetPath,
      INSTALL_PORT_OVERRIDE: portOverride,
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return fs.readFileSync(targetPath, 'utf8');
}

test('legacy installer configuration gains the new backup path without losing existing settings', () => {
  withFixture((root) => {
    const migrated = migrate(root, 'DATA_DIR=../data\nSESSION_SECRET=existing-secret\nPORT=7443\nCUSTOM_SETTING=kept\n');
    const values = Object.fromEntries(migrated.trim().split('\n').map((line) => {
      const [key, value] = line.split('=');
      return [key, JSON.parse(value)];
    }));
    assert.equal(values.DATA_DIR, '/opt/openlearning/data');
    assert.equal(values.DB_PATH, '/opt/openlearning/data/openlearning.sqlite');
    assert.equal(values.MEDIA_ROOT, '/opt/openlearning/data/course-media');
    assert.equal(values.BACKUP_DIR, '/var/backups/openlearning');
    assert.equal(values.SESSION_SECRET, 'existing-secret');
    assert.equal(values.PORT, '7443');
    assert.equal(values.CUSTOM_SETTING, 'kept');
  });
});

test('an explicit installer port override replaces a saved port while preserving other settings', () => {
  withFixture((root) => {
    const migrated = migrate(root, 'DATA_DIR=/var/lib/openlearning\nSESSION_SECRET=existing-secret\nPORT=6173\nCUSTOM_SETTING=kept\n', '5173');
    const values = Object.fromEntries(migrated.trim().split('\n').map((line) => {
      const [key, value] = line.split('=');
      return [key, JSON.parse(value)];
    }));
    assert.equal(values.PORT, '5173');
    assert.equal(values.CUSTOM_SETTING, 'kept');
    assert.equal(values.SESSION_SECRET, 'existing-secret');
  });
});

test('installer port migration rejects invalid overrides', () => {
  withFixture((root) => {
    const sourcePath = path.join(root, 'legacy.env');
    const targetPath = path.join(root, 'new', '.env');
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(sourcePath, 'SESSION_SECRET=existing-secret\n');
    const result = spawnSync(process.execPath, [helperPath], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        OLD_WORKING_DIRECTORY: '/opt/openlearning/current',
        OLD_ENV_FILE: sourcePath,
        NEW_ENV_FILE: targetPath,
        INSTALL_PORT_OVERRIDE: '70000',
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /INSTALL_PORT_OVERRIDE must be a whole-number TCP port/);
    assert.equal(fs.existsSync(targetPath), false);
  });
});

test('installer preserves a legacy relative backup directory relative to its original service directory', () => {
  withFixture((root) => {
    const migrated = migrate(root, 'DATA_DIR=/var/lib/openlearning\nBACKUP_DIR=old-backups\nSESSION_SECRET=existing-secret\n');
    const backupLine = migrated.split('\n').find((line) => line.startsWith('BACKUP_DIR='));
    assert.equal(JSON.parse(backupLine.slice('BACKUP_DIR='.length)), '/opt/openlearning/current/old-backups');
  });
});
