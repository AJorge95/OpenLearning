import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');
const playerStart = source.indexOf('export function CoursePlayerPage()');
const playerEnd = source.indexOf('\nexport function QuizPage', playerStart);
const player = source.slice(playerStart, playerEnd);

test('learner certificate actions hide decorative award and print glyphs', () => {
  assert.match(source, /aria-label=\{`View certificate for \$\{course\.title\}`\}><Award size=\{16\} aria-hidden="true" \/>View certificate/);
  assert.match(source, /aria-label=\{`Add your name for the \$\{course\.title\} certificate`\}><Award size=\{16\} aria-hidden="true" \/>Add your name for certificate/);
  assert.match(source, /className="certificate-history-icon" aria-hidden="true"><Award size=\{19\} \/><\/span>/);
  assert.match(source, /<Printer size=\{17\} aria-hidden="true" \/>Print or save as PDF/);
  assert.match(source, /className="certificate-seal"><Award size=\{25\} aria-hidden="true" \/><span>Completed/);
});

test('learner player secondary glyphs stay decorative beside their text', () => {
  assert.match(player, /<ArrowLeft size=\{17\} aria-hidden="true" \/>Back to course/);
  assert.match(player, /<Play size=\{36\} aria-hidden="true" \/><span>Video not available/);
  assert.match(player, /<Award size=\{17\} aria-hidden="true" \/>View certificate/);
  assert.match(player, /<Award size=\{17\} aria-hidden="true" \/>Add name for certificate/);
  assert.match(player, /<Link2 size=\{17\} aria-hidden="true" \/> : <FileText size=\{17\} aria-hidden="true" \/>/);
  assert.match(player, /<ExternalLink size=\{15\} aria-hidden="true" \/> : <Download size=\{15\} aria-hidden="true" \/>/);
});
