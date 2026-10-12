import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('the document clips child-panel overflow so the calendar keeps one scroll surface', () => {
  const htmlRule = styles.match(/^html\s*\{([^}]*)\}/m);

  assert.ok(htmlRule, 'expected a document root style');
  assert.match(htmlRule[1], /overflow-x:\s*hidden;/, 'keep a fallback for browsers without overflow clip');
  assert.match(htmlRule[1], /overflow-x:\s*clip;/, 'clip wide child panels at the document boundary');
  assert.ok(htmlRule[1].indexOf('overflow-x: hidden') < htmlRule[1].indexOf('overflow-x: clip'), 'the modern declaration should override the fallback');
});
