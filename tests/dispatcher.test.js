// SPDX-License-Identifier: GPL-2.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ActionDispatcher } from '../untangler@bluvulture/actions.js';
import { Action, rectForAction } from '../untangler@bluvulture/geometry.js';
import { FakeSettings, FakeWindow, FakeMover } from './helpers/fakes.js';

const WA = { x: 0, y: 0, width: 1920, height: 1080 };

function setup(windowProps = {}, settingsOverrides = {}, moverOpts = {}) {
  const settings = new FakeSettings(settingsOverrides);
  const mover = new FakeMover({ workAreas: [WA], ...moverOpts });
  const win = new FakeWindow(windowProps);
  mover.setFocus(win);
  const dispatcher = new ActionDispatcher(settings, mover);
  return { settings, mover, win, dispatcher };
}

function lastApply(mover) {
  const applies = mover.calls.filter(c => c[0] === 'apply');
  return applies[applies.length - 1];
}

test('left-half snap applies the geometry rect and records a restore point', () => {
  const { mover, win, dispatcher } = setup();
  const before = { ...win.frame };
  dispatcher.run(Action.LEFT_HALF);
  mover.settle();
  assert.deepEqual(lastApply(mover)[2], rectForAction(WA, Action.LEFT_HALF, 0));
  dispatcher.run(Action.RESTORE);
  mover.settle();
  assert.deepEqual(lastApply(mover)[2], before);
});

test('repeated same-action presses cycle through the size table', () => {
  const { mover, dispatcher } = setup();
  dispatcher.run(Action.LEFT_HALF); mover.settle();
  dispatcher.run(Action.LEFT_HALF); mover.settle();
  assert.deepEqual(lastApply(mover)[2], rectForAction(WA, Action.LEFT_HALF, 1));
  dispatcher.run(Action.RIGHT_HALF); mover.settle();          // other action resets
  dispatcher.run(Action.LEFT_HALF); mover.settle();
  assert.deepEqual(lastApply(mover)[2], rectForAction(WA, Action.LEFT_HALF, 0));
});

test('cycle-sizes-enabled=false pins the cycle to index 0', () => {
  const { mover, dispatcher } = setup({}, { 'cycle-sizes-enabled': false });
  dispatcher.run(Action.LEFT_HALF); mover.settle();
  dispatcher.run(Action.LEFT_HALF); mover.settle();
  assert.deepEqual(lastApply(mover)[2], rectForAction(WA, Action.LEFT_HALF, 0));
});

test('manual move after a snap resets the cycle and re-baselines restore', () => {
  const { mover, win, dispatcher } = setup();
  dispatcher.run(Action.LEFT_HALF); mover.settle();
  win.frame = { x: 400, y: 300, width: 500, height: 400 };     // user drags it away
  const manual = { ...win.frame };
  dispatcher.run(Action.LEFT_HALF); mover.settle();            // starts over at index 0
  assert.deepEqual(lastApply(mover)[2], rectForAction(WA, Action.LEFT_HALF, 0));
  dispatcher.run(Action.RESTORE); mover.settle();
  assert.deepEqual(lastApply(mover)[2], manual);               // restore = re-baselined
});

test('min-size clamp: settle re-centers and the next press still cycles', () => {
  const { mover, dispatcher } = setup();
  mover.setClampSize({ width: 900, height: 800 });
  dispatcher.run(Action.LEFT_HALF); mover.settle();
  dispatcher.run(Action.LEFT_HALF); mover.settle();
  // The buggy path (settle not updating lastApplied) reads the re-centered
  // frame as a manual move and resets to index 0 — this asserts the advance.
  assert.deepEqual(lastApply(mover)[2], rectForAction(WA, Action.LEFT_HALF, 1));
});

test('fixed-size window: resize actions no-op, center still works', () => {
  const { mover, dispatcher } = setup({ resizable: false });
  dispatcher.run(Action.LEFT_HALF);
  assert.equal(mover.calls.filter(c => c[0] === 'apply').length, 0);
  dispatcher.run(Action.CENTER); mover.settle();
  const [, , rect, resize] = lastApply(mover);
  assert.equal(resize, false);
  assert.equal(rect.width, 800);                               // size preserved
});

test('maximized window is snappable (allows_resize false but maximized)', () => {
  const { mover, dispatcher } = setup({ maximized: true });
  dispatcher.run(Action.LEFT_HALF); mover.settle();
  assert.deepEqual(lastApply(mover)[2], rectForAction(WA, Action.LEFT_HALF, 0));
});

test('pair rects: both windows placed, both restorable, target raised', () => {
  const { mover, win: winA, dispatcher } = setup();
  const winB = new FakeWindow({ frame: { x: 900, y: 50, width: 700, height: 500 } });
  const beforeB = { ...winB.frame };
  const a = rectForAction(WA, Action.LEFT_HALF, 0);
  const b = rectForAction(WA, Action.RIGHT_HALF, 0);
  dispatcher.applyPairRects(winA, winB, a, b);
  mover.settle();
  assert.ok(mover.calls.some(c => c[0] === 'raise' && c[1] === winB.id));
  mover.setFocus(winB);
  dispatcher.run(Action.RESTORE); mover.settle();
  assert.deepEqual(lastApply(mover)[2], beforeB);
});

test('trackedRect: fresh after settle, null when frame drifts', () => {
  const { mover, win, dispatcher } = setup();
  dispatcher.run(Action.LEFT_HALF); mover.settle();
  const rect = rectForAction(WA, Action.LEFT_HALF, 0);
  assert.deepEqual(dispatcher.trackedRect(win, mover.frameRect(win)), rect);
  win.frame.x += 50;
  assert.equal(dispatcher.trackedRect(win, mover.frameRect(win)), null);
});

test('maximize is gated on canMaximize', () => {
  const { mover, dispatcher } = setup({ canMaximize: false });
  dispatcher.run(Action.MAXIMIZE);
  assert.equal(mover.calls.filter(c => c[0] === 'maximize').length, 0);
  const { mover: m2, dispatcher: d2 } = setup();
  d2.run(Action.MAXIMIZE);
  assert.equal(m2.calls.filter(c => c[0] === 'maximize').length, 1);
});

test('restore re-maximizes a window that was maximized before the first snap', () => {
  const { mover, dispatcher } = setup({ maximized: true });
  dispatcher.run(Action.LEFT_HALF); mover.settle();
  dispatcher.run(Action.RESTORE); mover.settle();
  assert.ok(mover.calls.some(c => c[0] === 'maximize'));
});

test('rects below MIN_PLACEMENT_PX are never applied', () => {
  const tinyWA = { x: 0, y: 0, width: 40, height: 40 };
  const { mover, dispatcher } = setup({}, {}, { workAreas: [tinyWA] });
  dispatcher.run(Action.FIRST_THIRD);                    // third of 40px = 13 < 16
  assert.equal(mover.calls.filter(c => c[0] === 'apply').length, 0);
});

test('zone maximize is gated on canMaximize too', () => {
  const { mover, win, dispatcher } = setup({ canMaximize: false });
  dispatcher.applyZone(win, { action: Action.MAXIMIZE, cycleIndex: 0 }, WA);
  assert.equal(mover.calls.filter(c => c[0] === 'maximize').length, 0);
});

test('monitor move maps the fractional rect', () => {
  const WA2 = { x: 1920, y: 0, width: 1920, height: 1080 };
  const { mover, win, dispatcher } = setup({}, {}, { workAreas: [WA, WA2] });
  dispatcher.run(Action.LEFT_HALF); mover.settle();
  win.monitor = 0;
  dispatcher.run(Action.NEXT_DISPLAY); mover.settle();
  const rect = lastApply(mover)[2];
  assert.equal(rect.x, 1920);                                   // left half of monitor 2
  assert.equal(rect.width, 960);
});

test('restore after a zone drop returns the pre-zone frame', () => {
  const { mover, win, dispatcher } = setup();
  const before = { ...win.frame };
  dispatcher.applyZone(win, { action: Action.LEFT_HALF, cycleIndex: 0 }, WA);
  mover.settle();
  dispatcher.run(Action.RESTORE); mover.settle();
  assert.deepEqual(lastApply(mover)[2], before);
});

test('restore after the maximize action returns the pre-maximize frame', () => {
  const { mover, win, dispatcher } = setup();
  const before = { ...win.frame };
  dispatcher.run(Action.MAXIMIZE);
  dispatcher.run(Action.RESTORE); mover.settle();
  assert.deepEqual(lastApply(mover)[2], before);
});

test('monitor move keeps the restore original and resets the cycle', () => {
  const WA2 = { x: 1920, y: 0, width: 1920, height: 1080 };
  const { mover, win, dispatcher } = setup({}, {}, { workAreas: [WA, WA2] });
  const before = { ...win.frame };
  dispatcher.run(Action.LEFT_HALF); mover.settle();
  dispatcher.run(Action.NEXT_DISPLAY); mover.settle();
  win.monitor = 1;
  dispatcher.run(Action.LEFT_HALF); mover.settle();
  assert.deepEqual(lastApply(mover)[2], rectForAction(WA2, Action.LEFT_HALF, 0));
  dispatcher.run(Action.RESTORE); mover.settle();
  assert.deepEqual(lastApply(mover)[2], before);
});

test('manual move before a zone drop re-baselines restore (purge on zone path)', () => {
  const { mover, win, dispatcher } = setup();
  dispatcher.run(Action.LEFT_HALF); mover.settle();
  win.frame = { x: 500, y: 400, width: 640, height: 480 };
  const manual = { ...win.frame };
  dispatcher.applyZone(win, { action: Action.RIGHT_HALF, cycleIndex: 0 }, WA);
  mover.settle();
  dispatcher.run(Action.RESTORE); mover.settle();
  assert.deepEqual(lastApply(mover)[2], manual);
});

test('sub-minimum monitor-move rects are refused even without a record', () => {
  const SMALL = { x: 1920, y: 0, width: 100, height: 100 };
  const { mover, win, dispatcher } = setup(
    { frame: { x: 0, y: 0, width: 90, height: 1080 } }, {}, { workAreas: [WA, SMALL] });
  dispatcher.run(Action.NEXT_DISPLAY);
  assert.equal(mover.calls.filter(c => c[0] === 'apply').length, 0);
});

test('dispatcher destroy is idempotent', () => {
  const { dispatcher } = setup();
  dispatcher.destroy();
  dispatcher.destroy();   // must not throw
});
