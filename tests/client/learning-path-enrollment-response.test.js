import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');
const selfEnroll = source.slice(source.indexOf('async function selfEnroll'), source.indexOf('async function loadPathLearners'));

test('self-enrollment applies the mutation response before refreshing shared path progress', () => {
  assert.match(selfEnroll, /api\.post<\{ path: LearningPath \}>\(`\/api\/learning-paths\/\$\{path\.id\}\/enroll`\)/);
  assert.match(selfEnroll, /setPaths\(\(currentPaths\) => currentPaths\.map\(\(currentPath\) => currentPath\.id === enrolledPath\.id \? enrolledPath : currentPath\)\)/);
  assert.ok(selfEnroll.indexOf('setPaths(') < selfEnroll.indexOf('await load()'));
});
