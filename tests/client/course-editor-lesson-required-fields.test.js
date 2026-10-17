import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const lessonEditor = source.slice(source.indexOf('function LessonDetailsEditor'), source.indexOf('export function CourseEditorPage'));
const requiredCue = '<small className="form-required-indicator" aria-hidden="true">Required</small>';

test('lesson resource and caption forms show decorative cues for native required fields', () => {
  assert.equal(lessonEditor.split(requiredCue).length - 1, 6);
  for (const label of ['Lesson title', 'Link title', 'Link URL', 'Language tag', 'Track label', 'WebVTT file']) {
    assert.match(lessonEditor, new RegExp(`<span className="form-label-row"><span>${label}</span>${requiredCue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/span>`));
  }
  assert.doesNotMatch(lessonEditor, /<label>Lesson title<input/);
  assert.doesNotMatch(lessonEditor, /<label>Link title<input/);
  assert.doesNotMatch(lessonEditor, /<label>Link URL<input/);
});
