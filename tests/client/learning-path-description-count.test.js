import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');
const editorSource = source.slice(source.indexOf('function PathEditor'), source.indexOf('export function LearningPathsPage'));
const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../../server/routes-programs.js', import.meta.url), 'utf8');

test('learning path descriptions expose a count matching create and update limits', () => {
  assert.match(editorSource,
    /<label className="program-full-field">Description<textarea id="learning-path-description" aria-describedby="learning-path-description-count" rows=\{3\} maxLength=\{6000\} value=\{description\}/);
  assert.match(editorSource,
    /<small id="learning-path-description-count" className="field-character-count">\{description\.length\} \/ 6,000 characters<\/small>/);
  assert.match(styles, /\.field-character-count\s*\{[^}]*align-self:\s*flex-end[^}]*justify-self:\s*end/);
  assert.match(routes, /const description = text\(body\.description, 'Description', 6000\)/);
  assert.match(routes, /const description = body\.description === undefined \? current\.description : text\(body\.description, 'Description', 6000\)/);
});
