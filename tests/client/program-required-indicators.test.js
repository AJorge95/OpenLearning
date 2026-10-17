import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');

test('required learning-path and competency names expose the shared visual cue', () => {
  assert.match(source,
    /<label><span className="form-label-row"><span>Path name<\/span><small className="form-required-indicator" aria-hidden="true">Required<\/small><\/span><input ref=\{pathTitleInputRef\} required/);
  assert.match(source,
    /<label><span className="form-label-row"><span>Name<\/span><small className="form-required-indicator" aria-hidden="true">Required<\/small><\/span><input ref=\{competencyTitleInputRef\} required/);
});
