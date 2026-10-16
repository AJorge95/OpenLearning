import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const learnerSource = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');
const managementSource = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('shared recovery links keep their destination and a reliable keyboard target', () => {
  assert.match(learnerSource, /<Link className="back-link" to="\/my-learning"><ArrowLeft size=\{17\} aria-hidden="true" \/>Back to my learning<\/Link>/);
  assert.match(learnerSource, /<Link className="back-link" to=\{`\/courses\/\$\{courseId\}`\}><ArrowLeft size=\{17\} aria-hidden="true" \/>Back to course<\/Link>/);
  assert.match(managementSource, /<Link className="back-link" to="\/admin\/users"><ArrowLeft size=\{17\} aria-hidden="true" \/>Back to users<\/Link>/);

  const baseRule = styles.match(/\.back-link\s*\{([^}]*)\}/)?.[1];
  assert.ok(baseRule, 'expected shared back-link styles');
  assert.match(baseRule, /min-height:\s*40px/);
  assert.match(baseRule, /padding:\s*0\s+4px/);
  assert.match(styles, /\.back-link:hover\s*\{[^}]*background:\s*var\(--purple-soft\)/);
  assert.match(styles, /\.back-link:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--purple\)/);
});
