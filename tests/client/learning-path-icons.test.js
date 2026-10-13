import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');

test('learning-path reorder controls hide their decorative arrows', () => {
  assert.match(source, /aria-label=\{`Move \$\{course\?\.title\} earlier`\}[\s\S]*?<ArrowUp size=\{16\} aria-hidden="true" \/>/);
  assert.match(source, /aria-label=\{`Move \$\{course\?\.title\} later`\}[\s\S]*?<ArrowDown size=\{16\} aria-hidden="true" \/>/);
});

test('learning-path completion and enrollment markers stay decorative', () => {
  assert.match(source, /className="path-course-number">\{course\.completed \? <Check size=\{14\} aria-hidden="true" \/>/);
  assert.match(source, /className="program-enrolled"><Check size=\{15\} aria-hidden="true" \/>Enrolled/);
});

test('staff learning-path action icons stay decorative beside labelled actions', () => {
  for (const icon of ['RotateCcw', 'UsersRound', 'Archive']) {
    assert.match(source, new RegExp(`<${icon} size=\\{15\\} aria-hidden="true" \\/>`), `${icon} should be decorative`);
  }
});
