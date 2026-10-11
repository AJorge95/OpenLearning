import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('course cards keep legal long titles inside the narrow-screen layout', () => {
  const styles = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
  const routes = fs.readFileSync(path.join(root, 'server/routes-courses.js'), 'utf8');
  const cardCopyRule = styles.match(/\.course-card-copy\s*\{([^}]*)\}/)?.[1];
  const titleRule = styles.match(/\.course-card h2\s*\{([^}]*)\}/)?.[1];

  assert.ok(cardCopyRule, 'expected a course-card content rule');
  assert.ok(titleRule, 'expected a course title rule');
  assert.match(cardCopyRule, /min-width:\s*0/);
  assert.match(titleRule, /overflow-wrap:\s*anywhere/);
  assert.match(styles, /@media \(max-width: 420px\)[\s\S]*?\.course-card \{ display: grid; grid-template-columns: 38% 1fr; \}/);
  assert.match(routes, /textField\(body\.title \?\? 'Untitled course', 'Course title', 160/);
});
