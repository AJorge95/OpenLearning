import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { secureProductionRuntimePermissions } from '../../server/production-permissions.js';

test('source startup applies production permissions before importing the server', () => {
  const startScript = fs.readFileSync(new URL('../../scripts/start.js', import.meta.url), 'utf8');
  const permissionCall = startScript.indexOf('secureProductionRuntimePermissions();');
  const serverImport = startScript.indexOf("await import('../server/index.js');");

  assert.notEqual(permissionCall, -1);
  assert.ok(serverImport > permissionCall);
});

test('production startup sets a private umask and tightens a regular dotenv file', () => {
  const calls = [];
  const fileSystem = {
    lstatSync(filePath) {
      calls.push(['lstat', filePath]);
      return { mode: 0o100644, isFile: () => true };
    },
    chmodSync(filePath, mode) {
      calls.push(['chmod', filePath, mode]);
    },
  };
  const cwd = path.resolve('private-source-run');
  const dotenvPath = path.join(cwd, '.env');

  secureProductionRuntimePermissions({
    nodeEnv: 'production', cwd, platform: 'linux',
    fileSystem, setUmask: (mask) => calls.push(['umask', mask]),
  });

  assert.deepEqual(calls, [
    ['umask', 0o077],
    ['lstat', dotenvPath],
    ['chmod', dotenvPath, 0o600],
  ]);
});

test('non-production and Windows startup do not change permissions', () => {
  const unexpectedCall = () => assert.fail('permission handling should be skipped');
  for (const options of [
    { nodeEnv: 'development', platform: 'linux' },
    { nodeEnv: 'production', platform: 'win32' },
  ]) {
    secureProductionRuntimePermissions({ ...options, fileSystem: { lstatSync: unexpectedCall }, setUmask: unexpectedCall });
  }
});

test('production startup ignores a missing dotenv file but keeps the private umask', () => {
  const calls = [];
  const fileSystem = {
    lstatSync() {
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    },
    chmodSync: () => assert.fail('a missing dotenv file cannot be chmodded'),
  };

  secureProductionRuntimePermissions({
    nodeEnv: 'production', platform: 'linux', fileSystem,
    setUmask: (mask) => calls.push(mask),
  });

  assert.deepEqual(calls, [0o077]);
});

test('production startup leaves externally managed dotenv paths to the operator', () => {
  const calls = [];
  secureProductionRuntimePermissions({
    nodeEnv: 'production', platform: 'linux', dotenvConfigPath: '/run/secrets/openlearning.env',
    fileSystem: { lstatSync: () => assert.fail('external secret paths are not changed') },
    setUmask: (mask) => calls.push(mask),
  });

  assert.deepEqual(calls, [0o077]);
});

test('production startup does not chmod symlink targets and surfaces permission errors', () => {
  let chmodCalled = false;
  const symlinkFileSystem = {
    lstatSync: () => ({ mode: 0o120777, isFile: () => false }),
    chmodSync: () => { chmodCalled = true; },
  };
  secureProductionRuntimePermissions({
    nodeEnv: 'production', platform: 'linux', fileSystem: symlinkFileSystem, setUmask: () => {},
  });
  assert.equal(chmodCalled, false);

  const expectedError = Object.assign(new Error('permission denied'), { code: 'EPERM' });
  assert.throws(() => secureProductionRuntimePermissions({
    nodeEnv: 'production', platform: 'linux',
    fileSystem: { lstatSync: () => ({ mode: 0o100644, isFile: () => true }), chmodSync: () => { throw expectedError; } },
    setUmask: () => {},
  }), expectedError);
});
