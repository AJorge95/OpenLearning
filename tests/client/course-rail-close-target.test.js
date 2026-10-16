import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('course rail close control keeps its named action and a compact touch target', () => {
  const playerStart = source.indexOf('return <div className={`player-layout');
  const playerEnd = source.indexOf('\nexport function QuizPage', playerStart);
  const player = source.slice(playerStart, playerEnd);

  assert.match(player, /<button ref=\{railCloseRef\} type="button" aria-label="Hide course content"/);
  const closeRule = styles.match(/\.course-rail-head button\s*\{([^}]*)\}/)?.[1];
  assert.ok(closeRule, 'expected explicit course rail close-control styles');
  assert.match(closeRule, /width:\s*40px/);
  assert.match(closeRule, /height:\s*40px/);
  assert.match(closeRule, /display:\s*grid/);
  assert.match(styles, /\.course-rail-head button:hover:not\(:disabled\)\s*\{[^}]*border-color:\s*var\(--purple-border-strong\)/);
});
