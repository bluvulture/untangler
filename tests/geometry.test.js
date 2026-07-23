import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Action, NO_GAPS, cycleLength, rectForAction, centerRect,
  mapRectToWorkArea, recenterWithin, rectsEqual,
} from '../untangler@nebojsa.ilic/geometry.js';

const WA = { x: 0, y: 0, width: 1200, height: 600 };
const WA_OFF = { x: 100, y: 50, width: 1200, height: 600 };
const GAPS = { outer: 10, inner: 8 };

function eq(actual, expected, msg) {
  assert.deepEqual(actual, expected, msg);
}

// --- Cycle lengths (spec 3.1) ---
test('cycleLength: halves cycle 3, quarters 2, rest 1', () => {
  assert.equal(cycleLength(Action.LEFT_HALF), 3);
  assert.equal(cycleLength(Action.RIGHT_HALF), 3);
  assert.equal(cycleLength(Action.TOP_HALF), 3);
  assert.equal(cycleLength(Action.BOTTOM_HALF), 3);
  assert.equal(cycleLength(Action.TOP_LEFT_QUARTER), 2);
  assert.equal(cycleLength(Action.BOTTOM_RIGHT_QUARTER), 2);
  assert.equal(cycleLength(Action.FIRST_THIRD), 1);
  assert.equal(cycleLength(Action.ALMOST_MAXIMIZE), 1);
  assert.equal(cycleLength(Action.MAXIMIZE), 1);
});

// --- Halves: 1/2 → 2/3 → 1/3 (spec 3.1) ---
test('left half cycle', () => {
  eq(rectForAction(WA, Action.LEFT_HALF, 0), { x: 0, y: 0, width: 600, height: 600 });
  eq(rectForAction(WA, Action.LEFT_HALF, 1), { x: 0, y: 0, width: 800, height: 600 });
  eq(rectForAction(WA, Action.LEFT_HALF, 2), { x: 0, y: 0, width: 400, height: 600 });
});

test('right half cycle (anchored to right edge)', () => {
  eq(rectForAction(WA, Action.RIGHT_HALF, 0), { x: 600, y: 0, width: 600, height: 600 });
  eq(rectForAction(WA, Action.RIGHT_HALF, 1), { x: 400, y: 0, width: 800, height: 600 });
  eq(rectForAction(WA, Action.RIGHT_HALF, 2), { x: 800, y: 0, width: 400, height: 600 });
});

test('top and bottom half cycles', () => {
  eq(rectForAction(WA, Action.TOP_HALF, 0), { x: 0, y: 0, width: 1200, height: 300 });
  eq(rectForAction(WA, Action.TOP_HALF, 1), { x: 0, y: 0, width: 1200, height: 400 });
  eq(rectForAction(WA, Action.TOP_HALF, 2), { x: 0, y: 0, width: 1200, height: 200 });
  eq(rectForAction(WA, Action.BOTTOM_HALF, 0), { x: 0, y: 300, width: 1200, height: 300 });
  eq(rectForAction(WA, Action.BOTTOM_HALF, 1), { x: 0, y: 200, width: 1200, height: 400 });
  eq(rectForAction(WA, Action.BOTTOM_HALF, 2), { x: 0, y: 400, width: 1200, height: 200 });
});

// --- Quarters: 1/4 → 1/6 (⅓ width × ½ height, spec 3.1) ---
test('quarter cycles', () => {
  eq(rectForAction(WA, Action.TOP_LEFT_QUARTER, 0), { x: 0, y: 0, width: 600, height: 300 });
  eq(rectForAction(WA, Action.TOP_LEFT_QUARTER, 1), { x: 0, y: 0, width: 400, height: 300 });
  eq(rectForAction(WA, Action.TOP_RIGHT_QUARTER, 0), { x: 600, y: 0, width: 600, height: 300 });
  eq(rectForAction(WA, Action.TOP_RIGHT_QUARTER, 1), { x: 800, y: 0, width: 400, height: 300 });
  eq(rectForAction(WA, Action.BOTTOM_LEFT_QUARTER, 0), { x: 0, y: 300, width: 600, height: 300 });
  eq(rectForAction(WA, Action.BOTTOM_LEFT_QUARTER, 1), { x: 0, y: 300, width: 400, height: 300 });
  eq(rectForAction(WA, Action.BOTTOM_RIGHT_QUARTER, 0), { x: 600, y: 300, width: 600, height: 300 });
  eq(rectForAction(WA, Action.BOTTOM_RIGHT_QUARTER, 1), { x: 800, y: 300, width: 400, height: 300 });
});

// --- Thirds (spec 3.1) ---
test('vertical thirds', () => {
  eq(rectForAction(WA, Action.FIRST_THIRD, 0), { x: 0, y: 0, width: 400, height: 600 });
  eq(rectForAction(WA, Action.CENTER_THIRD, 0), { x: 400, y: 0, width: 400, height: 600 });
  eq(rectForAction(WA, Action.LAST_THIRD, 0), { x: 800, y: 0, width: 400, height: 600 });
});

// --- Almost maximize: 90 % centered (spec 3.1) ---
test('almost maximize', () => {
  eq(rectForAction(WA, Action.ALMOST_MAXIMIZE, 0), { x: 60, y: 30, width: 1080, height: 540 });
});

// --- Work area offsets are respected (multi-monitor / panels) ---
test('offset work area', () => {
  eq(rectForAction(WA_OFF, Action.LEFT_HALF, 0), { x: 100, y: 50, width: 600, height: 600 });
  eq(rectForAction(WA_OFF, Action.BOTTOM_RIGHT_QUARTER, 0), { x: 700, y: 350, width: 600, height: 300 });
});

// --- Cycle index out of range wraps into the table ---
test('cycle index wraps modulo table length', () => {
  eq(rectForAction(WA, Action.LEFT_HALF, 3), rectForAction(WA, Action.LEFT_HALF, 0));
  eq(rectForAction(WA, Action.TOP_LEFT_QUARTER, 2), rectForAction(WA, Action.TOP_LEFT_QUARTER, 0));
});

// --- Gaps (spec 3.5): outer inset, inner as half-gap on shared edges ---
test('gaps: left/right halves', () => {
  eq(rectForAction(WA, Action.LEFT_HALF, 0, GAPS), { x: 10, y: 10, width: 586, height: 580 });
  eq(rectForAction(WA, Action.RIGHT_HALF, 0, GAPS), { x: 604, y: 10, width: 586, height: 580 });
});

test('gaps: adjacent halves are exactly inner-gap apart and fill the work area', () => {
  const l = rectForAction(WA, Action.LEFT_HALF, 0, GAPS);
  const r = rectForAction(WA, Action.RIGHT_HALF, 0, GAPS);
  assert.equal(r.x - (l.x + l.width), GAPS.inner);
  assert.equal(l.x, WA.x + GAPS.outer);
  assert.equal(r.x + r.width, WA.x + WA.width - GAPS.outer);
});

test('gaps: quarters share both edges correctly', () => {
  eq(rectForAction(WA, Action.TOP_LEFT_QUARTER, 0, GAPS), { x: 10, y: 10, width: 586, height: 286 });
  eq(rectForAction(WA, Action.BOTTOM_LEFT_QUARTER, 0, GAPS), { x: 10, y: 304, width: 586, height: 286 });
});

test('gaps: three thirds tile the row exactly', () => {
  const a = rectForAction(WA, Action.FIRST_THIRD, 0, GAPS);
  const b = rectForAction(WA, Action.CENTER_THIRD, 0, GAPS);
  const c = rectForAction(WA, Action.LAST_THIRD, 0, GAPS);
  assert.equal(b.x - (a.x + a.width), GAPS.inner);
  assert.equal(c.x - (b.x + b.width), GAPS.inner);
  assert.equal(a.x, 10);
  assert.equal(c.x + c.width, 1190);
});

// --- Odd sizes: halves stay exactly adjacent, no 1px overlap/hole ---
test('odd work-area width: halves partition exactly', () => {
  const wa = { x: 0, y: 0, width: 1201, height: 601 };
  const l = rectForAction(wa, Action.LEFT_HALF, 0);
  const r = rectForAction(wa, Action.RIGHT_HALF, 0);
  assert.equal(l.width + r.width, 1201);
  assert.equal(l.x + l.width, r.x);
});

// --- centerRect (spec 3.1 Center: no resize) ---
test('centerRect keeps size and centers', () => {
  eq(centerRect(WA, { x: 5, y: 5, width: 400, height: 300 }), { x: 400, y: 150, width: 400, height: 300 });
  eq(centerRect(WA, { x: 5, y: 5, width: 400, height: 300 }, GAPS), { x: 400, y: 150, width: 400, height: 300 });
});

// --- mapRectToWorkArea (spec 3.4: same relative rect on target monitor) ---
test('mapRectToWorkArea maps fractions', () => {
  const from = { x: 0, y: 0, width: 1000, height: 500 };
  const to = { x: 1000, y: 0, width: 2000, height: 1000 };
  eq(mapRectToWorkArea({ x: 500, y: 0, width: 500, height: 500 }, from, to),
    { x: 2000, y: 0, width: 1000, height: 1000 });
  eq(mapRectToWorkArea({ x: 250, y: 125, width: 500, height: 250 }, from, to),
    { x: 1500, y: 250, width: 1000, height: 500 });
});

// --- recenterWithin (spec 3.7 min-size clamp handling) ---
test('recenterWithin centers the clamped size in the target', () => {
  eq(recenterWithin({ x: 0, y: 0, width: 600, height: 600 }, 500, 400),
    { x: 50, y: 100, width: 500, height: 400 });
});

// --- rectsEqual ---
test('rectsEqual with tolerance', () => {
  const a = { x: 0, y: 0, width: 100, height: 100 };
  assert.equal(rectsEqual(a, { x: 2, y: -2, width: 101, height: 99 }, 2), true);
  assert.equal(rectsEqual(a, { x: 3, y: 0, width: 100, height: 100 }, 2), false);
  assert.equal(rectsEqual(a, { ...a }), true);
});

// --- Unknown/no-geometry actions throw ---
test('rectForAction throws for actions without geometry', () => {
  for (const action of [Action.MAXIMIZE, Action.CENTER, Action.RESTORE, Action.NEXT_DISPLAY, Action.PREV_DISPLAY, 'nonsense'])
    assert.throws(() => rectForAction(WA, action, 0), /no geometry/i);
});
