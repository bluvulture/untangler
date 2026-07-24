// SPDX-License-Identifier: GPL-2.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Action, NO_GAPS, rectForAction, matchSnappedRect, splitFootprint,
  MIN_PLACEMENT_PX,
} from '../untangler@bluvulture/geometry.js';

const WA = { x: 0, y: 0, width: 1920, height: 1080 };
const GAPS = { outer: 10, inner: 8 };

test('matchSnappedRect recognizes canonical snap rects, with and without gaps', () => {
  for (const gaps of [NO_GAPS, GAPS]) {
    for (const [action, index] of [
      [Action.LEFT_HALF, 0], [Action.RIGHT_HALF, 1], [Action.TOP_HALF, 2],
      [Action.TOP_LEFT_QUARTER, 0], [Action.BOTTOM_RIGHT_QUARTER, 1],
      [Action.CENTER_THIRD, 0],
    ]) {
      const rect = rectForAction(WA, action, index, gaps);
      assert.deepEqual(matchSnappedRect(rect, WA, gaps), rect, `${action}:${index}`);
    }
  }
});

test('matchSnappedRect tolerates ±2px and rejects beyond', () => {
  const half = rectForAction(WA, Action.LEFT_HALF, 0);
  assert.deepEqual(
    matchSnappedRect({ ...half, x: half.x + 2, width: half.width - 1 }, WA), half);
  assert.equal(matchSnappedRect({ ...half, x: half.x + 3 }, WA), null);
});

test('matchSnappedRect rejects floating and almost-maximized rects', () => {
  assert.equal(matchSnappedRect({ x: 200, y: 150, width: 800, height: 500 }, WA), null);
  assert.equal(matchSnappedRect(rectForAction(WA, Action.ALMOST_MAXIMIZE, 0), WA), null);
});

test('splitFootprint: tall footprint splits top/bottom, pointer picks the end', () => {
  const half = { x: 0, y: 0, width: 960, height: 1080 };
  assert.deepEqual(splitFootprint(half, 480, 100, false),
    { a: { x: 0, y: 0, width: 960, height: 540 }, b: { x: 0, y: 540, width: 960, height: 540 } });
  assert.deepEqual(splitFootprint(half, 480, 900, false),
    { a: { x: 0, y: 540, width: 960, height: 540 }, b: { x: 0, y: 0, width: 960, height: 540 } });
});

test('splitFootprint: wide splits left/right; square defaults left/right', () => {
  const top = { x: 0, y: 0, width: 1920, height: 540 };
  assert.deepEqual(splitFootprint(top, 400, 200, false),
    { a: { x: 0, y: 0, width: 960, height: 540 }, b: { x: 960, y: 0, width: 960, height: 540 } });
  const square = { x: 100, y: 100, width: 500, height: 500 };
  assert.deepEqual(splitFootprint(square, 150, 300, false),
    { a: { x: 100, y: 100, width: 250, height: 500 }, b: { x: 350, y: 100, width: 250, height: 500 } });
});

test('splitFootprint: variant gives the dragged window two thirds on its end', () => {
  const half = { x: 960, y: 0, width: 960, height: 1080 };
  assert.deepEqual(splitFootprint(half, 1400, 100, true),
    { a: { x: 960, y: 0, width: 960, height: 720 }, b: { x: 960, y: 720, width: 960, height: 360 } });
  assert.deepEqual(splitFootprint(half, 1400, 1000, true),
    { a: { x: 960, y: 360, width: 960, height: 720 }, b: { x: 960, y: 0, width: 960, height: 360 } });
});

test('splitFootprint: inner gap seam is exact for even and odd gaps', () => {
  const half = { x: 0, y: 0, width: 960, height: 1080 };
  const even = splitFootprint(half, 480, 100, false, 8);
  assert.deepEqual(even.a, { x: 0, y: 0, width: 960, height: 536 });
  assert.deepEqual(even.b, { x: 0, y: 544, width: 960, height: 536 });
  assert.equal(even.b.y - (even.a.y + even.a.height), 8);
  const odd = splitFootprint(half, 480, 100, false, 7);
  assert.equal(odd.b.y - (odd.a.y + odd.a.height), 7);
  assert.equal(odd.a.height + odd.b.height + 7, half.height);
});

test('splitFootprint refuses when pieces would fall below MIN_PLACEMENT_PX', () => {
  // 30 wide, horizontal split -> pieces of 15 < 16: refuse
  assert.equal(splitFootprint({ x: 0, y: 0, width: 30, height: 20 }, 10, 10, false), null);
  // cross-axis below MIN: refuse even though split pieces are large enough
  assert.equal(splitFootprint({ x: 0, y: 0, width: 200, height: 12 }, 10, 6, false), null);
  // comfortably large: never refused
  assert.notEqual(splitFootprint({ x: 0, y: 0, width: 200, height: 100 }, 10, 10, false), null);
});

test('splitFootprint clamps inner gap to keep pieces >= MIN', () => {
  const fp = { x: 0, y: 0, width: 300, height: 100 };            // horizontal split
  const { a, b } = splitFootprint(fp, 10, 50, false, 300);        // gap > bound 2*(150-16)=268
  assert.equal(a.width, MIN_PLACEMENT_PX);                        // clamp pins each piece to exactly MIN
  assert.equal(b.width, MIN_PLACEMENT_PX);
  assert.equal(a.width + b.width + (b.x - (a.x + a.width)), 300); // still tiles exactly
});

test('splitFootprint: horizontal-axis seam with gap is exact', () => {
  const fp = { x: 100, y: 0, width: 960, height: 400 };           // wide -> left/right
  const { a, b } = splitFootprint(fp, 150, 200, false, 8);
  assert.equal(b.x - (a.x + a.width), 8);
  assert.equal(a.x, 100);
  assert.equal(b.x + b.width, 1060);
});

test('variant split seam with gap stays exactly the gap', () => {
  const fp = { x: 0, y: 0, width: 960, height: 1080 };  // vertical split
  const { a, b } = splitFootprint(fp, 480, 100, true, 8);
  assert.equal(b.y - (a.y + a.height), 8);
  assert.equal(a.height + b.height + 8, 1080);
});
