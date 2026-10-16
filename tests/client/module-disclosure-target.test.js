import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('course-editor module disclosures keep their state semantics and reliable target', () => {
  assert.match(source, /className="module-disclosure"[\s\S]*?aria-label=\{`\$\{expanded\[module\.id\] \?\? true \? 'Collapse' : 'Expand'\} \$\{module\.title\}`\} aria-expanded=\{expanded\[module\.id\] \?\? true\}/);

  const disclosureRule = [...styles.matchAll(/\.module-disclosure\s*\{([^}]*)\}/g)]
    .map((match) => match[1])
    .find((rule) => /width:\s*40px/.test(rule));
  assert.ok(disclosureRule, 'expected explicit module disclosure styles');
  assert.match(disclosureRule, /flex:\s*0 0 40px/);
  assert.match(disclosureRule, /width:\s*40px/);
  assert.match(disclosureRule, /height:\s*40px/);
  assert.match(styles, /\.module-disclosure:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--purple-soft\)/);
  assert.match(styles, /\.module-disclosure:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--purple\)/);
  assert.match(styles, /\.module-disclosure:hover:not\(:disabled\), \.module-disclosure:focus-visible\s*\{[^}]*outline-color:\s*Highlight/);
});
