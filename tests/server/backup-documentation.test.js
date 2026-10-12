import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const readme = fs.readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const backupSection = readme.split('## Back up and restore')[1]?.split('\n## ')[0] ?? '';

test('backup instructions follow configured database and media paths', () => {
  // Incorrect example paths can create a valid-looking backup of the wrong installation files.
  assert.match(backupSection, /DATA_DIR=\$\{DATA_DIR:-\.\/data\}/);
  assert.match(backupSection, /DB_PATH=\$\{DB_PATH:-"\$DATA_DIR\/openlearning\.sqlite"\}/);
  assert.match(backupSection, /MEDIA_ROOT=\$\{MEDIA_ROOT:-"\$DATA_DIR\/course-media"\}/);
  assert.match(backupSection, /shell does not load `\.env` automatically/i);
  assert.match(backupSection, /same working directory used by OpenLearning/i);
  assert.match(backupSection, /sqlite3 "\$DB_PATH" "\.backup '\$BACKUP_DIR\/openlearning\.sqlite'"/);
  assert.match(backupSection, /cp -a "\$MEDIA_ROOT" "\$BACKUP_DIR\/course-media"/);
});
