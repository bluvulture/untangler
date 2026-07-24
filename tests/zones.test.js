// SPDX-License-Identifier: GPL-2.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Action, resolveZone, zoneRect } from '../untangler@bluvulture/geometry.js';

const WA = { x: 0, y: 0, width: 1920, height: 1080 };

function zone(x, y, opts = {}) {
  return resolveZone(x, y, WA, opts);
}

test('dead center resolves to nothing', () => {
  assert.equal(zone(960, 540), null);
});

test('top edge center 50% → maximize; outer 25% strips → nothing', () => {
  assert.deepEqual(zone(960, 8), { action: Action.MAXIMIZE, cycleIndex: 0 });
  assert.deepEqual(zone(480, 8), { action: Action.MAXIMIZE, cycleIndex: 0 }); // inclusive left boundary
  assert.equal(zone(100, 8), null);
  assert.equal(zone(1800, 8), null);
});

test('left/right edge middle band → halves', () => {
  assert.deepEqual(zone(8, 540), { action: Action.LEFT_HALF, cycleIndex: 0 });
  assert.deepEqual(zone(1912, 540), { action: Action.RIGHT_HALF, cycleIndex: 0 });
});

test('left/right edge top and bottom bands → quarters', () => {
  assert.deepEqual(zone(8, 100), { action: Action.TOP_LEFT_QUARTER, cycleIndex: 0 });
  assert.deepEqual(zone(8, 1000), { action: Action.BOTTOM_LEFT_QUARTER, cycleIndex: 0 });
  assert.deepEqual(zone(1912, 100), { action: Action.TOP_RIGHT_QUARTER, cycleIndex: 0 });
  assert.deepEqual(zone(1912, 1000), { action: Action.BOTTOM_RIGHT_QUARTER, cycleIndex: 0 });
});

test('band boundary: 25%/75% of height split quarter vs half', () => {
  assert.deepEqual(zone(8, 269).action, Action.TOP_LEFT_QUARTER);   // < 270 (25%)
  assert.deepEqual(zone(8, 270).action, Action.LEFT_HALF);          // >= 25%
  assert.deepEqual(zone(8, 809).action, Action.LEFT_HALF);          // < 810 (75%)
  assert.deepEqual(zone(8, 810).action, Action.BOTTOM_LEFT_QUARTER);// >= 75%
});

test('corner hot zones (24px) → quarters, and beat the edge bands', () => {
  assert.deepEqual(zone(10, 10), { action: Action.TOP_LEFT_QUARTER, cycleIndex: 0 });
  assert.deepEqual(zone(1910, 10), { action: Action.TOP_RIGHT_QUARTER, cycleIndex: 0 });
  assert.deepEqual(zone(10, 1070), { action: Action.BOTTOM_LEFT_QUARTER, cycleIndex: 0 });
  assert.deepEqual(zone(1910, 1070), { action: Action.BOTTOM_RIGHT_QUARTER, cycleIndex: 0 });
});

test('bottom edge thirds', () => {
  assert.deepEqual(zone(300, 1075), { action: Action.FIRST_THIRD, cycleIndex: 0 });
  assert.deepEqual(zone(960, 1075), { action: Action.CENTER_THIRD, cycleIndex: 0 });
  assert.deepEqual(zone(1600, 1075), { action: Action.LAST_THIRD, cycleIndex: 0 });
});

test('variant modifier upgrades halves/quarters to two-thirds/sixths', () => {
  assert.deepEqual(zone(8, 540, { variant: true }), { action: Action.LEFT_HALF, cycleIndex: 1 });
  assert.deepEqual(zone(8, 100, { variant: true }), { action: Action.TOP_LEFT_QUARTER, cycleIndex: 1 });
  assert.deepEqual(zone(10, 10, { variant: true }), { action: Action.TOP_LEFT_QUARTER, cycleIndex: 1 });
  // maximize and thirds are unaffected
  assert.deepEqual(zone(960, 8, { variant: true }), { action: Action.MAXIMIZE, cycleIndex: 0 });
  assert.deepEqual(zone(960, 1075, { variant: true }), { action: Action.CENTER_THIRD, cycleIndex: 0 });
});

test('pointer outside the work area clamps into the nearest band', () => {
  const wa = { x: 0, y: 32, width: 1920, height: 1048 }; // top panel strut
  assert.deepEqual(resolveZone(960, 2, wa), { action: Action.MAXIMIZE, cycleIndex: 0 });
  assert.deepEqual(resolveZone(-5, 500, wa), { action: Action.LEFT_HALF, cycleIndex: 0 });
});

test('custom bandPx is honored', () => {
  assert.equal(zone(20, 540), null);                         // outside default 16px band
  assert.deepEqual(zone(20, 540, { bandPx: 32 }).action, Action.LEFT_HALF);
});

test('offset work area (second monitor)', () => {
  const wa = { x: 1920, y: 0, width: 1920, height: 1080 };
  assert.deepEqual(resolveZone(1928, 540, wa), { action: Action.LEFT_HALF, cycleIndex: 0 });
  assert.deepEqual(resolveZone(3832, 540, wa), { action: Action.RIGHT_HALF, cycleIndex: 0 });
});

test('zoneRect: maximize previews the full work area, others use rectForAction', () => {
  assert.deepEqual(zoneRect({ action: Action.MAXIMIZE, cycleIndex: 0 }, WA),
    { x: 0, y: 0, width: 1920, height: 1080 });
  assert.deepEqual(zoneRect({ action: Action.LEFT_HALF, cycleIndex: 0 }, WA),
    { x: 0, y: 0, width: 960, height: 1080 });
  assert.deepEqual(zoneRect({ action: Action.LEFT_HALF, cycleIndex: 1 }, WA),
    { x: 0, y: 0, width: 1280, height: 1080 });
});
