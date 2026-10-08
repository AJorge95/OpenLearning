import 'dotenv/config';
import path from 'node:path';

const baseDir = process.cwd();
const dataDir = path.resolve(baseDir, process.env.DATA_DIR || './data');
const parsedLimit = Number.parseInt(process.env.MAX_UPLOAD_BYTES || '', 10);
const maxUploadBytes = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 2 * 1024 ** 3;
const defaultSessionSecret = 'development-only-change-this-session-secret';
const exampleSessionSecret = 'change-this-to-a-random-secret-of-at-least-32-characters';
const sessionSecret = process.env.SESSION_SECRET || defaultSessionSecret;

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number.parseInt(process.env.PORT || '3000', 10),
  dataDir,
  dbPath: path.resolve(baseDir, process.env.DB_PATH || path.join(dataDir, 'openlearning.sqlite')),
  mediaRoot: path.resolve(baseDir, process.env.MEDIA_ROOT || path.join(dataDir, 'course-media')),
  maxUploadBytes,
  sessionSecret,
  trustProxy: process.env.TRUST_PROXY === 'true',
  clientDir: path.resolve(baseDir, 'dist/client'),
};

if (config.nodeEnv === 'production' && ([defaultSessionSecret, exampleSessionSecret].includes(sessionSecret) || sessionSecret.length < 32)) {
  throw new Error('Set SESSION_SECRET to a unique random value of at least 32 characters in production.');
}

