import fs from 'node:fs';
import path from 'node:path';

/** Restrict files created by commands that store private application data. */
export function securePrivateFileCreation({
  cwd = process.cwd(),
  platform = process.platform,
  dotenvConfigPath = process.env.DOTENV_CONFIG_PATH,
  fileSystem = fs,
  setUmask = (mask) => process.umask(mask),
} = {}) {
  if (platform === 'win32') return;

  // Keep database, media, backup, and secret files private when the app creates them.
  setUmask(0o077);

  // Alternate dotenv files may be externally managed, so leave their modes to the operator.
  if (dotenvConfigPath?.trim()) return;

  const dotenvPath = path.resolve(cwd, '.env');
  let dotenvStats;
  try {
    dotenvStats = fileSystem.lstatSync(dotenvPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  // Do not follow a symlink; only tighten a regular dotenv file in place.
  if (dotenvStats.isFile() && (dotenvStats.mode & 0o077) !== 0) {
    fileSystem.chmodSync(dotenvPath, 0o600);
  }
}

/** Production startup applies private creation modes before importing the app. */
export function secureProductionRuntimePermissions(options = {}) {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  const platform = options.platform ?? process.platform;
  if (nodeEnv !== 'production' || platform === 'win32') return;

  securePrivateFileCreation({ ...options, platform });
}
