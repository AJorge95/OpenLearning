import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const page = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const components = fs.readFileSync(new URL('../../src/components.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('course visibility choices use labelled native radios with usable targets', () => {
  const visibilityFieldset = page.match(/<fieldset className="visibility-field"[\s\S]*?<\/fieldset>/)?.[0];
  const labelRule = styles.match(/\.visibility-field label\s*\{([^}]*)\}/)?.[1];
  const radioRule = styles.match(/\.visibility-field input\s*\{([^}]*)\}/)?.[1];

  assert.ok(visibilityFieldset, 'expected the course visibility fieldset');
  assert.match(visibilityFieldset, /<label><input type="radio" name="visibility"[\s\S]*?\/>Public<\/label>/);
  assert.match(visibilityFieldset, /<label><input type="radio" name="visibility"[\s\S]*?\/>Private<\/label>/);
  assert.ok(labelRule, 'expected clickable course visibility labels');
  assert.match(labelRule, /min-height:\s*24px/);
  assert.match(labelRule, /cursor:\s*pointer/);
  assert.ok(radioRule, 'expected native course visibility radio styles');
  assert.match(radioRule, /appearance:\s*auto/);
  assert.match(radioRule, /width:\s*24px/);
  assert.match(radioRule, /height:\s*24px/);
  assert.match(radioRule, /padding:\s*0/);
});

test('course visibility labels hide redundant icons from assistive technology', () => {
  const visibilityLabel = components.match(/export function VisibilityLabel[\s\S]*?\n}/)?.[0];

  assert.ok(visibilityLabel, 'expected the shared course visibility label');
  assert.match(visibilityLabel, /<UsersRound size=\{15\} aria-hidden="true" \/>/);
  assert.match(visibilityLabel, /<LockKeyhole size=\{14\} aria-hidden="true" \/>/);
});
