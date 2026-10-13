import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');
const playerStart = source.indexOf('return <div className={`player-layout');
const playerEnd = source.indexOf('\nexport function QuizPage', playerStart);
const player = source.slice(playerStart, playerEnd);

test('lesson player controls hide glyphs that duplicate their labels', () => {
  for (const icon of ['ChevronDown', 'RotateCcw', 'VolumeX', 'Volume2', 'Minimize', 'Maximize', 'ArrowLeft', 'Check', 'ArrowRight', 'MessageSquare']) {
    assert.match(player, new RegExp(`<${icon}[^>]*aria-hidden="true"`), `${icon} should be decorative in the lesson player`);
  }
  assert.match(player, /videoPlaying \? <Pause size=\{18\} fill="currentColor" aria-hidden="true" \/> : <Play size=\{18\} fill="currentColor" aria-hidden="true" \/>/);
});
