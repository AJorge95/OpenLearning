import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-backups.tsx', import.meta.url), 'utf8');

test('backup job inputs expose visible required cues without changing native validation', () => {
  assert.equal((source.match(/className="form-required-indicator" aria-hidden="true">Required<\/small>/g) || []).length, 4);
  assert.match(source, /Job name<\/span><small className="form-required-indicator" aria-hidden="true">Required/);
  assert.match(source, /Run time \(UTC\)<\/span><small className="form-required-indicator" aria-hidden="true">Required/);
  assert.match(source, /Keep successful backups<\/span><small className="form-required-indicator" aria-hidden="true">Required/);
  assert.match(source, /Server destination folder<\/span><small className="form-required-indicator" aria-hidden="true">Required/);
  assert.equal((source.match(/required(?= maxLength| value| min)/g) || []).length >= 4, true);
});
