import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manageSource = fs.readFileSync(path.join(repositoryRoot, 'src/pages-manage.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(repositoryRoot, 'src/styles.css'), 'utf8');
const courseRoutes = fs.readFileSync(path.join(repositoryRoot, 'server/routes-courses.js'), 'utf8');

test('lesson descriptions expose a per-lesson count tied to the server limit', () => {
  assert.match(manageSource,
    /<label>Lesson description\s*<textarea id=\{`lesson-description-\$\{lesson\.id\}`\} aria-describedby=\{`lesson-description-count-\$\{lesson\.id\}`\} value=\{description\} maxLength=\{2000\}/);
  assert.match(manageSource,
    /<small id=\{`lesson-description-count-\$\{lesson\.id\}`\} className="field-character-count">\{description\.length\} \/ 2,000 characters<\/small>/);
  assert.match(styles, /\.field-character-count\s*\{[^}]*align-self:\s*flex-end/);
  assert.match(courseRoutes,
    /const requestedDescription = body\.description === undefined \? undefined : textField\(body\.description, 'Lesson description', 2000\)/);
});
