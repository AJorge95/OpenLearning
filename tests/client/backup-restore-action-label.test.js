import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-backups.tsx', import.meta.url), 'utf8');

test('each restore-point action names its backup and completion time', () => {
  assert.match(source, /aria-label=\{`Restore full backup from \$\{run\.jobName\}, completed \$\{formatTimestamp\(run\.finishedAt \|\| run\.createdAt\)\}`\}/);
  assert.match(source, /<RotateCcw size=\{14\} aria-hidden="true" \/>Restore<\/button>/);
});
