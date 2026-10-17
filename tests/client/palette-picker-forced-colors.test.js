import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const componentSource = fs.readFileSync(new URL('../../src/components.tsx', import.meta.url), 'utf8');
const paletteForcedColors = Array.from(styles.matchAll(/@media \(forced-colors: active\)\s*\{([\s\S]*?)\n\}/g), (match) => match[1])
  .find((rules) => rules.includes('.palette-option.selected')) ?? '';

test('palette choices retain pressed semantics and a visible selected state in forced-colors mode', () => {
  assert.match(componentSource, /className=\{`palette-option \$\{value === palette\.id \? 'selected' : ''\}`\} aria-pressed=\{value === palette\.id\}/);
  assert.notEqual(paletteForcedColors, '', 'palette styles should adapt to forced-colors mode');
  assert.match(paletteForcedColors, /\.palette-option\.selected\s*\{[^}]*color:\s*HighlightText;[^}]*border-color:\s*Highlight;[^}]*background:\s*Highlight;/);
  assert.match(paletteForcedColors, /\.palette-option:focus-visible\s*\{[^}]*outline-color:\s*Highlight;/);
  assert.match(paletteForcedColors, /\.palette-option\.selected \.palette-swatch\s*\{[^}]*color:\s*HighlightText;[^}]*border-color:\s*HighlightText;[^}]*background:\s*Highlight;/);
});
