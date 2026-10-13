import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/components.tsx', import.meta.url), 'utf8');
const moduleStart = source.indexOf('export function CurriculumModule');
const moduleEnd = source.indexOf('\nfunction CurriculumLesson', moduleStart);
const curriculumModule = source.slice(moduleStart, moduleEnd);
const lessonStart = moduleEnd;
const lessonEnd = source.indexOf('\nexport function CourseStatus', lessonStart);
const curriculumLesson = source.slice(lessonStart, lessonEnd);

test('curriculum item glyphs are decorative', () => {
  assert.match(curriculumModule, /className="curriculum-icon" aria-hidden="true"><CircleHelp size=\{17\} \/>/);
  assert.match(curriculumLesson, /className="curriculum-icon" aria-hidden="true"><LockKeyhole size=\{15\} \/>/);
  assert.match(curriculumLesson, /className="curriculum-icon" aria-hidden="true">\{lesson\.completed \? <Check size=\{17\} \/> : lesson\.hasVideo \? <Play size=\{15\} \/> : <FileText size=\{17\} \/>\}<\/span>/);
});

test('completed curriculum activities announce their status in link names', () => {
  assert.match(curriculumModule, /quiz\.passed && <>[\s\S]*?<span className="sr-only">Passed<\/span><\/>/);
  assert.match(curriculumLesson, /lesson\.completed && <>[\s\S]*?<span className="sr-only">Completed<\/span><\/>/);
  assert.match(curriculumModule, /<Check className="completion-icon" size=\{16\} aria-hidden="true" \/>/);
  assert.match(curriculumLesson, /<Check className="completion-icon" size=\{16\} aria-hidden="true" \/>/);
});
