import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

test('course-editor icon-only removal controls keep a compact 40px target and visible focus', () => {
  const iconButtonRule = [...styles.matchAll(/\.icon-button\s*\{([^}]*)\}/g)]
    .map((match) => match[1])
    .find((rule) => /width:\s*40px/.test(rule));

  assert.ok(iconButtonRule, 'expected shared icon-button styles');
  assert.match(iconButtonRule, /width:\s*40px/);
  assert.match(iconButtonRule, /height:\s*40px/);
  assert.match(iconButtonRule, /border:\s*1px solid transparent/);
  assert.match(styles, /\.icon-button:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--purple\)/);
  assert.match(source, /className="icon-button danger-icon"[^>]*aria-label=\{`Remove answer choice/);
  assert.match(source, /className="icon-button danger-icon"[^>]*aria-label=\{`Remove \$\{resource\.title\}/);
  assert.match(source, /className="icon-button danger-icon"[^>]*aria-label=\{`Remove \$\{caption\.label\} captions/);
});
