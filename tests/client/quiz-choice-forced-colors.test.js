import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const forcedColors = styles.match(/@media \(forced-colors: active\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

test('quiz choices keep native radio and selected-state cues in forced-colors mode', () => {
  assert.notEqual(forcedColors, '', 'quiz styles should adapt to forced-colors mode');
  assert.match(forcedColors, /\.quiz-choice input\s*\{[^}]*position:\s*static;[^}]*opacity:\s*1;/);
  assert.match(forcedColors, /\.choice-selected\s*\{[^}]*color:\s*HighlightText;[^}]*border-color:\s*Highlight;[^}]*background:\s*Highlight;/);
  assert.match(forcedColors, /\.quiz-choice:has\(input:focus-visible\)\s*\{[^}]*outline-color:\s*Highlight;/);
  assert.match(forcedColors, /\.question-block:disabled \.quiz-choice\s*\{[^}]*opacity:\s*1;/);
});
