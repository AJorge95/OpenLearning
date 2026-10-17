import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const styles = fs.readFileSync(path.join(sourceDirectory, 'styles.css'), 'utf8');

test('program-card headings and descriptions wrap long unbroken text', () => {
  assert.match(styles, /\.program-card-heading h2\s*\{[^}]*overflow-wrap:\s*anywhere;/);
  assert.match(styles, /\.program-card-heading p\s*\{[^}]*overflow-wrap:\s*anywhere;/);
});

test('enrolled learner list has a heading beneath the assignment panel heading', () => {
  const pageSource = fs.readFileSync(path.join(sourceDirectory, 'pages-programs.tsx'), 'utf8');

  assert.match(pageSource, /<h3>Assign a learner<\/h3>[\s\S]*?<h4 className="path-assigned-heading">Enrollments on this page<\/h4>/);
  assert.match(styles, /\.path-assigned-heading\s*\{[^}]*font-size:\s*11px;[^}]*font-weight:\s*650;/);
});

test('learning-path course deadlines use the shared safe formatter', () => {
  const pageSource = fs.readFileSync(path.join(sourceDirectory, 'pages-programs.tsx'), 'utf8');

  assert.match(pageSource, /import \{ formatLearningDeadlineDay \} from '\.\/learning-deadline';/);
  assert.match(pageSource, /formatLearningDeadlineDay\(course\.deadlineAt\)/);
  assert.doesNotMatch(pageSource, /pathCourseDeadlineFormatter/);
});
