import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('reduced-motion preference removes decorative hover movement', () => {
  const reducedMotionRules = styles.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/)?.[1];

  assert.ok(reducedMotionRules, 'Expected a reduced-motion media query.');
  assert.match(styles, /\.course-card:hover\s*\{[^}]*transform:\s*translateY\(-2px\)/);
  assert.match(styles, /\.palette-option:hover\s*\{[^}]*transform:\s*translateY\(-1px\)/);
  assert.match(reducedMotionRules, /\.course-card:hover,\s*\.palette-option:hover\s*\{\s*transform:\s*none !important;\s*\}/);
  assert.match(reducedMotionRules, /transition-duration:\s*\.01ms !important/);
  assert.match(reducedMotionRules, /animation-duration:\s*\.01ms !important/);
  assert.match(reducedMotionRules, /scroll-behavior:\s*auto !important/);
});
