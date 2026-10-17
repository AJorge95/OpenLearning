import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const forcedColors = Array.from(styles.matchAll(/@media \(forced-colors: active\)\s*\{([\s\S]*?)\n\}/g), (match) => match[1])
  .find((rules) => rules.includes('.search-field:focus-within')) ?? '';

test('search fields use a system-color focus ring in forced-colors mode', () => {
  assert.notEqual(forcedColors, '', 'search field styles should adapt to forced-colors mode');
  assert.match(forcedColors, /\.search-field:focus-within, \.management-search:focus-within, \.access-search:focus-within\s*\{[^}]*border-color:\s*Highlight;[^}]*outline-color:\s*Highlight;/);
});
