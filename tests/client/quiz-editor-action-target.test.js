import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

test('quiz-editor text actions keep a compact 40px target and visible focus', () => {
  const actionRule = [...styles.matchAll(/\.quiz-editor \.text-action\s*\{([^}]*)\}/g)]
    .map((match) => match[1])
    .find((rule) => /min-height:\s*40px/.test(rule)) || '';

  assert.match(actionRule, /min-height:\s*40px/);
  assert.match(actionRule, /padding:\s*0 9px/);
  assert.match(styles, /\.quiz-editor \.text-action:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--purple\)/);
  assert.match(styles, /\.quiz-editor \.text-action\.danger-text:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--danger-soft\)/);
  assert.match(styles, /\.quiz-editor \.text-action:hover:not\(:disabled\)\s*\{[^}]*text-decoration:\s*none/);
  assert.match(styles, /\.quiz-editor \.text-action:hover:not\(:disabled\), \.quiz-editor \.text-action:focus-visible\s*\{[^}]*background:\s*Highlight/);
  assert.match(source, /className="text-action danger-text"[^>]*aria-label=\{`Remove question/);
  assert.match(source, /className="text-action add-choice"[^>]*aria-label=\{`Add answer choice/);
  assert.match(source, /ref=\{addQuestionButtonRef\} className="text-action"/);
});
