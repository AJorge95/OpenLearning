import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/components.tsx', import.meta.url), 'utf8');

test('course-card module metadata hides its decorative book icon', () => {
  assert.match(source, /<div className="card-meta"><BookOpen size=\{17\} aria-hidden="true" \/><span>\{formatCountLabel\(course\.moduleCount, 'module', 'modules'\)\}<\/span><\/div>/);
});
