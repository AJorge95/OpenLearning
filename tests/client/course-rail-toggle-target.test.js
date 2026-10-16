import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('course rail disclosure keeps its name, state, and 40px target on narrow screens', () => {
  const playerStart = source.indexOf('return <div className={`player-layout');
  const playerEnd = source.indexOf('\nexport function QuizPage', playerStart);
  const player = source.slice(playerStart, playerEnd);

  assert.match(player, /className="rail-toggle" type="button" onClick=\{toggleCourseRail\}/);
  assert.match(player, /aria-label=\{railOpen \? 'Hide course content' : 'Show course content'\}/);
  assert.match(player, /aria-expanded=\{railOpen\} aria-controls="course-content-rail"/);

  const baseRule = styles.match(/\.rail-toggle\s*\{([^}]*)\}/)?.[1];
  assert.ok(baseRule, 'expected course rail disclosure styles');
  assert.match(baseRule, /width:\s*40px/);
  assert.match(baseRule, /height:\s*40px/);
  assert.match(styles, /\.rail-toggle:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--purple\)/);

  const narrowRule = styles.match(/@media \(max-width: 720px\)\s*\{[\s\S]*?\.rail-toggle\s*\{([^}]*)\}/)?.[1];
  assert.ok(narrowRule, 'expected narrow-screen course rail disclosure styles');
  assert.match(narrowRule, /width:\s*40px/);
  assert.match(narrowRule, /height:\s*40px/);
});
