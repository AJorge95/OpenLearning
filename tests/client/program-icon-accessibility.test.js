import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const learnerSource = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');
const programsSource = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');

test('program-style learner icons stay decorative', () => {
  assert.match(learnerSource, /<span className="program-icon" aria-hidden="true"><LockKeyhole size=\{19\} \/><\/span>/);
});

test('program and competency heading icons stay decorative', () => {
  const icons = programsSource.match(/<span className="program-icon" aria-hidden="true">/g) ?? [];
  assert.equal(icons.length, 5, 'every program heading icon should be hidden from assistive technology');
});
