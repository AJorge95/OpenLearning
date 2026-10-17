import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

test('course version history controls keep reliable disclosure and paging targets', () => {
  const page = fs.readFileSync(path.join(sourceDirectory, 'pages-manage.tsx'), 'utf8');
  const styles = fs.readFileSync(path.join(sourceDirectory, 'styles.css'), 'utf8');

  assert.match(page, /<details className="course-version-history-disclosure">\s*<summary>Previous versions/);
  assert.match(page, /<nav className="course-version-pagination" aria-label="Course version history pages">/);
  assert.match(styles, /\.course-version-history-disclosure\s*> summary\s*\{[^}]*min-height:\s*40px/);
  assert.match(styles, /\.course-version-history-disclosure\s*> summary:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--purple\)/);
  assert.match(styles, /\.course-version-pagination \.button\s*\{[^}]*min-height:\s*40px/);
});
