import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

test('course analytics activity disclosures keep a reliable target and visible focus', () => {
  const disclosureRule = styles.match(/\.analytics-learner-details summary\s*\{([^}]*)\}/)?.[1];
  assert.ok(disclosureRule, 'expected a learner activity disclosure rule');
  assert.match(disclosureRule, /min-height:\s*40px/);

  const focusRule = styles.match(/\.analytics-learner-details summary:focus-visible\s*\{([^}]*)\}/)?.[1];
  assert.ok(focusRule, 'expected a visible keyboard focus rule for learner activity disclosures');
  assert.match(focusRule, /outline:\s*2px solid var\(--purple\)/);
  assert.match(source, /<summary aria-label=\{`View activity details for \$\{learner\.username\}`\}>View activity details<\/summary>/);
});
