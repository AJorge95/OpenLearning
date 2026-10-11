import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const stylesPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/styles.css');

test('document and body can shrink to the usable mobile viewport width', () => {
  const styles = fs.readFileSync(stylesPath, 'utf8');
  const htmlRule = styles.match(/^html\s*\{([^}]*)\}/m);
  const bodyRule = styles.match(/^body\s*\{([^}]*)\}/m);

  assert.ok(htmlRule, 'expected the document root style');
  assert.ok(bodyRule, 'expected the document body style');
  assert.doesNotMatch(htmlRule[1], /min-width\s*:/);
  assert.doesNotMatch(bodyRule[1], /min-width\s*:/);
});

test('course catalog filters stack before the sort value is truncated', () => {
  const styles = fs.readFileSync(stylesPath, 'utf8');
  const breakpointStart = styles.indexOf('@media (max-width: 450px)');

  assert.notEqual(breakpointStart, -1, 'expected a compact catalog-filter breakpoint');
  const nextBreakpoint = styles.indexOf('@media', breakpointStart + 1);
  const filterRules = styles.slice(breakpointStart, nextBreakpoint === -1 ? undefined : nextBreakpoint);

  assert.match(filterRules, /\.catalog-tools\s+\.filter-controls\s*\{[^}]*flex-direction:\s*column;[^}]*align-items:\s*stretch;/);
  assert.match(filterRules, /\.catalog-tools\s+\.catalog-filter-control\s*\{\s*width:\s*100%;\s*\}/);
});
