import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

test('platform reset phrase exposes its required state', () => {
  assert.match(
    source,
    /<label htmlFor="platform-reset-phrase"><span className="form-label-row"><span>Type RESET to confirm<\/span><small className="form-required-indicator" aria-hidden="true">Required<\/small><\/span><input id="platform-reset-phrase" required/,
  );
  assert.match(source, /resetBusy \|\| resetPhrase !== 'RESET'/);
});
