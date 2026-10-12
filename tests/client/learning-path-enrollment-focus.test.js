import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');

test('self-enrollment restores focus after the join control changes', () => {
  const selfEnroll = source.slice(source.indexOf('async function selfEnroll'), source.indexOf('async function loadPathLearners'));

  assert.match(source, /onClick=\{\(event\) => void selfEnroll\(path, event\.currentTarget\)\}/);
  assert.match(selfEnroll, /window\.requestAnimationFrame\(\(\) => \{/);
  assert.match(selfEnroll, /if \(!pathsPageActiveRef\.current\) return;/);
  assert.match(selfEnroll, /if \(trigger\.isConnected\) trigger\.focus\(\);/);
  assert.match(selfEnroll, /else document\.getElementById\(`learning-path-title-\$\{path\.id\}`\)\?\.focus\(\);/);
  assert.match(source, /<h2 id=\{`learning-path-title-\$\{path\.id\}`\} tabIndex=\{-1\}>\{path\.title\}<\/h2>/);
});
