import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../../src/pages-backups.tsx', import.meta.url), 'utf8');

function rulesFor(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&');
  return [...styles.matchAll(new RegExp(`${escapedSelector}\\s*\\{[^}]*\\}`, 'g'))].map((match) => match[0]);
}

test('backup job actions keep a consistent target and visible keyboard focus', () => {
  const primaryRules = rulesFor('\\.backup-job-actions > \\.button');
  const textRules = rulesFor('\\.backup-job-actions > \\.text-action');
  const focusRules = rulesFor('\\.backup-job-actions > \\.text-action:focus-visible');

  assert.match(source, /className="backup-job-actions"/);
  assert.ok(primaryRules.some((rule) => /min-height:\s*40px/.test(rule)));
  assert.ok(textRules.some((rule) => /min-height:\s*40px/.test(rule)));
  assert.ok(textRules.some((rule) => /padding:\s*0 9px/.test(rule)));
  assert.ok(focusRules.some((rule) => /outline:\s*2px solid var\(--purple\)/.test(rule)));
});
