// SPDX-License-Identifier: GPL-2.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CycleTracker } from '../untangler@bluvulture/cycle.js';

test('repeated same action advances and wraps', () => {
  const t = new CycleTracker();
  assert.equal(t.advance(1, 'left-half', 3), 0);
  assert.equal(t.advance(1, 'left-half', 3), 1);
  assert.equal(t.advance(1, 'left-half', 3), 2);
  assert.equal(t.advance(1, 'left-half', 3), 0); // wraps (spec 3.2)
});

test('different action resets the cycle', () => {
  const t = new CycleTracker();
  t.advance(1, 'left-half', 3);
  t.advance(1, 'left-half', 3);
  assert.equal(t.advance(1, 'right-half', 3), 0); // other action → restart
  assert.equal(t.advance(1, 'left-half', 3), 0);  // and back → also restart
});

test('windows track independently', () => {
  const t = new CycleTracker();
  assert.equal(t.advance(1, 'left-half', 3), 0);
  assert.equal(t.advance(2, 'left-half', 3), 0);
  assert.equal(t.advance(1, 'left-half', 3), 1);
  assert.equal(t.advance(2, 'left-half', 3), 1);
});

test('length 1 actions always return 0', () => {
  const t = new CycleTracker();
  assert.equal(t.advance(1, 'center', 1), 0);
  assert.equal(t.advance(1, 'center', 1), 0);
});

test('reset and clear drop state', () => {
  const t = new CycleTracker();
  t.advance(1, 'left-half', 3);
  assert.deepEqual(t.peek(1), { action: 'left-half', index: 0 });
  t.reset(1);
  assert.equal(t.peek(1), null);
  assert.equal(t.advance(1, 'left-half', 3), 0);
  t.advance(2, 'top-half', 3);
  t.clear();
  assert.equal(t.peek(1), null);
  assert.equal(t.peek(2), null);
});
