import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');

test('learning-path card footer actions keep a reliable target', () => {
  const footerRule = styles.match(/\.program-card-footer \.button\s*\{([^}]*)\}/)?.[1];

  assert.ok(footerRule, 'expected learning-path footer button styles');
  assert.match(footerRule, /min-height:\s*40px/);
  assert.match(source, /className="program-card-footer"/);
  assert.match(source, /aria-label=\{`Edit path: \$\{path\.title\}`\}/);
  assert.match(source, /aria-label=\{`Archive \$\{path\.title\}`\}/);
  assert.match(source, /aria-label=\{joiningPathId === path\.id \? `Joining \$\{path\.title\}` : `Join path: \$\{path\.title\}`\}/);
});
