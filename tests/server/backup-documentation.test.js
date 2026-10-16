import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const readme = fs.readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const backupSection = readme.split('## Back up and restore')[1]?.split('\n## ')[0] ?? '';

test('backup instructions follow configured database and media paths', () => {
  assert.match(backupSection, /Settings.*Backups/);
  assert.match(backupSection, /daily or weekly/i);
  assert.match(backupSection, /database, course-media, or full backups/i);
  assert.match(backupSection, /per-job destinations and retention policies/i);
  assert.match(backupSection, /14 successful backup artifacts/i);
  assert.match(backupSection, /Missed schedules are not replayed after downtime/i);
  assert.match(backupSection, /`npm run backup`/);
  assert.match(backupSection, /same `DATA_DIR`, `DB_PATH`, and `MEDIA_ROOT` settings as the app/i);
  assert.match(backupSection, /reads `\.env` and writes under `\.\/backup` by default/i);
  assert.match(backupSection, /BACKUP_DIR/);
  assert.match(backupSection, /Pause course edits and uploads while media is copied/i);
  assert.match(backupSection, /checks the SQLite snapshot and media copies/i);
  assert.match(backupSection, /rejects a destination inside the media root/i);
  assert.match(backupSection, /removes incomplete output after a failure/i);
});
