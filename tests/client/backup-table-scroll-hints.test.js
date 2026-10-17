import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-backups.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

const scrollableBackupTables = [
  ['Available full backup restore points', 'Scroll horizontally to see all restore point columns.'],
  ['Scrollable backup run history', 'Scroll horizontally to see all backup run columns.'],
];

test('backup tables explain horizontal scrolling inside their named regions', () => {
  for (const [regionName, hintText] of scrollableBackupTables) {
    const regionPosition = source.indexOf(`aria-label="${regionName}"`);
    const hintPosition = source.indexOf(`<p className="table-scroll-hint">${hintText}</p>`, regionPosition);
    const tablePosition = source.indexOf('<table className="backup-history-table">', regionPosition);

    assert.ok(regionPosition >= 0, `expected the ${regionName} region`);
    assert.ok(hintPosition > regionPosition && hintPosition < tablePosition, `expected the ${regionName} hint before its table`);
  }

  assert.match(styles, /\.backup-history-wrap\s*\{[^}]*overflow-x:\s*auto;[^}]*container-type:\s*inline-size;[^}]*container-name:\s*backup-history;/);
  assert.match(styles, /@container backup-history \(max-width: 930px\)\s*\{\s*\.backup-history-wrap > \.table-scroll-hint \{ display: flex; \}\s*\}/);
});
