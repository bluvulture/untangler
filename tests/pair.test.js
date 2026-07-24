// SPDX-License-Identifier: GPL-2.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Action, NO_GAPS, rectForAction,
  pickPairSide, pairRects, insetFraction, rectContains,
} from '../untangler@bluvulture/geometry.js';

const WA = { x: 0, y: 0, width: 1200, height: 600 };
const GAPS = { outer: 10, inner: 8 };

test('pickPairSide: left of center → left, center and right → right', () => {
  const frame = { x: 100, y: 0, width: 400, height: 300 }; // center x = 300
  assert.equal(pickPairSide(299, frame), 'left');
  assert.equal(pickPairSide(300, frame), 'right'); // exact center → right (< rule)
  assert.equal(pickPairSide(301, frame), 'right');
  // offset frame on a second monitor
  const far = { x: 2000, y: 100, width: 600, height: 400 }; // center x = 2300
  assert.equal(pickPairSide(2299, far), 'left');
  assert.equal(pickPairSide(2300, far), 'right');
});

test('pairRects matches the rectForAction table (spec §3)', () => {
  for (const gaps of [NO_GAPS, GAPS]) {
    assert.deepEqual(pairRects(WA, 'left', false, gaps), {
      a: rectForAction(WA, Action.LEFT_HALF, 0, gaps),
      b: rectForAction(WA, Action.RIGHT_HALF, 0, gaps),
    });
    assert.deepEqual(pairRects(WA, 'left', true, gaps), {
      a: rectForAction(WA, Action.LEFT_HALF, 1, gaps),
      b: rectForAction(WA, Action.RIGHT_HALF, 2, gaps),
    });
    assert.deepEqual(pairRects(WA, 'right', false, gaps), {
      a: rectForAction(WA, Action.RIGHT_HALF, 0, gaps),
      b: rectForAction(WA, Action.LEFT_HALF, 0, gaps),
    });
    assert.deepEqual(pairRects(WA, 'right', true, gaps), {
      a: rectForAction(WA, Action.RIGHT_HALF, 1, gaps),
      b: rectForAction(WA, Action.LEFT_HALF, 2, gaps),
    });
  }
});

test('pairRects: halves complement exactly without gaps', () => {
  for (const side of ['left', 'right']) {
    for (const variant of [false, true]) {
      const { a, b } = pairRects(WA, side, variant, NO_GAPS);
      const [l, r] = side === 'left' ? [a, b] : [b, a];
      assert.equal(l.x, WA.x);
      assert.equal(l.x + l.width, r.x, `${side}/${variant}: adjacent`);
      assert.equal(r.x + r.width, WA.x + WA.width);
      assert.equal(l.width + r.width, WA.width);
    }
  }
});

test('pairRects: variant is a 2/3 + 1/3 split, A gets the two-thirds', () => {
  const { a, b } = pairRects(WA, 'left', true, NO_GAPS);
  assert.equal(a.width, 800);
  assert.equal(b.width, 400);
  const right = pairRects(WA, 'right', true, NO_GAPS);
  assert.equal(right.a.width, 800);
  assert.equal(right.a.x, 400);
  assert.equal(right.b.width, 400);
  assert.equal(right.b.x, 0);
});

test('pairRects: gap seam is exactly the inner gap, outer edges respect the outer gap', () => {
  for (const side of ['left', 'right']) {
    for (const variant of [false, true]) {
      const { a, b } = pairRects(WA, side, variant, GAPS);
      const [l, r] = side === 'left' ? [a, b] : [b, a];
      assert.equal(r.x - (l.x + l.width), GAPS.inner, `${side}/${variant}: seam`);
      assert.equal(l.x, WA.x + GAPS.outer);
      assert.equal(r.x + r.width, WA.x + WA.width - GAPS.outer);
      assert.equal(l.y, WA.y + GAPS.outer);
      assert.equal(l.height, WA.height - 2 * GAPS.outer);
    }
  }
});

test('insetFraction: 0.25 leaves the central 50% × 50%, with rounding', () => {
  assert.deepEqual(insetFraction({ x: 0, y: 0, width: 400, height: 300 }, 0.25, 0.25),
    { x: 100, y: 75, width: 200, height: 150 });
  assert.deepEqual(insetFraction({ x: 0, y: 0, width: 401, height: 301 }, 0.25, 0.25),
    { x: 100, y: 75, width: 201, height: 151 });
  assert.deepEqual(insetFraction({ x: 50, y: 60, width: 100, height: 100 }, 0, 0),
    { x: 50, y: 60, width: 100, height: 100 });
});

test('rectContains is half-open', () => {
  const r = { x: 10, y: 20, width: 100, height: 50 };
  assert.equal(rectContains(r, 10, 20), true);
  assert.equal(rectContains(r, 109, 69), true);
  assert.equal(rectContains(r, 110, 20), false);
  assert.equal(rectContains(r, 10, 70), false);
  assert.equal(rectContains(r, 9, 20), false);
});

test('pairRects with pathological gaps still yields placeable rects', () => {
  const wa = { x: 0, y: 0, width: 400, height: 300 };
  const { a, b } = pairRects(wa, 'left', true, { outer: 128, inner: 128 });
  assert.ok(a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0);
});
