import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const pageSource = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');

test('learning-path assignment removal names identify the learner and path', () => {
  assert.match(pageSource, /aria-label=\{`\$\{removingLearnerId === learner\.id \? 'Removing assignment for' : 'Remove assignment for'\} \$\{learner\.username\} from \$\{path\.title\}`\}/);
  assert.match(pageSource, /\{removingLearnerId === learner\.id \? 'Removing…' : 'Remove assignment'\}<\/button>/);
});
