// Tests caption timing through cuts and speed changes, and subtitle export.
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mapCaptions, normalizeCaptions, subtitleText } from './captions.js';

test('captions map through cuts and speed changes without using deleted time', () => {
  const result = mapCaptions([{ start: 2, end: 5, text: 'Sample' }], [{ start: 0, end: 3, speed: 1 }, { start: 4, end: 6, speed: 2 }]);
  assert.deepEqual(result, [{ start: 2, end: 3, text: 'Sample' }, { start: 3, end: 3.5, text: 'Sample' }]);
});

test('subtitle exports use the correct SRT and VTT timestamps', () => {
  const source = [{ start: 0.25, end: 1.5, text: 'Sample' }], clips = [{ start: 0, end: 2, speed: 1 }];
  assert.match(subtitleText(source, clips), /00:00:00,250 --> 00:00:01,500/);
  assert.match(subtitleText(source, clips, 'vtt'), /^WEBVTT\n\n00:00:00\.250 --> 00:00:01\.500/);
  assert.deepEqual(normalizeCaptions([{ start: 0, end: -1, text: 'invalid' }], 5), []);
});
