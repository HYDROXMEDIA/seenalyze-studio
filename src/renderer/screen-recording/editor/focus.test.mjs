// Tests which control takes keyboard focus when the focused one goes away.
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { nearestUsable } from './focus.js';

test('keeps the same place when that control is usable again', () => {
  assert.equal(nearestUsable([true, true, true], 1), 1);
});

test('takes the next usable control, then the previous one', () => {
  // Undo disabled: Redo takes focus.
  assert.equal(nearestUsable([false, true], 0), 1);
  // Delete (last) disabled: the tool before it takes focus.
  assert.equal(nearestUsable([true, true, false], 2), 1);
});

test('takes the last block when the removed one was at the end', () => {
  assert.equal(nearestUsable([true, true], 4), 1);
});

test('finds nothing when no control is usable', () => {
  assert.equal(nearestUsable([false, false], 0), -1);
  assert.equal(nearestUsable([], 0), -1);
});
