import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('touch-sized mobile text controls use a font size that avoids focus zoom', () => {
  const touchMobileStyles = styles.match(/@media \(max-width: 720px\) and \(pointer: coarse\)\s*\{([\s\S]*?)\n\}/)?.[1];

  assert.ok(touchMobileStyles, 'expected a small-screen coarse-pointer override');
  assert.match(touchMobileStyles, /#root input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="file"\]\):not\(\[type="range"\]\):not\(\[type="button"\]\):not\(\[type="submit"\]\):not\(\[type="reset"\]\):not\(\[type="hidden"\]\):not\(\[type="image"\]\):not\(\[type="color"\]\)/);
  assert.match(touchMobileStyles, /#root textarea/);
  assert.match(touchMobileStyles, /#root select/);
  assert.match(touchMobileStyles, /font-size:\s*16px/);
  assert.match(styles, /\/\* Keep mobile touch fields above the browser focus-zoom threshold without changing desktop sizing\. \*\//);
});
