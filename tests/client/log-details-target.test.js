import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

test('audit and system-log detail disclosures keep a reliable target and visible focus', () => {
  const disclosureRule = styles.match(/\.log-details-toggle\s*\{([^}]*)\}/)?.[1];
  assert.ok(disclosureRule, 'expected a shared log-details disclosure rule');
  assert.match(disclosureRule, /min-height:\s*40px/);
  assert.match(disclosureRule, /padding:\s*0 6px/);
  assert.match(disclosureRule, /border-radius:\s*4px/);

  const focusRule = styles.match(/\.log-details-toggle:focus-visible\s*\{([^}]*)\}/)?.[1];
  assert.ok(focusRule, 'expected a visible keyboard focus rule for log details');
  assert.match(focusRule, /outline:\s*2px solid var\(--purple\)/);

  const disclosure = source.match(/function LogDetailsDisclosure\(\{[\s\S]*?\n\}/)?.[0];
  assert.ok(disclosure, 'expected the shared log-details disclosure component');
  assert.match(disclosure, /className="log-details-toggle"/);
  assert.match(disclosure, /aria-expanded=\{expanded\}/);
  assert.match(disclosure, /aria-controls=\{contentId\}/);
  assert.match(disclosure, /setExpanded\(\(current\) => !current\)/);
});
