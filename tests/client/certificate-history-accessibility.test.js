import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');

test('completed-course certificate actions include the course in their accessible names', () => {
  assert.match(source, /className="certificate-card-link" to=\{`\/my-learning\/certificates\/\$\{course\.id\}`\} aria-label=\{`View certificate for \$\{course\.title\}`\}/);
  assert.match(source, /className="certificate-card-link" to="\/account\/security" aria-label=\{`Add your name for the \$\{course\.title\} certificate`\}/);
});

test('certificate-history links identify the course they open', () => {
  assert.match(source, /className="button button-secondary" to=\{`\/my-learning\/certificates\/\$\{certificate\.id\}`\} aria-label=\{`View certificate for \$\{certificate\.courseTitle\}, code \$\{certificate\.certificateCode\}`\}/);
});
