import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/components.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('course cards expose an optional, bounded description preview', () => {
  assert.match(source, /const description = course\.description\.trim\(\);/);
  assert.match(source, /\{description && <p className="course-description">\{description\}<\/p>\}/);
  assert.match(styles, /\.course-description \{[^}]*-webkit-line-clamp: 2;[^}]*overflow: hidden;/);
});
