import 'dotenv/config';
import path from 'node:path';

const baseDir = process.cwd();
const dataDir = path.resolve(baseDir, process.env.DATA_DIR || './data');
const nodeEnv = process.env.NODE_ENV?.trim() || 'development';
if (!['development', 'test', 'production'].includes(nodeEnv)) {
  throw new Error('NODE_ENV must be development, test, or production.');
}
const rawTrustProxy = process.env.TRUST_PROXY?.trim().toLowerCase() || '';
if (rawTrustProxy && !['true', 'false'].includes(rawTrustProxy)) {
  throw new Error('TRUST_PROXY must be true or false.');
}
const rawPort = process.env.PORT?.trim() || '';
const port = rawPort ? Number(rawPort) : 6173;
if (rawPort && (!/^\d+$/.test(rawPort) || !Number.isSafeInteger(port) || port < 1 || port > 65_535)) {
  throw new Error('PORT must be a whole-number TCP port between 1 and 65535.');
}
const rawUploadLimit = process.env.MAX_UPLOAD_BYTES?.trim() || '';
const maxUploadBytes = rawUploadLimit ? Number(rawUploadLimit) : 2 * 1024 ** 3;
if (rawUploadLimit && (!/^\d+$/.test(rawUploadLimit) || !Number.isSafeInteger(maxUploadBytes) || maxUploadBytes <= 0)) {
  throw new Error('MAX_UPLOAD_BYTES must be a positive whole number of bytes.');
}
const rawRequestTimeout = process.env.REQUEST_TIMEOUT_MS?.trim() || '';
const requestTimeoutMs = rawRequestTimeout ? Number(rawRequestTimeout) : 300_000;
if (rawRequestTimeout && (!/^\d+$/.test(rawRequestTimeout) || !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0 || requestTimeoutMs > 2_147_483_647)) {
  throw new Error('REQUEST_TIMEOUT_MS must be a positive whole number no greater than 2147483647.');
}
const defaultSessionSecret = 'development-only-change-this-session-secret';
const exampleSessionSecret = 'change-this-to-a-random-secret-of-at-least-32-characters';
const sessionSecret = process.env.SESSION_SECRET?.trim() || defaultSessionSecret;
const setupToken = process.env.SETUP_TOKEN?.trim() || '';
if (setupToken && (setupToken.length < 32 || setupToken.length > 256)) {
  throw new Error('SETUP_TOKEN must be between 32 and 256 characters when configured.');
}

export const config = {
  nodeEnv,
  port,
  dataDir,
  dbPath: path.resolve(baseDir, process.env.DB_PATH || path.join(dataDir, 'openlearning.sqlite')),
  mediaRoot: path.resolve(baseDir, process.env.MEDIA_ROOT || path.join(dataDir, 'course-media')),
  maxUploadBytes,
  requestTimeoutMs,
  sessionSecret,
  setupToken,
  trustProxy: rawTrustProxy === 'true',
  clientDir: path.resolve(baseDir, 'dist/client'),
};

if (config.nodeEnv === 'production' && ([defaultSessionSecret, exampleSessionSecret].includes(sessionSecret) || sessionSecret.length < 32)) {
  throw new Error('Set SESSION_SECRET to a unique random value of at least 32 characters in production.');
}
