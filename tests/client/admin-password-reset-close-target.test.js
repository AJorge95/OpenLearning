import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const manageSource = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

test('administrator password reset close action keeps its name and a reliable touch target', () => {
  assert.match(manageSource, /<button className="modal-close" type="button"[\s\S]*?aria-label="Close"/);

  const closeRule = styles.match(/\.modal-close\s*\{([^}]*)\}/)?.[1];
  assert.ok(closeRule, 'expected explicit password-reset close-control styles');
  assert.match(closeRule, /display:\s*grid/);
  assert.match(closeRule, /place-items:\s*center/);
  assert.match(closeRule, /width:\s*44px/);
  assert.match(closeRule, /height:\s*44px/);
  assert.match(closeRule, /padding:\s*0/);
  assert.match(styles, /\.modal-close:hover:not\(:disabled\)\s*\{[^}]*border-color:\s*var\(--purple-border-strong\)/);
  assert.match(styles, /\.modal-close:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--purple\)/);
});
