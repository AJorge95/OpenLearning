import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sourceRoot = new URL('../../src/', import.meta.url);
const componentSource = fs.readFileSync(new URL('components.tsx', sourceRoot), 'utf8');
const styles = fs.readFileSync(new URL('styles.css', sourceRoot), 'utf8');

test('custom select options keep a reliable target and existing listbox states', () => {
  const optionRule = styles.match(/\.app-select-option\s*\{([^}]*)\}/)?.[1];
  assert.ok(optionRule, 'expected the shared custom-select option rule');
  assert.match(optionRule, /min-height:\s*40px/);
  assert.match(styles, /\.app-select-option:hover, \.app-select-option\.active\s*\{/);
  assert.match(styles, /\.app-select-option\.selected\s*\{/);
  assert.match(styles, /\.app-select-option\[aria-disabled="true"\]\s*\{/);

  const optionMarkup = componentSource.match(/<div key=\{String\(option\.value\)\}[^>]*role="option"[\s\S]*?<\/div>\)/)?.[0];
  assert.ok(optionMarkup, 'expected native listbox option markup');
  assert.match(optionMarkup, /aria-selected=\{option\.value === value\}/);
  assert.match(optionMarkup, /aria-disabled=\{option\.disabled \|\| undefined\}/);
  assert.match(optionMarkup, /onClick=\{\(\) => choose\(index\)\}/);
});
