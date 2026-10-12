import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const page = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('registration required checkbox keeps native dimensions inside the settings form', () => {
  const toggle = page.match(/<label className="registration-required-toggle">[\s\S]*?<\/label>/)?.[0];
  const checkboxRule = styles.match(/\.settings-card \.registration-required-toggle input\s*\{([^}]*)\}/)?.[1];

  assert.ok(toggle, 'expected the signup requirement checkbox label');
  assert.match(toggle, /<input type="checkbox"/);
  assert.match(toggle, /Required for signup/);
  assert.ok(checkboxRule, 'expected a dedicated checkbox reset after shared input styles');
  assert.match(checkboxRule, /appearance:\s*auto/);
  assert.match(checkboxRule, /width:\s*17px/);
  assert.match(checkboxRule, /height:\s*17px/);
  assert.match(checkboxRule, /min-height:\s*17px/);
  assert.match(checkboxRule, /padding:\s*0/);
});
