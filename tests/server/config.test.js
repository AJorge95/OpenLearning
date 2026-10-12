import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configUrl = pathToFileURL(path.join(workspaceRoot, 'server/config.js')).href;
const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearning-config-test-'));
const configEnvironmentKeys = [
  'NODE_ENV', 'PORT', 'DATA_DIR', 'DB_PATH', 'MEDIA_ROOT', 'MAX_UPLOAD_BYTES', 'REQUEST_TIMEOUT_MS',
  'SESSION_SECRET', 'SETUP_TOKEN', 'TRUST_PROXY', 'DOTENV_CONFIG_PATH', 'DOTENV_CONFIG_ENCODING',
  'DOTENV_CONFIG_DEBUG', 'DOTENV_CONFIG_OVERRIDE', 'DOTENV_KEY',
];

after(() => fs.rmSync(workingDirectory, { recursive: true, force: true }));

function loadConfig(overrides = {}) {
  const env = { ...process.env, CONFIG_MODULE_URL: configUrl };
  for (const key of configEnvironmentKeys) delete env[key];
  Object.assign(env, overrides);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { config } = await import(process.env.CONFIG_MODULE_URL);
    process.stdout.write(JSON.stringify(config));
  `], { cwd: workingDirectory, env, encoding: 'utf8' });
  return result;
}

function readConfig(overrides = {}) {
  const result = loadConfig(overrides);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout);
}

function expectConfigError(overrides, message) {
  const result = loadConfig(overrides);
  assert.notEqual(result.status, 0, `Expected config to reject ${JSON.stringify(overrides)}.`);
  assert.match(result.stderr, message);
}

test('config defaults are stable and derived paths follow DATA_DIR', () => {
  const config = readConfig({ DATA_DIR: './custom-data' });

  assert.deepEqual({
    nodeEnv: config.nodeEnv,
    port: config.port,
    dataDir: config.dataDir,
    dbPath: config.dbPath,
    mediaRoot: config.mediaRoot,
    maxUploadBytes: config.maxUploadBytes,
    requestTimeoutMs: config.requestTimeoutMs,
    trustProxy: config.trustProxy,
  }, {
    nodeEnv: 'development',
    port: 6173,
    dataDir: path.join(workingDirectory, 'custom-data'),
    dbPath: path.join(workingDirectory, 'custom-data', 'openlearning.sqlite'),
    mediaRoot: path.join(workingDirectory, 'custom-data', 'course-media'),
    maxUploadBytes: 2 * 1024 ** 3,
    requestTimeoutMs: 300_000,
    trustProxy: false,
  });
  assert.equal(readConfig({ NODE_ENV: 'test' }).nodeEnv, 'test');
});

test('built client assets resolve from the project even when launched outside it', () => {
  const config = readConfig();

  assert.equal(config.clientDir, path.join(workspaceRoot, 'dist', 'client'));
  assert.notEqual(config.clientDir, path.join(workingDirectory, 'dist', 'client'));
});

test('config accepts documented upper boundaries and normalizes a valid production setup', () => {
  const config = readConfig({
    NODE_ENV: 'production',
    PORT: '65535',
    DATA_DIR: './data',
    DB_PATH: './database/custom.sqlite',
    MEDIA_ROOT: './media',
    MAX_UPLOAD_BYTES: '9007199254740991',
    REQUEST_TIMEOUT_MS: '2147483647',
    SESSION_SECRET: 's'.repeat(32),
    SETUP_TOKEN: 't'.repeat(256),
    TRUST_PROXY: 'TRUE',
  });

  assert.equal(config.nodeEnv, 'production');
  assert.equal(config.port, 65_535);
  assert.equal(config.dataDir, path.join(workingDirectory, 'data'));
  assert.equal(config.dbPath, path.join(workingDirectory, 'database', 'custom.sqlite'));
  assert.equal(config.mediaRoot, path.join(workingDirectory, 'media'));
  assert.equal(config.maxUploadBytes, Number.MAX_SAFE_INTEGER);
  assert.equal(config.requestTimeoutMs, 2_147_483_647);
  assert.equal(config.trustProxy, true);
});

test('config rejects unsupported environment names and proxy settings', () => {
  expectConfigError({ NODE_ENV: 'prod' }, /NODE_ENV must be development, test, or production/);
  expectConfigError({ TRUST_PROXY: 'tru' }, /TRUST_PROXY must be true or false/);
});

test('config rejects ports outside the documented integer range', () => {
  for (const port of ['0', '65536', '3.5', '1e2', '123abc']) {
    expectConfigError({ PORT: port }, /PORT must be a whole-number TCP port between 1 and 65535/);
  }
});

test('config rejects invalid upload and request-timeout limits', () => {
  for (const value of ['0', '-1', '1.5', '9007199254740992']) {
    expectConfigError({ MAX_UPLOAD_BYTES: value }, /MAX_UPLOAD_BYTES must be a positive whole number of bytes/);
  }
  for (const value of ['0', '-1', '1.5', '2147483648']) {
    expectConfigError({ REQUEST_TIMEOUT_MS: value }, /REQUEST_TIMEOUT_MS must be a positive whole number no greater than 2147483647/);
  }
});

test('config bounds setup tokens and requires a unique production session secret', () => {
  expectConfigError({ SETUP_TOKEN: 't'.repeat(31) }, /SETUP_TOKEN must be between 32 and 256 characters/);
  expectConfigError({ SETUP_TOKEN: 't'.repeat(257) }, /SETUP_TOKEN must be between 32 and 256 characters/);
  expectConfigError({ NODE_ENV: 'production' }, /Set SESSION_SECRET to a unique random value of at least 32 characters in production/);
  expectConfigError({ NODE_ENV: 'production', SESSION_SECRET: 's'.repeat(31) }, /Set SESSION_SECRET to a unique random value of at least 32 characters in production/);
  expectConfigError({ NODE_ENV: 'production', SESSION_SECRET: 'development-only-change-this-session-secret' }, /Set SESSION_SECRET to a unique random value of at least 32 characters in production/);
  expectConfigError({ NODE_ENV: 'production', SESSION_SECRET: 'change-this-to-a-random-secret-of-at-least-32-characters' }, /Set SESSION_SECRET to a unique random value of at least 32 characters in production/);
});
