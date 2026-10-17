import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const appSelectForcedColors = Array.from(styles.matchAll(/@media \(forced-colors: active\)\s*\{([\s\S]*?)\n\}/g), (match) => match[1])
  .find((rules) => rules.includes('.app-select-menu')) ?? '';

test('custom select controls preserve focus, active, selected, and disabled cues in forced-colors mode', () => {
  assert.notEqual(appSelectForcedColors, '', 'AppSelect styles should adapt to forced-colors mode');
  assert.match(appSelectForcedColors, /\.app-select-trigger:focus-visible\s*\{[^}]*outline-color:\s*Highlight;/);
  assert.match(appSelectForcedColors, /\.app-select-menu\s*\{[^}]*border-color:\s*CanvasText;[^}]*background:\s*Canvas;/);
  assert.match(appSelectForcedColors, /\.app-select-option:hover, \.app-select-option\.active, \.app-select-option\.selected\s*\{[^}]*color:\s*HighlightText;[^}]*background:\s*Highlight;/);
  assert.match(appSelectForcedColors, /\.app-select-option\[aria-disabled="true"\]\s*\{[^}]*color:\s*GrayText;[^}]*opacity:\s*1;/);
  assert.match(appSelectForcedColors, /\.app-select-option\.selected \.app-select-option-indicator\s*\{[^}]*border:\s*1px solid HighlightText;/);
});
