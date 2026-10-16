import fs from 'node:fs';
import path from 'node:path/posix';
import dotenv from 'dotenv';

const cwd = process.env.OLD_WORKING_DIRECTORY;
const envPath = process.env.OLD_ENV_FILE;
const targetPath = process.env.NEW_ENV_FILE;
if (!cwd || !envPath || !targetPath) throw new Error('Old working directory, source environment, and target environment are required.');

const source = dotenv.parse(fs.readFileSync(envPath));
const resolveFromOldCwd = (value) => path.resolve(cwd, value);
const dataDir = resolveFromOldCwd(source.DATA_DIR || './data');
const dbPath = resolveFromOldCwd(source.DB_PATH || path.join(dataDir, 'openlearning.sqlite'));
const mediaRoot = resolveFromOldCwd(source.MEDIA_ROOT || path.join(dataDir, 'course-media'));
const backupDir = resolveFromOldCwd(source.BACKUP_DIR || '/var/backups/openlearning');
const preserve = {
  ...source,
  DATA_DIR: dataDir,
  DB_PATH: dbPath,
  MEDIA_ROOT: mediaRoot,
  BACKUP_DIR: backupDir,
};
preserve.NODE_ENV = 'production';
const portOverride = process.env.INSTALL_PORT_OVERRIDE || '';
if (portOverride) {
  if (!/^\d+$/.test(portOverride) || !Number.isSafeInteger(Number(portOverride)) || Number(portOverride) < 1 || Number(portOverride) > 65_535) {
    throw new Error('INSTALL_PORT_OVERRIDE must be a whole-number TCP port between 1 and 65535.');
  }
  preserve.PORT = String(Number(portOverride));
} else {
  preserve.PORT ||= '6173';
}
preserve.SESSION_SECRET ||= '';
preserve.SETUP_TOKEN ||= '';
preserve.TRUST_PROXY ||= 'false';
if (!preserve.SESSION_SECRET) throw new Error('Existing environment has no SESSION_SECRET; refusing adoption.');
const lines = Object.entries(preserve).map(([key, value]) => `${key}=${JSON.stringify(String(value))}`);
fs.writeFileSync(targetPath, `${lines.join('\n')}\n`, { mode: 0o600 });
fs.chmodSync(targetPath, 0o600);
