import assert from 'node:assert/strict';
import test from 'node:test';
import { hasValidWebVttCueTimings } from './webvtt-validation.js';

test('accepts valid WebVTT cue timings, metadata blocks, and overlapping ordered cues', () => {
  const captions = '\uFEFFWEBVTT captions\r\n\r\n'
    + 'NOTE generated for the course\r\nreviewed\r\n\r\n'
    + 'STYLE\r\n::cue { color: white; }\r\n\r\n'
    + 'REGION\r\nid:bottom lines:3\r\n\r\n'
    + 'opening\r\n00:00:01.000 --> 00:00:02.000 align:center\r\nHello\r\n\r\n'
    + '00:00:01.500 --> 00:00:02.500\r\nOverlap is allowed.\r\n';

  assert.equal(hasValidWebVttCueTimings(captions), true);
});

test('accepts a valid empty track and timestamps with hours', () => {
  assert.equal(hasValidWebVttCueTimings('WEBVTT\n\n'), true);
  assert.equal(hasValidWebVttCueTimings(
    'WEBVTT\n\n00:00:00.000 --> 12:00:00.001\nA long lesson\n',
  ), true);
});

test('compares long hour fields without converting them to large integers', () => {
  const hours = '9'.repeat(100_000);
  const captions = `WEBVTT\n\n${hours}:00:00.000 --> ${hours}:00:00.001\nLong timestamp\n`;
  assert.equal(hasValidWebVttCueTimings(captions), true);
});

test('rejects malformed headers and cue timing syntax', () => {
  const invalidCaptions = [
    'WEBVTT\n00:00.000 --> 00:01.000\nMissing header separator\n',
    'WEBVTT\n\n00:60.000 --> 01:00.000\nBad minute\n',
    'WEBVTT\n\n00:00.000 --> 00:60.000\nBad second\n',
    'WEBVTT\n\n00:01.000 --> 00:01.000\nZero duration\n',
    'WEBVTT\n\n00:02.000 --> 00:03.000\nLater\n\n00:01.000 --> 00:04.000\nEarlier\n',
    'WEBVTT\n\n00:00.000 --> 00:01.000 invalid-setting\nCaption\n',
    'WEBVTT\n\n00:00.000 --> 00:01.000\nInvalid --> payload\n',
    'WEBVTT\n\nrepeat\n00:00.000 --> 00:01.000\nFirst\n\nrepeat\n00:01.000 --> 00:02.000\nSecond\n',
  ];

  for (const captions of invalidCaptions) {
    assert.equal(hasValidWebVttCueTimings(captions), false, captions);
  }
});

test('rejects styling blocks that appear after the first cue', () => {
  assert.equal(hasValidWebVttCueTimings(
    'WEBVTT\n\n00:00.000 --> 00:01.000\nCaption\n\nSTYLE\n::cue { color: white; }\n',
  ), false);
});
