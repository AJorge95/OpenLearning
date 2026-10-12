import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const readme = fs.readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const backupSection = readme.split('## Back up and restore')[1]?.split('\n## ')[0] ?? '';

test('backup instructions follow configured database and media paths', () => {
  assert.match(backupSection, /`npm run backup`/);
  assert.match(backupSection, /same `DATA_DIR`, `DB_PATH`, and `MEDIA_ROOT` configuration/i);
  assert.match(backupSection, /reads the project `\.env` file/i);
  assert.match(backupSection, /bundled SQLite driver, so the SQLite CLI is not required/i);
  assert.match(backupSection, /new timestamped directory under `\.\/backup`/);
  assert.match(backupSection, /BACKUP_DIR/);
  assert.match(backupSection, /same working directory used by OpenLearning/i);
  assert.match(backupSection, /pause course edits and uploads during the media copy/i);
  assert.match(backupSection, /Before copying media or reporting success, it verifies the SQLite snapshot with `quick_check`/i);
  assert.match(backupSection, /if the check fails, incomplete output is removed/i);
  assert.match(backupSection, /rejects backup destinations inside the media root/i);
  assert.match(backupSection, /removes incomplete output when a backup fails/i);
});
