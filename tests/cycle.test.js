// SPDX-License-Identifier: GPL-2.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CycleTracker } from '../untangler@bluvulture/cycle.js';

test('repeated same action advances and wraps', () => {
  const t = new CycleTracker();
  const w1 = {};
  assert.equal(t.advance(w1, 'left-half', 3), 0);
  assert.equal(t.advance(w1, 'left-half', 3), 1);
  assert.equal(t.advance(w1, 'left-half', 3), 2);
  assert.equal(t.advance(w1, 'left-half', 3), 0); // wraps (spec 3.2)
});

test('different action resets the cycle', () => {
  const t = new CycleTracker();
  const w1 = {};
  t.advance(w1, 'left-half', 3);
  t.advance(w1, 'left-half', 3);
  assert.equal(t.advance(w1, 'right-half', 3), 0); // other action → restart
  assert.equal(t.advance(w1, 'left-half', 3), 0);  // and back → also restart
});

test('windows track independently', () => {
  const t = new CycleTracker();
  const w1 = {};
  const w2 = {};
  assert.equal(t.advance(w1, 'left-half', 3), 0);
  assert.equal(t.advance(w2, 'left-half', 3), 0);
  assert.equal(t.advance(w1, 'left-half', 3), 1);
  assert.equal(t.advance(w2, 'left-half', 3), 1);
});

test('length 1 actions always return 0', () => {
  const t = new CycleTracker();
  const w1 = {};
  assert.equal(t.advance(w1, 'center', 1), 0);
  assert.equal(t.advance(w1, 'center', 1), 0);
});

test('reset and clear drop state', () => {
  const t = new CycleTracker();
  const w1 = {};
  const w2 = {};
  t.advance(w1, 'left-half', 3);
  assert.deepEqual(t.peek(w1), { action: 'left-half', index: 0 });
  t.reset(w1);
  assert.equal(t.peek(w1), null);
  assert.equal(t.advance(w1, 'left-half', 3), 0);
  t.advance(w2, 'top-half', 3);
  t.clear();
  assert.equal(t.peek(w1), null);
  assert.equal(t.peek(w2), null);
});

test('clear() invalidates existing entries without touching new ones', () => {
  const t = new CycleTracker();
  const w = {};
  t.advance(w, 'left-half', 3);
  t.clear();
  assert.equal(t.peek(w), null);
  assert.equal(t.advance(w, 'left-half', 3), 0); // starts fresh after clear
});
