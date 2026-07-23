# Untangler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build **Untangler**, a GNOME Shell extension (GNOME 46–48, Wayland+X11) that replicates Rectangle's keyboard window snapping — 17 actions with repeated-press size cycling, restore, gaps, multi-monitor throws — plus extended drag snap zones with a live translucent preview.

**Spec:** `docs/untangler-spec.md` (the authoritative requirements document; section numbers below refer to it).

**Architecture:** All geometry math lives in pure, Node-testable modules (`geometry.js`, `cycle.js`) with zero GNOME imports. A thin Mutter-facing layer (`mover.js`, `keybindings.js`, `dragsnap.js`, `preview.js`) applies rects, registers shortcuts, and tracks drags. `actions.js` orchestrates between them without touching `gi://` directly. `prefs.js` is a separate-process GTK4/Adwaita dialog communicating only via GSettings.

**Tech Stack:** GJS (GNOME Shell 46–48 ESM style), GTK4/libadwaita for prefs, GSettings schema, Node 24 built-in test runner (`node --test`) for the pure modules.

## Global Constraints

Every task implicitly includes these. Copy-exact values; do not improvise.

- Extension UUID: `untangler@nebojsa.ilic` — also the name of the extension source directory.
- Extension display name: `Untangler`.
- GSettings schema id: `org.gnome.shell.extensions.untangler`, path `/org/gnome/shell/extensions/untangler/`.
- `metadata.json` `shell-version`: `["46", "47", "48"]`. Host machine runs GNOME Shell **46.0** — that is the only version we can manually verify on.
- Import style: GNOME 45+ ESM only — `import Meta from 'gi://Meta'`, `import * as Main from 'resource:///org/gnome/shell/ui/main.js'`. Never `imports.ui.*`, never `Lang`, never `Mainloop`.
- **Purity rule:** `geometry.js` and `cycle.js` MUST NOT import anything from `gi://` or `resource:///`. They must run under plain Node. Only `mover.js`, `keybindings.js`, `dragsnap.js`, `preview.js`, `extension.js` may touch Shell/Mutter APIs. `actions.js` imports only from `geometry.js`/`cycle.js` and receives a `WindowMover` instance for all Mutter access. `prefs.js` may import `gi://Gtk`, `gi://Adw`, `gi://Gio`, `gi://Gdk` and the prefs resource — never Shell UI modules.
- Every signal connection, `GLib.timeout_add`, `GLib.idle_add`, and every created actor MUST be disconnected/removed/destroyed in `disable()`/`destroy()` (EGO review requirement, spec 4.2/4.4).
- CSS class for the drag preview: `.untangler-zone-preview`.
- Rects are plain objects `{x, y, width, height}` (integers, logical pixels) everywhere outside Mutter calls.
- Gaps object shape: `{outer: int, inner: int}`.
- Test command: `npm test` (runs bare `node --test`, which auto-discovers `tests/*.test.js`; a directory positional arg is broken on Node 24). Syntax check: `npm run check`.
- Commit after every task with the message given in the task. Working directly on `main` (fresh repo, no remote).

## Repository Layout (final state)

```
untangler/                              # repo root
├── docs/
│   ├── untangler-spec.md               # the spec (already present)
│   └── superpowers/plans/2026-07-23-untangler.md
├── package.json                        # "type": "module", test scripts
├── .gitignore
├── scripts/install.sh                  # symlink dev-install + schema compile
├── README.md                           # Task 7
├── docs/TESTING.md                     # Task 7 manual test matrix
├── tests/
│   ├── geometry.test.js                # Task 1
│   ├── cycle.test.js                   # Task 2
│   └── zones.test.js                   # Task 3
└── untangler@nebojsa.ilic/             # extension source (symlinked into ~/.local/share/gnome-shell/extensions)
    ├── metadata.json                   # Task 4
    ├── extension.js                    # Task 4 (+ Task 5 edit)
    ├── geometry.js                     # Task 1 (+ Task 3 additions)
    ├── cycle.js                        # Task 2
    ├── mover.js                        # Task 4
    ├── actions.js                      # Task 4 (+ Task 5 edit: applyZone already included)
    ├── keybindings.js                  # Task 4
    ├── dragsnap.js                     # Task 5
    ├── preview.js                      # Task 5
    ├── prefs.js                        # Task 6
    ├── stylesheet.css                  # Task 5
    └── schemas/
        └── org.gnome.shell.extensions.untangler.gschema.xml   # Task 4
```

## Documented Design Decisions (deviations from spec letter, kept to spec intent)

Reviewers: these are deliberate; do not flag them as bugs.

1. **Lazy manual-move detection** (spec 3.2/3.3 suggests `position-changed`/`size-changed` signals): instead of per-window signal connections, the dispatcher stores the last rect it applied and compares against the current frame rect *at the next action press*. If they differ (>2 px tolerance), the cycle resets and stored restore geometry is invalidated — same observable behavior, zero persistent per-window signals to leak (EGO-friendlier).
2. **Esc-cancel heuristic** (spec 3.6): Mutter's `grab-op-end` doesn't report cancellation. We record the frame rect at `grab-op-begin`; if at `grab-op-end` the frame is back at that exact rect (±1 px), we treat the drag as cancelled and do not snap.
3. **Restore geometry recorded on drag-snap** (spec 3.6): at drop time the window has already been dragged, so the "original" we record is the drop-time frame (pre-drag *size*, position under the pointer). Matches GNOME's native untile behavior.
4. **`Meta.MaximizeFlags` feature detection**: GNOME 48 removed `Meta.MaximizeFlags` and the flag arguments to `maximize()`/`unmaximize()`. `mover.js` feature-detects via try/catch once and calls the right arity. This is the only place in the codebase that handles it.
5. **Variant modifier also applies to corner hot zones** (spec table only mentions edge bands): corners produce the same quarter actions as the edge top/bottom bands, so the modifier consistently upgrades them to sixths too.
6. **Corner hot-zone size fixed at 24 px** — the spec's schema excerpt (4.5) is normative and has no corner-size key.
7. **"Restore on drag" toggle** listed in spec 4.6 has no defined behavior anywhere in the spec — omitted (YAGNI).
8. **`edge-tiling-suppressed` extra schema key** (not in spec excerpt): needed to make crash-recovery of the user's `edge-tiling` value robust (spec §7 risk table demands this) — without it, re-suppressing after a crash would overwrite the saved user value with our own `false`.
9. **Settle-callback expectation tracking** (post-review fix, Task 4): `WindowMover.apply` reports the final placed rect via `onSettled`; the dispatcher records it as the new `lastApplied` and suppresses manual-change detection while a placement is settling. Without this, min-size read-back re-centering (spec 3.7) would be mistaken for a manual move — resetting the cycle and discarding restore geometry — and Center on a maximized window would land at the work-area origin instead of centered (the deferred read-back now covers move-only placements too, which is what fixes Center).

---

### Task 1: GeometryEngine core + repo scaffolding

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `untangler@nebojsa.ilic/geometry.js`
- Test: `tests/geometry.test.js`

**Interfaces:**
- Consumes: nothing (first task).
- Produces (later tasks import these from `./geometry.js`):
  - `Action` — frozen enum object; values are kebab-case strings (`Action.LEFT_HALF === 'left-half'`, etc. — full list in code below).
  - `NO_GAPS` — frozen `{outer: 0, inner: 0}`.
  - `cycleLength(action) → int` — 3 for halves, 2 for quarters, 1 for everything else.
  - `rectForAction(workArea, action, cycleIndex = 0, gaps = NO_GAPS) → {x,y,width,height}` — throws for actions with no geometry (`maximize`, `center`, `restore`, `next-display`, `prev-display`).
  - `centerRect(workArea, windowRect, gaps = NO_GAPS) → rect` (same size, centered).
  - `mapRectToWorkArea(rect, fromWorkArea, toWorkArea) → rect` (fractional mapping).
  - `recenterWithin(target, actualWidth, actualHeight) → rect`.
  - `rectsEqual(a, b, tolerance = 0) → boolean`.

- [ ] **Step 1: Scaffold the repo**

Create `package.json`:

```json
{
  "name": "untangler",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "check": "for f in 'untangler@nebojsa.ilic'/*.js; do node --check \"$f\" || exit 1; done"
  }
}
```

Create `.gitignore`:

```
node_modules/
*.zip
untangler@nebojsa.ilic/schemas/gschemas.compiled
```

Create the directories: `mkdir -p 'untangler@nebojsa.ilic/schemas' tests scripts`

- [ ] **Step 2: Write the failing tests**

Create `tests/geometry.test.js` exactly:

```js
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
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module` referencing `geometry.js` (ERR_MODULE_NOT_FOUND).

- [ ] **Step 4: Implement `untangler@nebojsa.ilic/geometry.js`**

```js
// geometry.js — GeometryEngine: pure functions only (spec §2 key principle).
// MUST NOT import from gi:// or resource:/// — this file runs under plain
// Node for unit tests and is the extension's Shell-API-free core.

export const Action = Object.freeze({
    LEFT_HALF: 'left-half',
    RIGHT_HALF: 'right-half',
    TOP_HALF: 'top-half',
    BOTTOM_HALF: 'bottom-half',
    TOP_LEFT_QUARTER: 'top-left-quarter',
    TOP_RIGHT_QUARTER: 'top-right-quarter',
    BOTTOM_LEFT_QUARTER: 'bottom-left-quarter',
    BOTTOM_RIGHT_QUARTER: 'bottom-right-quarter',
    FIRST_THIRD: 'first-third',
    CENTER_THIRD: 'center-third',
    LAST_THIRD: 'last-third',
    MAXIMIZE: 'maximize',
    ALMOST_MAXIMIZE: 'almost-maximize',
    CENTER: 'center',
    RESTORE: 'restore',
    NEXT_DISPLAY: 'next-display',
    PREV_DISPLAY: 'prev-display',
});

export const NO_GAPS = Object.freeze({ outer: 0, inner: 0 });

// [startFraction, endFraction] spans per cycle step (spec 3.1):
// halves cycle 1/2 → 2/3 → 1/3 anchored to their edge; quarters 1/4 → 1/6
// (the 1/6 variant is a third along the long axis × half along the short).
const LEAD_HALF = [[0, 1 / 2], [0, 2 / 3], [0, 1 / 3]];
const TRAIL_HALF = [[1 / 2, 1], [1 / 3, 1], [2 / 3, 1]];
const LEAD_QUARTER = [[0, 1 / 2], [0, 1 / 3]];
const TRAIL_QUARTER = [[1 / 2, 1], [2 / 3, 1]];
const FULL = [[0, 1]];
const TOP = [[0, 1 / 2]];
const BOTTOM = [[1 / 2, 1]];

const SPANS = {
    [Action.LEFT_HALF]: { h: LEAD_HALF, v: FULL },
    [Action.RIGHT_HALF]: { h: TRAIL_HALF, v: FULL },
    [Action.TOP_HALF]: { h: FULL, v: LEAD_HALF },
    [Action.BOTTOM_HALF]: { h: FULL, v: TRAIL_HALF },
    [Action.TOP_LEFT_QUARTER]: { h: LEAD_QUARTER, v: TOP },
    [Action.TOP_RIGHT_QUARTER]: { h: TRAIL_QUARTER, v: TOP },
    [Action.BOTTOM_LEFT_QUARTER]: { h: LEAD_QUARTER, v: BOTTOM },
    [Action.BOTTOM_RIGHT_QUARTER]: { h: TRAIL_QUARTER, v: BOTTOM },
    [Action.FIRST_THIRD]: { h: [[0, 1 / 3]], v: FULL },
    [Action.CENTER_THIRD]: { h: [[1 / 3, 2 / 3]], v: FULL },
    [Action.LAST_THIRD]: { h: [[2 / 3, 1]], v: FULL },
};

export function cycleLength(action) {
    const spans = SPANS[action];
    if (!spans)
        return 1;
    return Math.max(spans.h.length, spans.v.length);
}

export function rectForAction(workArea, action, cycleIndex = 0, gaps = NO_GAPS) {
    if (action === Action.ALMOST_MAXIMIZE)
        return almostMaximize(workArea, gaps);
    const spans = SPANS[action];
    if (!spans)
        throw new Error(`Action "${action}" has no geometry`);
    const h = spans.h[cycleIndex % spans.h.length];
    const v = spans.v[cycleIndex % spans.v.length];
    const inner = insetAll(workArea, gaps.outer);
    const hs = span(inner.x, inner.width, h[0], h[1], gaps.inner);
    const vs = span(inner.y, inner.height, v[0], v[1], gaps.inner);
    return { x: hs.pos, y: vs.pos, width: hs.size, height: vs.size };
}

export function centerRect(workArea, windowRect, gaps = NO_GAPS) {
    const inner = insetAll(workArea, gaps.outer);
    return {
        x: inner.x + Math.round((inner.width - windowRect.width) / 2),
        y: inner.y + Math.round((inner.height - windowRect.height) / 2),
        width: windowRect.width,
        height: windowRect.height,
    };
}

// Spec 3.4: express `rect` as fractions of `from`, reapply on `to`.
export function mapRectToWorkArea(rect, from, to) {
    return {
        x: to.x + Math.round(((rect.x - from.x) / from.width) * to.width),
        y: to.y + Math.round(((rect.y - from.y) / from.height) * to.height),
        width: Math.round((rect.width / from.width) * to.width),
        height: Math.round((rect.height / from.height) * to.height),
    };
}

// Spec 3.7: if the app clamped our resize (min size), center the actual
// size inside the target rect instead of leaving it misaligned.
export function recenterWithin(target, actualWidth, actualHeight) {
    return {
        x: target.x + Math.round((target.width - actualWidth) / 2),
        y: target.y + Math.round((target.height - actualHeight) / 2),
        width: actualWidth,
        height: actualHeight,
    };
}

export function rectsEqual(a, b, tolerance = 0) {
    return Math.abs(a.x - b.x) <= tolerance &&
        Math.abs(a.y - b.y) <= tolerance &&
        Math.abs(a.width - b.width) <= tolerance &&
        Math.abs(a.height - b.height) <= tolerance;
}

function insetAll(rect, amount) {
    return {
        x: rect.x + amount,
        y: rect.y + amount,
        width: rect.width - 2 * amount,
        height: rect.height - 2 * amount,
    };
}

// 1-D slice of [origin, origin+size] between fractions. Edges shared with a
// neighbouring slice (fraction not 0/1) are inset by half the inner gap —
// ceil on the leading edge, floor on the trailing edge, so two adjacent
// slices end up exactly `innerGap` px apart and boundaries computed from the
// same fraction always agree (no 1 px overlap on odd sizes).
function span(origin, size, startFrac, endFrac, innerGap) {
    const start = origin + Math.round(size * startFrac) +
        (startFrac > 0 ? Math.ceil(innerGap / 2) : 0);
    const end = origin + Math.round(size * endFrac) -
        (endFrac < 1 ? Math.floor(innerGap / 2) : 0);
    return { pos: start, size: end - start };
}

function almostMaximize(workArea, gaps) {
    const inner = insetAll(workArea, gaps.outer);
    const width = Math.round(inner.width * 0.9);
    const height = Math.round(inner.height * 0.9);
    return {
        x: inner.x + Math.round((inner.width - width) / 2),
        y: inner.y + Math.round((inner.height - height) / 2),
        width,
        height,
    };
}
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `npm test`
Expected: PASS — 19 tests, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore 'untangler@nebojsa.ilic/geometry.js' tests/geometry.test.js docs/
git commit -m "feat: geometry engine with cycling spans and gap math

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(This first commit also brings in `docs/untangler-spec.md` and this plan.)

---

### Task 2: CycleTracker

**Files:**
- Create: `untangler@nebojsa.ilic/cycle.js`
- Test: `tests/cycle.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `class CycleTracker` with:
  - `advance(windowId, action, length) → int` — returns the cycle index for this press and records state. First press of an action (or after a different action) returns 0; repeated same-action presses return 1, 2, … wrapping modulo `length` (spec 3.2: wraps, no timeout).
  - `peek(windowId) → {action, index} | null`
  - `reset(windowId) → void`
  - `clear() → void`

- [ ] **Step 1: Write the failing tests**

Create `tests/cycle.test.js` exactly:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CycleTracker } from '../untangler@nebojsa.ilic/cycle.js';

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
```

- [ ] **Step 2: Run tests, verify the new file fails**

Run: `npm test`
Expected: geometry tests PASS; cycle tests FAIL with `Cannot find module` for `cycle.js`.

- [ ] **Step 3: Implement `untangler@nebojsa.ilic/cycle.js`**

```js
// cycle.js — CycleTracker (spec 3.2): per-window repeated-press state.
// Pure JS, no Shell imports — unit-tested under Node.
//
// Rectangle semantics: no timeout; the cycle advances only when the same
// action repeats on the same window, wraps around, and resets when any
// other action fires. Manual-move invalidation is the dispatcher's job
// (it calls reset()).

export class CycleTracker {
    constructor() {
        this._states = new Map();
    }

    advance(windowId, action, length) {
        const previous = this._states.get(windowId);
        let index = 0;
        if (previous && previous.action === action)
            index = (previous.index + 1) % length;
        this._states.set(windowId, { action, index });
        return index;
    }

    peek(windowId) {
        return this._states.get(windowId) ?? null;
    }

    reset(windowId) {
        this._states.delete(windowId);
    }

    clear() {
        this._states.clear();
    }
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test`
Expected: PASS — 24 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add 'untangler@nebojsa.ilic/cycle.js' tests/cycle.test.js
git commit -m "feat: per-window cycle tracker with Rectangle semantics

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: ZoneResolver (drag snap zone map)

**Files:**
- Modify: `untangler@nebojsa.ilic/geometry.js` (append two exported functions; do not change existing code)
- Test: `tests/zones.test.js`

**Interfaces:**
- Consumes: `Action`, `rectForAction`, `NO_GAPS` from Task 1.
- Produces (appended to `./geometry.js`):
  - `resolveZone(pointerX, pointerY, workArea, options = {}) → {action, cycleIndex} | null` — options `{bandPx = 16, cornerPx = 24, variant = false}`. Implements the spec 3.6 zone table. `variant` = the two-thirds/thirds modifier is held. Pointer coordinates are clamped into the work area first (so a pointer over the top panel still hits the top band).
  - `zoneRect(zone, workArea, gaps = NO_GAPS) → rect` — the rect a zone previews/applies; for `Action.MAXIMIZE` it is the full work area, otherwise `rectForAction`.

Zone rules (spec 3.6 table), in precedence order:
1. **Corners** — `cornerPx` squares at the four work-area corners → the matching quarter (`cycleIndex = variant ? 1 : 0`).
2. **Top edge** (within `bandPx`), pointer x within the center 50 % of the work area → `MAXIMIZE` (cycleIndex 0). Top edge outside that center band → no zone.
3. **Left/right edge** (within `bandPx`): pointer y in top 25 % of work-area height → top quarter on that side; bottom 25 % → bottom quarter; middle 50 % → half. `cycleIndex = variant ? 1 : 0` (half→two-thirds, quarter→sixth via the existing cycle tables).
4. **Bottom edge** (within `bandPx`): left/center/right third of work-area width → `FIRST_THIRD`/`CENTER_THIRD`/`LAST_THIRD` (cycleIndex 0 always).
5. Anywhere else → `null`.

- [ ] **Step 1: Write the failing tests**

Create `tests/zones.test.js` exactly:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Action, resolveZone, zoneRect } from '../untangler@nebojsa.ilic/geometry.js';

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
```

- [ ] **Step 2: Run tests, verify the new file fails**

Run: `npm test`
Expected: zones tests FAIL (`resolveZone` is not exported); all previous tests PASS.

- [ ] **Step 3: Append to `untangler@nebojsa.ilic/geometry.js`**

Append at the end of the file:

```js
// --- Drag snap zones (spec 3.6) ---
// Pure: pointer position + work area → { action, cycleIndex } | null.
// `variant` = the two-thirds/thirds modifier is held; it bumps halves and
// quarters to cycle step 1 (two-thirds / sixth). Precedence: corners, then
// top edge, then left/right edges, then bottom edge.
export function resolveZone(pointerX, pointerY, workArea, options = {}) {
    const { bandPx = 16, cornerPx = 24, variant = false } = options;
    const wa = workArea;
    // Clamp so pointers over panels/struts (outside the work area) still
    // hit the nearest edge band.
    const px = clamp(pointerX, wa.x, wa.x + wa.width - 1);
    const py = clamp(pointerY, wa.y, wa.y + wa.height - 1);
    const variantIndex = variant ? 1 : 0;

    const inLeftCorner = px < wa.x + cornerPx;
    const inRightCorner = px >= wa.x + wa.width - cornerPx;
    const inTopCorner = py < wa.y + cornerPx;
    const inBottomCorner = py >= wa.y + wa.height - cornerPx;
    if (inTopCorner && inLeftCorner)
        return { action: Action.TOP_LEFT_QUARTER, cycleIndex: variantIndex };
    if (inTopCorner && inRightCorner)
        return { action: Action.TOP_RIGHT_QUARTER, cycleIndex: variantIndex };
    if (inBottomCorner && inLeftCorner)
        return { action: Action.BOTTOM_LEFT_QUARTER, cycleIndex: variantIndex };
    if (inBottomCorner && inRightCorner)
        return { action: Action.BOTTOM_RIGHT_QUARTER, cycleIndex: variantIndex };

    const nearLeft = px < wa.x + bandPx;
    const nearRight = px >= wa.x + wa.width - bandPx;
    const nearTop = py < wa.y + bandPx;
    const nearBottom = py >= wa.y + wa.height - bandPx;

    if (nearTop) {
        // Top edge, centre 50 % → maximize (native-compatible).
        if (px >= wa.x + wa.width * 0.25 && px < wa.x + wa.width * 0.75)
            return { action: Action.MAXIMIZE, cycleIndex: 0 };
        return null;
    }

    if (nearLeft || nearRight) {
        const heightFrac = (py - wa.y) / wa.height;
        if (heightFrac < 0.25) {
            return {
                action: nearLeft ? Action.TOP_LEFT_QUARTER : Action.TOP_RIGHT_QUARTER,
                cycleIndex: variantIndex,
            };
        }
        if (heightFrac >= 0.75) {
            return {
                action: nearLeft ? Action.BOTTOM_LEFT_QUARTER : Action.BOTTOM_RIGHT_QUARTER,
                cycleIndex: variantIndex,
            };
        }
        return {
            action: nearLeft ? Action.LEFT_HALF : Action.RIGHT_HALF,
            cycleIndex: variantIndex,
        };
    }

    if (nearBottom) {
        const widthFrac = (px - wa.x) / wa.width;
        if (widthFrac < 1 / 3)
            return { action: Action.FIRST_THIRD, cycleIndex: 0 };
        if (widthFrac < 2 / 3)
            return { action: Action.CENTER_THIRD, cycleIndex: 0 };
        return { action: Action.LAST_THIRD, cycleIndex: 0 };
    }

    return null;
}

// The rect a zone previews and applies. Maximize is performed via Meta's
// own maximize (spec 3.1), so its preview is simply the whole work area.
export function zoneRect(zone, workArea, gaps = NO_GAPS) {
    if (zone.action === Action.MAXIMIZE) {
        return {
            x: workArea.x, y: workArea.y,
            width: workArea.width, height: workArea.height,
        };
    }
    return rectForAction(workArea, zone.action, zone.cycleIndex, gaps);
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test`
Expected: PASS — 36 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add 'untangler@nebojsa.ilic/geometry.js' tests/zones.test.js
git commit -m "feat: pure zone resolver for extended drag snap zones

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Extension skeleton — schema, mover, dispatcher, keybindings

This task produces an installable extension where all 17 keyboard actions work. It is the Mutter-facing layer; it cannot be unit-tested headlessly, so verification is: schema compiles, `node --check` passes on every file, existing unit tests stay green, and the dev-install script succeeds.

**Files:**
- Create: `untangler@nebojsa.ilic/metadata.json`
- Create: `untangler@nebojsa.ilic/schemas/org.gnome.shell.extensions.untangler.gschema.xml`
- Create: `untangler@nebojsa.ilic/mover.js`
- Create: `untangler@nebojsa.ilic/actions.js`
- Create: `untangler@nebojsa.ilic/keybindings.js`
- Create: `untangler@nebojsa.ilic/extension.js`
- Create: `scripts/install.sh`

**Interfaces:**
- Consumes: everything Task 1–3 exports.
- Produces:
  - `WindowMover` (mover.js): `focusedWindow()`, `windowId(win)`, `canResize(win)`, `canMove(win)`, `frameRect(win)`, `workArea(win)`, `monitorCount()`, `currentMonitor(win)`, `workAreaForMonitor(win, index)`, `maximize(win)`, `unmaximize(win)`, `isMaximized(win)`, `apply(win, rect, {resize = true, onSettled = null})`, `destroy()`.
  - `ActionDispatcher` (actions.js): `run(action)`, `applyZone(win, zone, workArea)` (used by Task 5), `destroy()`.
  - `KeybindingManager` (keybindings.js): `enable()`, `disable()`; exports `KEYBINDINGS` map (GSettings key → Action) reused by prefs (Task 6).
  - `extension.js`: default-exported `UntanglerExtension extends Extension`.

- [ ] **Step 1: Create `untangler@nebojsa.ilic/metadata.json`**

```json
{
  "uuid": "untangler@nebojsa.ilic",
  "name": "Untangler",
  "description": "Rectangle-style keyboard window snapping: 17 shortcut actions with repeated-press size cycling, restore, gaps, multi-monitor throws, and extended drag snap zones with live preview.",
  "shell-version": ["46", "47", "48"],
  "settings-schema": "org.gnome.shell.extensions.untangler",
  "gettext-domain": "untangler",
  "version-name": "1.0"
}
```

- [ ] **Step 2: Create the GSettings schema**

`untangler@nebojsa.ilic/schemas/org.gnome.shell.extensions.untangler.gschema.xml` — defaults are the spec 3.1 table verbatim plus spec 4.5:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<schemalist gettext-domain="untangler">
  <schema id="org.gnome.shell.extensions.untangler" path="/org/gnome/shell/extensions/untangler/">

    <!-- Keyboard actions (spec 3.1). Type 'as' as required by Main.wm.addKeybinding. -->
    <key name="snap-left-half" type="as"><default><![CDATA[['<Super><Alt>Left']]]></default><summary>Left half (cycles 1/2, 2/3, 1/3)</summary></key>
    <key name="snap-right-half" type="as"><default><![CDATA[['<Super><Alt>Right']]]></default><summary>Right half (cycles 1/2, 2/3, 1/3)</summary></key>
    <key name="snap-top-half" type="as"><default><![CDATA[['<Super><Alt>Up']]]></default><summary>Top half (cycles 1/2, 2/3, 1/3)</summary></key>
    <key name="snap-bottom-half" type="as"><default><![CDATA[['<Super><Alt>Down']]]></default><summary>Bottom half (cycles 1/2, 2/3, 1/3)</summary></key>
    <key name="snap-top-left-quarter" type="as"><default><![CDATA[['<Super><Alt>u']]]></default><summary>Top-left quarter (cycles 1/4, 1/6)</summary></key>
    <key name="snap-top-right-quarter" type="as"><default><![CDATA[['<Super><Alt>i']]]></default><summary>Top-right quarter (cycles 1/4, 1/6)</summary></key>
    <key name="snap-bottom-left-quarter" type="as"><default><![CDATA[['<Super><Alt>j']]]></default><summary>Bottom-left quarter (cycles 1/4, 1/6)</summary></key>
    <key name="snap-bottom-right-quarter" type="as"><default><![CDATA[['<Super><Alt>k']]]></default><summary>Bottom-right quarter (cycles 1/4, 1/6)</summary></key>
    <key name="snap-first-third" type="as"><default><![CDATA[['<Super><Alt>d']]]></default><summary>First (left) third</summary></key>
    <key name="snap-center-third" type="as"><default><![CDATA[['<Super><Alt>f']]]></default><summary>Center third</summary></key>
    <key name="snap-last-third" type="as"><default><![CDATA[['<Super><Alt>g']]]></default><summary>Last (right) third</summary></key>
    <key name="snap-maximize" type="as"><default><![CDATA[['<Super><Alt>Return']]]></default><summary>Maximize</summary></key>
    <key name="snap-almost-maximize" type="as"><default><![CDATA[['<Super><Alt>m']]]></default><summary>Almost maximize (90% centered)</summary></key>
    <key name="snap-center" type="as"><default><![CDATA[['<Super><Alt>c']]]></default><summary>Center window without resizing</summary></key>
    <key name="snap-restore" type="as"><default><![CDATA[['<Super><Alt>BackSpace']]]></default><summary>Restore pre-snap size and position</summary></key>
    <key name="snap-next-display" type="as"><default><![CDATA[['<Super><Alt>Page_Down']]]></default><summary>Move to next display</summary></key>
    <key name="snap-prev-display" type="as"><default><![CDATA[['<Super><Alt>Page_Up']]]></default><summary>Move to previous display</summary></key>

    <!-- Behavior (spec 3.5, 4.5) -->
    <key name="outer-gap" type="i"><default>0</default><range min="0" max="128"/><summary>Gap between windows and work-area edge (px)</summary></key>
    <key name="inner-gap" type="i"><default>0</default><range min="0" max="128"/><summary>Gap between adjacent snapped windows (px)</summary></key>
    <key name="cycle-sizes-enabled" type="b"><default>true</default><summary>Repeated presses cycle through size variants</summary></key>

    <!-- Drag snapping (spec 3.6, 4.5) -->
    <key name="drag-snap-mode" type="s">
      <choices><choice value="off"/><choice value="replace"/><choice value="modifier"/></choices>
      <default>'replace'</default>
      <summary>Drag snapping mode</summary>
    </key>
    <key name="drag-snap-modifier" type="s">
      <choices><choice value="ctrl"/><choice value="alt"/><choice value="shift"/><choice value="super"/></choices>
      <default>'ctrl'</default>
      <summary>Modifier for size variants (activation key in modifier-only mode)</summary>
    </key>
    <key name="edge-band-px" type="i"><default>16</default><range min="4" max="64"/><summary>Edge zone trigger depth (px)</summary></key>
    <key name="show-preview" type="b"><default>true</default><summary>Show translucent preview of the target zone while dragging</summary></key>
    <key name="saved-edge-tiling" type="b"><default>true</default><summary>User's org.gnome.mutter edge-tiling value before we suppressed it</summary></key>
    <key name="edge-tiling-suppressed" type="b"><default>false</default><summary>Whether we are currently suppressing native edge tiling (crash-recovery marker)</summary></key>
  </schema>
</schemalist>
```

- [ ] **Step 3: Verify the schema compiles**

Run: `glib-compile-schemas --strict --dry-run 'untangler@nebojsa.ilic/schemas/'`
Expected: exit 0, no output.

- [ ] **Step 4: Create `untangler@nebojsa.ilic/mover.js`**

```js
// mover.js — WindowMover: the only file that calls Meta.Window methods.
// Everything the dispatcher needs from Mutter goes through here (spec 4.7:
// thin, replaceable Mutter surface).
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import { recenterWithin } from './geometry.js';

// GNOME 48 removed Meta.MaximizeFlags and the flags argument to
// maximize()/unmaximize(). Feature-detect once; this is the only
// version-dependent spot in the codebase.
let MAXIMIZE_BOTH = null;
try {
    MAXIMIZE_BOTH = Meta.MaximizeFlags.BOTH;
} catch {
    MAXIMIZE_BOTH = null;
}

export class WindowMover {
    constructor() {
        this._pendingSources = new Set();
    }

    destroy() {
        for (const id of this._pendingSources)
            GLib.source_remove(id);
        this._pendingSources.clear();
    }

    focusedWindow() {
        const window = global.display.get_focus_window();
        if (!window)
            return null;
        // Spec 3.7: ignore docks, desktop, splash, DND, etc.
        if (window.get_window_type() !== Meta.WindowType.NORMAL)
            return null;
        return window;
    }

    windowId(window) {
        return window.get_id();
    }

    canResize(window) {
        return window.allows_resize();
    }

    canMove(window) {
        return window.allows_move();
    }

    frameRect(window) {
        const r = window.get_frame_rect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    }

    workArea(window) {
        const r = window.get_work_area_current_monitor();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    }

    monitorCount() {
        return global.display.get_n_monitors();
    }

    currentMonitor(window) {
        return window.get_monitor();
    }

    workAreaForMonitor(window, monitorIndex) {
        const r = window.get_work_area_for_monitor(monitorIndex);
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    }

    isMaximized(window) {
        return Boolean(window.maximized_horizontally || window.maximized_vertically);
    }

    maximize(window) {
        if (MAXIMIZE_BOTH !== null)
            window.maximize(MAXIMIZE_BOTH);
        else
            window.maximize();
    }

    unmaximize(window) {
        if (MAXIMIZE_BOTH !== null)
            window.unmaximize(MAXIMIZE_BOTH);
        else
            window.unmaximize();
    }

    // Apply a target rect (spec 3.7/4.3): unmaximize/untile first and defer
    // one main-loop iteration when we did (unmaximize is async — an
    // immediate resize races it). Then placement + deferred read-back: if
    // the frame's final size differs from the target (app min-size clamp,
    // or a move-only placement computed while the window was maximized),
    // re-center the actual size inside the target rect. `onSettled`
    // reports the final intended rect so the dispatcher's expectation
    // tracking (manual-change detection) stays accurate.
    apply(window, rect, { resize = true, onSettled = null } = {}) {
        if (this.isMaximized(window)) {
            this.unmaximize(window);
            this._defer(() => this._place(window, rect, resize, onSettled));
        } else {
            this._place(window, rect, resize, onSettled);
        }
    }

    _place(window, rect, resize, onSettled) {
        if (resize && window.allows_resize())
            window.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
        else
            window.move_frame(true, rect.x, rect.y);
        // Read-back must be deferred: on Wayland the frame rect only
        // updates once the client acks the configure.
        this._defer(() => {
            const frame = window.get_frame_rect();
            let finalRect = rect;
            if (frame.width !== rect.width || frame.height !== rect.height) {
                finalRect = recenterWithin(rect, frame.width, frame.height);
                window.move_frame(true, finalRect.x, finalRect.y);
            }
            onSettled?.(finalRect);
        }, 50);
    }

    _defer(callback, ms = 0) {
        let id;
        const run = () => {
            this._pendingSources.delete(id);
            callback();
            return GLib.SOURCE_REMOVE;
        };
        id = ms === 0
            ? GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, run)
            : GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, run);
        this._pendingSources.add(id);
    }
}
```

- [ ] **Step 5: Create `untangler@nebojsa.ilic/actions.js`**

```js
// actions.js — ActionDispatcher: orchestrates geometry + cycle + mover.
// No gi:// imports here; all Mutter access goes through the WindowMover
// passed into the constructor (spec §2 purity boundary).
import {
    Action, rectForAction, cycleLength, centerRect, mapRectToWorkArea,
    rectsEqual, zoneRect,
} from './geometry.js';
import { CycleTracker } from './cycle.js';

// Frame-rect drift beyond this (px) counts as a manual move/resize.
const MANUAL_CHANGE_TOLERANCE = 2;

export class ActionDispatcher {
    constructor(settings, mover) {
        this._settings = settings;
        this._mover = mover;
        this._cycles = new CycleTracker();
        // Per-window snap records: `original` = pre-snap geometry for
        // Restore (spec 3.3), `lastApplied` = what we last set, used for
        // lazy manual-change detection (spec 3.2/3.3 — checked on the next
        // action instead of per-window signals; same observable behavior,
        // nothing to disconnect). WeakMap so closed windows drop out.
        this._records = new WeakMap();
    }

    destroy() {
        this._cycles.clear();
    }

    run(action) {
        const win = this._mover.focusedWindow();
        if (!win)
            return;
        const id = this._mover.windowId(win);
        const frame = this._mover.frameRect(win);

        // Lazy manual-change detection: a manual move/resize since our
        // last snap resets the cycle and invalidates restore geometry.
        let record = this._records.get(win);
        if (record?.lastApplied && !record.settling &&
            !rectsEqual(frame, record.lastApplied, MANUAL_CHANGE_TOLERANCE)) {
            this._records.delete(win);
            this._cycles.reset(id);
            record = undefined;
        }

        switch (action) {
        case Action.RESTORE:
            this._restore(win, id, record);
            break;
        case Action.NEXT_DISPLAY:
            this._moveToDisplay(win, id, frame, +1);
            break;
        case Action.PREV_DISPLAY:
            this._moveToDisplay(win, id, frame, -1);
            break;
        case Action.CENTER:
            this._center(win, id, frame);
            break;
        case Action.MAXIMIZE:
            this._maximize(win, id, frame);
            break;
        default:
            this._snap(win, id, frame, action);
        }
    }

    // Drag-snap drop path (spec 3.6): same restore-recording and gap
    // handling as keyboard actions; cycle index resets.
    applyZone(win, zone, workArea) {
        if (!win)
            return;
        const id = this._mover.windowId(win);
        this._cycles.reset(id);
        const frame = this._mover.frameRect(win);
        if (zone.action === Action.MAXIMIZE) {
            const record = this._ensureRecord(win, frame);
            record.lastApplied = null;
            this._mover.maximize(win);
            return;
        }
        if (!this._mover.canResize(win))
            return;
        const rect = zoneRect(zone, workArea, this._gaps());
        this._applyTracked(win, this._ensureRecord(win, frame), rect);
    }

    _gaps() {
        return {
            outer: this._settings.get_int('outer-gap'),
            inner: this._settings.get_int('inner-gap'),
        };
    }

    _ensureRecord(win, frame) {
        let record = this._records.get(win);
        if (!record) {
            record = { original: { ...frame }, lastApplied: null, settling: false };
            this._records.set(win, record);
        }
        return record;
    }

    // Route every tracked placement through the mover's settle callback:
    // the final rect can legitimately differ from the requested one
    // (min-size clamp → read-back re-centering), and treating that as a
    // manual move would wrongly reset the cycle and drop restore geometry.
    _applyTracked(win, record, rect, resize = true) {
        record.settling = true;
        record.lastApplied = rect;
        this._mover.apply(win, rect, {
            resize,
            onSettled: finalRect => {
                record.lastApplied = finalRect;
                record.settling = false;
            },
        });
    }

    _snap(win, id, frame, action) {
        // Spec 3.7: resize actions skip fixed-size windows.
        if (!this._mover.canResize(win))
            return;
        const length = this._settings.get_boolean('cycle-sizes-enabled')
            ? cycleLength(action) : 1;
        const index = this._cycles.advance(id, action, length);
        const workArea = this._mover.workArea(win);
        const rect = rectForAction(workArea, action, index, this._gaps());
        this._applyTracked(win, this._ensureRecord(win, frame), rect);
    }

    _maximize(win, id, frame) {
        this._cycles.advance(id, Action.MAXIMIZE, 1);
        const record = this._ensureRecord(win, frame);
        // Maximized geometry is Mutter's, not ours — skip the manual-change
        // comparison on the next action.
        record.lastApplied = null;
        this._mover.maximize(win);
    }

    _center(win, id, frame) {
        // Center never resizes, so it's allowed for fixed-size windows
        // (spec 3.7).
        this._cycles.advance(id, Action.CENTER, 1);
        const workArea = this._mover.workArea(win);
        const rect = centerRect(workArea, frame, this._gaps());
        this._applyTracked(win, this._ensureRecord(win, frame), rect, false);
    }

    _restore(win, id, record) {
        this._cycles.reset(id);
        if (!record?.original)
            return;
        const original = record.original;
        this._records.delete(win);
        this._mover.apply(win, original);
    }

    _moveToDisplay(win, id, frame, direction) {
        const count = this._mover.monitorCount();
        if (count < 2 || !this._mover.canMove(win))
            return;
        this._cycles.reset(id);
        const current = this._mover.currentMonitor(win);
        const target = ((current + direction) % count + count) % count;
        const fromArea = this._mover.workArea(win);
        const toArea = this._mover.workAreaForMonitor(win, target);
        const rect = mapRectToWorkArea(frame, fromArea, toArea);
        const record = this._records.get(win);
        if (record)
            this._applyTracked(win, record, rect); // keeps `original`
        else
            this._mover.apply(win, rect);
    }
}
```

- [ ] **Step 6: Create `untangler@nebojsa.ilic/keybindings.js`**

```js
// keybindings.js — registers/unregisters all shortcuts (spec 4.2).
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Action } from './geometry.js';

// GSettings key ('as') → Action. Key names must match the gschema exactly;
// prefs.js reuses this map for the shortcut rows.
export const KEYBINDINGS = Object.freeze({
    'snap-left-half': Action.LEFT_HALF,
    'snap-right-half': Action.RIGHT_HALF,
    'snap-top-half': Action.TOP_HALF,
    'snap-bottom-half': Action.BOTTOM_HALF,
    'snap-top-left-quarter': Action.TOP_LEFT_QUARTER,
    'snap-top-right-quarter': Action.TOP_RIGHT_QUARTER,
    'snap-bottom-left-quarter': Action.BOTTOM_LEFT_QUARTER,
    'snap-bottom-right-quarter': Action.BOTTOM_RIGHT_QUARTER,
    'snap-first-third': Action.FIRST_THIRD,
    'snap-center-third': Action.CENTER_THIRD,
    'snap-last-third': Action.LAST_THIRD,
    'snap-maximize': Action.MAXIMIZE,
    'snap-almost-maximize': Action.ALMOST_MAXIMIZE,
    'snap-center': Action.CENTER,
    'snap-restore': Action.RESTORE,
    'snap-next-display': Action.NEXT_DISPLAY,
    'snap-prev-display': Action.PREV_DISPLAY,
});

export class KeybindingManager {
    constructor(settings, dispatcher) {
        this._settings = settings;
        this._dispatcher = dispatcher;
        this._registered = [];
    }

    enable() {
        for (const [name, action] of Object.entries(KEYBINDINGS)) {
            Main.wm.addKeybinding(
                name,
                this._settings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL,
                () => this._dispatcher.run(action));
            this._registered.push(name);
        }
    }

    disable() {
        // EGO requirement (spec 4.2): remove every registered binding.
        for (const name of this._registered)
            Main.wm.removeKeybinding(name);
        this._registered = [];
    }
}
```

- [ ] **Step 7: Create `untangler@nebojsa.ilic/extension.js`**

```js
// extension.js — lifecycle only: construct on enable, tear down fully on
// disable (EGO requirement). All logic lives in the managers.
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { ActionDispatcher } from './actions.js';
import { KeybindingManager } from './keybindings.js';
import { WindowMover } from './mover.js';

export default class UntanglerExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._mover = new WindowMover();
        this._dispatcher = new ActionDispatcher(this._settings, this._mover);
        this._keybindings = new KeybindingManager(this._settings, this._dispatcher);
        this._keybindings.enable();
    }

    disable() {
        this._keybindings?.disable();
        this._keybindings = null;
        this._dispatcher?.destroy();
        this._dispatcher = null;
        this._mover?.destroy();
        this._mover = null;
        this._settings = null;
    }
}
```

- [ ] **Step 8: Create `scripts/install.sh`** (mode 755)

```bash
#!/usr/bin/env bash
# Dev-install: compile schemas and symlink the extension into the user's
# extensions dir. Log out/in (Wayland) afterwards, then:
#   gnome-extensions enable untangler@nebojsa.ilic
set -euo pipefail

UUID="untangler@nebojsa.ilic"
SRC="$(cd "$(dirname "$0")/.." && pwd)/$UUID"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

glib-compile-schemas "$SRC/schemas"
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
ln -s "$SRC" "$DEST"
echo "Installed symlink: $DEST -> $SRC"
```

- [ ] **Step 9: Verify everything**

Run: `npm run check && npm test && glib-compile-schemas --strict --dry-run 'untangler@nebojsa.ilic/schemas/' && bash -n scripts/install.sh && python3 -m json.tool 'untangler@nebojsa.ilic/metadata.json' > /dev/null && echo ALL-OK`
Expected: unit tests still 36 PASS, final line `ALL-OK`.

- [ ] **Step 10: Commit**

```bash
chmod +x scripts/install.sh
git add 'untangler@nebojsa.ilic' scripts/install.sh
git commit -m "feat: installable extension with all 17 keyboard actions

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Drag snap zones — tracking, preview, edge-tiling suppression

**Files:**
- Create: `untangler@nebojsa.ilic/dragsnap.js`
- Create: `untangler@nebojsa.ilic/preview.js`
- Create: `untangler@nebojsa.ilic/stylesheet.css`
- Modify: `untangler@nebojsa.ilic/extension.js`

**Interfaces:**
- Consumes: `resolveZone`, `zoneRect`, `rectsEqual` (geometry.js); `ActionDispatcher.applyZone(win, zone, workArea)`; `WindowMover.frameRect(win)`.
- Produces: `DragSnapManager` with `enable()` / `destroy()`; `ZonePreview` with `showAt(rect)`, `keepBelow(windowActor)`, `hide()`, `destroy()`.

- [ ] **Step 1: Create `untangler@nebojsa.ilic/preview.js`**

```js
// preview.js — translucent zone preview overlay (spec 3.6/4.4).
import Clutter from 'gi://Clutter';
import St from 'gi://St';

const ANIMATION_MS = 120;

export class ZonePreview {
    constructor() {
        this._widget = new St.Widget({
            style_class: 'untangler-zone-preview',
            visible: false,
        });
        // In window_group so it sits under the dragged window's actor
        // (which keepBelow() then raises above us).
        global.window_group.add_child(this._widget);
    }

    showAt(rect) {
        if (!this._widget)
            return;
        if (!this._widget.visible) {
            // First appearance: jump into place and fade in.
            this._widget.set_position(rect.x, rect.y);
            this._widget.set_size(rect.width, rect.height);
            this._widget.opacity = 0;
            this._widget.show();
            this._widget.ease({
                opacity: 255,
                duration: ANIMATION_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            return;
        }
        // Zone change: glide to the new rect (the Rectangle "fluid" feel).
        this._widget.ease({
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            duration: ANIMATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    keepBelow(windowActor) {
        if (this._widget && windowActor &&
            windowActor.get_parent() === this._widget.get_parent())
            global.window_group.set_child_above_sibling(windowActor, this._widget);
    }

    hide() {
        if (this._widget) {
            this._widget.remove_all_transitions();
            this._widget.hide();
        }
    }

    destroy() {
        // EGO requirement: actor must not outlive disable().
        this._widget?.destroy();
        this._widget = null;
    }
}
```

- [ ] **Step 2: Create `untangler@nebojsa.ilic/stylesheet.css`**

```css
/* Drag snap zone preview (spec 3.6). Translucent so it reads on both light
   and dark shell themes. */
.untangler-zone-preview {
  background-color: rgba(53, 132, 228, 0.25);
  border: 2px solid rgba(53, 132, 228, 0.7);
  border-radius: 12px;
}
```

- [ ] **Step 3: Create `untangler@nebojsa.ilic/dragsnap.js`**

```js
// dragsnap.js — DragSnapManager (spec 3.6/4.4): grab-op tracking, 60 Hz
// pointer polling during a move grab, zone preview, drop handling, and
// native edge-tiling suppression with crash-safe restore.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { resolveZone, zoneRect, rectsEqual } from './geometry.js';
import { ZonePreview } from './preview.js';

const POLL_INTERVAL_MS = 16; // ~60 Hz; the source exists only during a drag

const MODIFIER_MASKS = {
    ctrl: Clutter.ModifierType.CONTROL_MASK,
    alt: Clutter.ModifierType.MOD1_MASK,
    shift: Clutter.ModifierType.SHIFT_MASK,
    super: Clutter.ModifierType.MOD4_MASK,
};

export class DragSnapManager {
    constructor(settings, dispatcher, mover) {
        this._settings = settings;
        this._dispatcher = dispatcher;
        this._mover = mover;
        this._preview = null;
        this._mutterSettings = null;
        this._grabBeginId = 0;
        this._grabEndId = 0;
        this._modeChangedId = 0;
        this._pollId = 0;
        this._window = null;
        this._startFrame = null;
        this._zone = null;
        this._zoneWorkArea = null;
        this._zoneKey = null;
    }

    enable() {
        this._preview = new ZonePreview();
        this._grabBeginId = global.display.connect('grab-op-begin',
            (_display, window, op) => this._onGrabBegin(window, op));
        this._grabEndId = global.display.connect('grab-op-end',
            (_display, window, op) => this._onGrabEnd(window, op));
        this._modeChangedId = this._settings.connect('changed::drag-snap-mode',
            () => this._syncEdgeTiling());
        this._syncEdgeTiling();
    }

    destroy() {
        this._stopTracking();
        if (this._grabBeginId) {
            global.display.disconnect(this._grabBeginId);
            this._grabBeginId = 0;
        }
        if (this._grabEndId) {
            global.display.disconnect(this._grabEndId);
            this._grabEndId = 0;
        }
        if (this._modeChangedId) {
            this._settings.disconnect(this._modeChangedId);
            this._modeChangedId = 0;
        }
        this._restoreEdgeTiling();
        this._preview?.destroy();
        this._preview = null;
        this._mutterSettings = null;
    }

    // --- Native edge-tiling suppression (spec 3.6/4.4) ---

    _mutter() {
        if (!this._mutterSettings)
            this._mutterSettings = new Gio.Settings({ schema_id: 'org.gnome.mutter' });
        return this._mutterSettings;
    }

    _syncEdgeTiling() {
        if (this._settings.get_string('drag-snap-mode') === 'replace')
            this._suppressEdgeTiling();
        else
            this._restoreEdgeTiling();
    }

    _suppressEdgeTiling() {
        const mutter = this._mutter();
        if (!this._settings.get_boolean('edge-tiling-suppressed')) {
            // First suppression: remember the user's value. If the shell
            // crashed while suppressed, the flag is still set and the saved
            // value is still the user's original — do NOT overwrite it with
            // our own `false` (spec §7 crash-recovery risk).
            this._settings.set_boolean('saved-edge-tiling',
                mutter.get_boolean('edge-tiling'));
            this._settings.set_boolean('edge-tiling-suppressed', true);
        }
        mutter.set_boolean('edge-tiling', false);
    }

    _restoreEdgeTiling() {
        if (!this._settings.get_boolean('edge-tiling-suppressed'))
            return;
        this._mutter().set_boolean('edge-tiling',
            this._settings.get_boolean('saved-edge-tiling'));
        this._settings.set_boolean('edge-tiling-suppressed', false);
    }

    // --- Grab lifecycle (spec 4.4) ---

    _onGrabBegin(window, op) {
        if (op !== Meta.GrabOp.MOVING)
            return; // ignore resizes and keyboard ops
        if (this._settings.get_string('drag-snap-mode') === 'off')
            return;
        if (!window || window.get_window_type() !== Meta.WindowType.NORMAL)
            return;
        this._stopTracking(); // defensive: never leak a stale poll source
        this._window = window;
        this._startFrame = this._mover.frameRect(window);
        // Poll the pointer: position-changed under-fires for zone purposes
        // (the pointer, not the frame, defines the zone) and pointer motion
        // events aren't deliverable to us during a compositor grab.
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_INTERVAL_MS,
            () => {
                this._poll();
                return GLib.SOURCE_CONTINUE;
            });
    }

    _onGrabEnd(window, op) {
        if (op !== Meta.GrabOp.MOVING || window !== this._window)
            return;
        const zone = this._zone;
        const workArea = this._zoneWorkArea;
        const startFrame = this._startFrame;
        this._stopTracking();
        if (!zone || !workArea)
            return;
        // Esc-cancel heuristic: grab-op-end doesn't report cancellation,
        // but Mutter restores the pre-grab frame on cancel. If the frame is
        // back at its starting geometry, treat it as cancelled.
        if (startFrame && rectsEqual(this._mover.frameRect(window), startFrame, 1))
            return;
        this._dispatcher.applyZone(window, zone, workArea);
    }

    _stopTracking() {
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
        this._window = null;
        this._startFrame = null;
        this._zone = null;
        this._zoneWorkArea = null;
        this._zoneKey = null;
        this._preview?.hide();
    }

    _poll() {
        if (!this._window)
            return;
        const [x, y, mods] = global.get_pointer();
        const mode = this._settings.get_string('drag-snap-mode');
        const modifierName = this._settings.get_string('drag-snap-modifier');
        const mask = MODIFIER_MASKS[modifierName] ?? MODIFIER_MASKS.ctrl;
        const modifierHeld = (mods & mask) !== 0;

        let zone = null;
        let workArea = null;
        // Modifier-only mode: zones exist only while the modifier is held
        // (zero-conflict with native tiling); the modifier is then the
        // activation key, so variant sizes are unavailable.
        if (mode !== 'modifier' || modifierHeld) {
            const monitor = Main.layoutManager.monitors.find(m =>
                x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height);
            if (monitor) {
                const area = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
                workArea = { x: area.x, y: area.y, width: area.width, height: area.height };
                zone = resolveZone(x, y, workArea, {
                    bandPx: this._settings.get_int('edge-band-px'),
                    variant: mode !== 'modifier' && modifierHeld,
                });
            }
        }

        const key = zone && workArea
            ? `${zone.action}:${zone.cycleIndex}:${workArea.x}:${workArea.y}`
            : null;
        if (key === this._zoneKey)
            return;
        this._zoneKey = key;
        this._zone = zone;
        this._zoneWorkArea = workArea;

        if (!zone) {
            this._preview?.hide();
            return;
        }
        if (!this._settings.get_boolean('show-preview'))
            return;
        const gaps = {
            outer: this._settings.get_int('outer-gap'),
            inner: this._settings.get_int('inner-gap'),
        };
        this._preview?.showAt(zoneRect(zone, workArea, gaps));
        const actor = this._window.get_compositor_private();
        if (actor)
            this._preview?.keepBelow(actor);
    }
}
```

- [ ] **Step 4: Wire into `extension.js`**

Apply exactly these two edits to `untangler@nebojsa.ilic/extension.js`:

Edit 1 — add the import after the `WindowMover` import line:

```js
import { WindowMover } from './mover.js';
import { DragSnapManager } from './dragsnap.js';
```

Edit 2 — replace the bodies of `enable()`/`disable()` so they read:

```js
    enable() {
        this._settings = this.getSettings();
        this._mover = new WindowMover();
        this._dispatcher = new ActionDispatcher(this._settings, this._mover);
        this._keybindings = new KeybindingManager(this._settings, this._dispatcher);
        this._keybindings.enable();
        this._dragSnap = new DragSnapManager(this._settings, this._dispatcher, this._mover);
        this._dragSnap.enable();
    }

    disable() {
        this._dragSnap?.destroy();
        this._dragSnap = null;
        this._keybindings?.disable();
        this._keybindings = null;
        this._dispatcher?.destroy();
        this._dispatcher = null;
        this._mover?.destroy();
        this._mover = null;
        this._settings = null;
    }
```

- [ ] **Step 5: Verify**

Run: `npm run check && npm test && echo ALL-OK`
Expected: 36 tests PASS, `ALL-OK`.

- [ ] **Step 6: Commit**

```bash
git add 'untangler@nebojsa.ilic'
git commit -m "feat: drag snap zones with live preview and edge-tiling suppression

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Preferences UI

**Files:**
- Create: `untangler@nebojsa.ilic/prefs.js`

**Interfaces:**
- Consumes: `KEYBINDINGS` from `keybindings.js`? **No** — keybindings.js imports Shell UI, which is forbidden in the prefs process (spec 4.6). The shortcut list is duplicated here as `SHORTCUT_ROWS` (key + human label); keep the keys in sync with `KEYBINDINGS`.
- Produces: default-exported `UntanglerPrefs extends ExtensionPreferences` with `fillPreferencesWindow(window)` adding three `Adw.PreferencesPage`s: Shortcuts, Behavior, Drag Snapping.

- [ ] **Step 1: Create `untangler@nebojsa.ilic/prefs.js`**

```js
// prefs.js — GTK4/Adwaita preferences (spec 4.6). Runs in a separate
// process: no Shell imports allowed; talks to the extension only via
// GSettings.
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Must stay in sync with KEYBINDINGS in keybindings.js (which we cannot
// import here — it pulls in Shell UI modules).
const SHORTCUT_ROWS = [
    ['snap-left-half', 'Left half'],
    ['snap-right-half', 'Right half'],
    ['snap-top-half', 'Top half'],
    ['snap-bottom-half', 'Bottom half'],
    ['snap-top-left-quarter', 'Top-left quarter'],
    ['snap-top-right-quarter', 'Top-right quarter'],
    ['snap-bottom-left-quarter', 'Bottom-left quarter'],
    ['snap-bottom-right-quarter', 'Bottom-right quarter'],
    ['snap-first-third', 'First third'],
    ['snap-center-third', 'Center third'],
    ['snap-last-third', 'Last third'],
    ['snap-maximize', 'Maximize'],
    ['snap-almost-maximize', 'Almost maximize'],
    ['snap-center', 'Center (no resize)'],
    ['snap-restore', 'Restore'],
    ['snap-next-display', 'Next display'],
    ['snap-prev-display', 'Previous display'],
];

export default class UntanglerPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.add(buildShortcutsPage(settings));
        window.add(buildBehaviorPage(settings));
        window.add(buildDragPage(settings));
    }
}

// --- Shortcuts page ---

function buildShortcutsPage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Shortcuts',
        icon_name: 'input-keyboard-symbolic',
    });
    const group = new Adw.PreferencesGroup({
        description: 'Click a row, then press the new shortcut. BackSpace clears, Esc cancels.',
    });
    for (const [key, label] of SHORTCUT_ROWS)
        group.add(buildShortcutRow(settings, key, label));
    page.add(group);
    return page;
}

function buildShortcutRow(settings, key, title) {
    const row = new Adw.ActionRow({ title, activatable: true });
    const shortcutLabel = new Gtk.ShortcutLabel({
        disabled_text: 'Disabled',
        valign: Gtk.Align.CENTER,
    });
    row.add_suffix(shortcutLabel);
    const sync = () => {
        const accel = settings.get_strv(key)[0] ?? '';
        shortcutLabel.accelerator = accel;
        // Spec §7: warn inline about collisions with GNOME's own shortcuts.
        row.subtitle = conflictWarning(accel);
    };
    settings.connect(`changed::${key}`, sync);
    sync();
    row.connect('activated', () => openCaptureDialog(row, settings, key));
    return row;
}

function openCaptureDialog(row, settings, key) {
    const dialog = new Adw.Window({
        modal: true,
        transient_for: row.get_root(),
        title: 'Set Shortcut',
        default_width: 380,
        default_height: 200,
        content: new Adw.StatusPage({
            title: 'Press a shortcut',
            description: 'Press BackSpace to clear, Esc to cancel',
            icon_name: 'input-keyboard-symbolic',
        }),
    });
    const controller = new Gtk.EventControllerKey();
    controller.connect('key-pressed', (_controller, keyval, _keycode, state) => {
        const mask = state & Gtk.accelerator_get_default_mod_mask();
        if (keyval === Gdk.KEY_Escape && mask === 0) {
            dialog.close();
            return Gdk.EVENT_STOP;
        }
        if (keyval === Gdk.KEY_BackSpace && mask === 0) {
            settings.set_strv(key, []);
            dialog.close();
            return Gdk.EVENT_STOP;
        }
        if (!Gtk.accelerator_valid(keyval, mask))
            return Gdk.EVENT_STOP; // bare modifier press etc. — keep waiting
        settings.set_strv(key, [Gtk.accelerator_name(keyval, mask)]);
        dialog.close();
        return Gdk.EVENT_STOP;
    });
    dialog.add_controller(controller);
    dialog.present();
}

// --- Conflict detection against GNOME's own keybinding schemas (spec §7) ---

let systemShortcutsCache = null;

function systemShortcuts() {
    if (systemShortcutsCache)
        return systemShortcutsCache;
    systemShortcutsCache = new Map();
    const source = Gio.SettingsSchemaSource.get_default();
    for (const schemaId of ['org.gnome.desktop.wm.keybindings', 'org.gnome.mutter.keybindings']) {
        const schema = source?.lookup(schemaId, true);
        if (!schema)
            continue;
        const gsettings = new Gio.Settings({ settings_schema: schema });
        for (const name of schema.list_keys()) {
            if (gsettings.get_value(name).get_type_string() !== 'as')
                continue;
            for (const accel of gsettings.get_strv(name))
                systemShortcutsCache.set(normalizeAccel(accel), name);
        }
    }
    return systemShortcutsCache;
}

function normalizeAccel(accel) {
    const [ok, keyval, mods] = Gtk.accelerator_parse(accel);
    return ok ? Gtk.accelerator_name(keyval, mods) : accel;
}

function conflictWarning(accel) {
    if (!accel)
        return '';
    const hit = systemShortcuts().get(normalizeAccel(accel));
    return hit ? `⚠ Conflicts with GNOME shortcut “${hit}”` : '';
}

// --- Behavior page ---

function buildBehaviorPage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Behavior',
        icon_name: 'preferences-system-symbolic',
    });
    const gaps = new Adw.PreferencesGroup({ title: 'Gaps' });
    gaps.add(spinRow(settings, 'outer-gap', 'Outer gap',
        'Pixels between snapped windows and the screen edge', 0, 128));
    gaps.add(spinRow(settings, 'inner-gap', 'Inner gap',
        'Pixels between adjacent snapped windows', 0, 128));
    const cycling = new Adw.PreferencesGroup({ title: 'Cycling' });
    cycling.add(switchRow(settings, 'cycle-sizes-enabled',
        'Cycle sizes on repeated press', 'Left Half → Two Thirds → Third'));
    page.add(gaps);
    page.add(cycling);
    return page;
}

// --- Drag snapping page ---

function buildDragPage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Drag Snapping',
        icon_name: 'input-mouse-symbolic',
    });
    const group = new Adw.PreferencesGroup();
    group.add(comboRow(settings, 'drag-snap-mode', 'Drag snapping',
        'Replace disables GNOME’s built-in edge tiling while the extension is enabled',
        ['off', 'replace', 'modifier'],
        ['Off', 'Replace GNOME’s edge tiling', 'Modifier-only']));
    group.add(comboRow(settings, 'drag-snap-modifier', 'Modifier key',
        'Hold while dragging for two-thirds/third variants; in Modifier-only mode this activates the zones',
        ['ctrl', 'alt', 'shift', 'super'],
        ['Ctrl', 'Alt', 'Shift', 'Super']));
    group.add(spinRow(settings, 'edge-band-px', 'Edge band size',
        'Zone trigger depth from the screen edges, in pixels', 4, 64));
    group.add(switchRow(settings, 'show-preview', 'Show zone preview',
        'Translucent overlay of the target zone while dragging'));
    page.add(group);
    return page;
}

// --- Row helpers ---

function spinRow(settings, key, title, subtitle, lower, upper) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({ lower, upper, step_increment: 1 }),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function switchRow(settings, key, title, subtitle) {
    const row = new Adw.SwitchRow({ title, subtitle });
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function comboRow(settings, key, title, subtitle, values, labels) {
    const row = new Adw.ComboRow({
        title,
        subtitle,
        model: Gtk.StringList.new(labels),
    });
    row.selected = Math.max(0, values.indexOf(settings.get_string(key)));
    row.connect('notify::selected', () => {
        settings.set_string(key, values[row.selected]);
    });
    return row;
}
```

- [ ] **Step 2: Verify**

Run: `npm run check && npm test && echo ALL-OK`
Expected: 36 tests PASS, `ALL-OK`.

- [ ] **Step 3: Commit**

```bash
git add 'untangler@nebojsa.ilic/prefs.js'
git commit -m "feat: Adwaita preferences with shortcut capture and conflict warnings

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Release readiness — README, manual test matrix, packaging, teardown audit

**Files:**
- Create: `README.md`
- Create: `docs/TESTING.md`
- Verify only: all extension sources (teardown audit), `gnome-extensions pack`

- [ ] **Step 1: Teardown audit (EGO checklist, spec M7)**

Run each grep over `untangler@nebojsa.ilic/` and manually verify every acquisition has a paired release. Record the audit result (file:line pairs) in the task report:

```bash
grep -n "\.connect(" 'untangler@nebojsa.ilic'/*.js       # each → a disconnect in destroy()/disable()
grep -n "timeout_add\|idle_add" 'untangler@nebojsa.ilic'/*.js  # each → source_remove
grep -n "add_child\|new St\." 'untangler@nebojsa.ilic'/*.js    # each actor → destroy()
grep -n "addKeybinding" 'untangler@nebojsa.ilic'/*.js          # each → removeKeybinding
```

Note: `settings.connect(...)` inside **prefs.js** is exempt — the prefs process dies with the window (GTK disposes it); only shell-process connections must be paired.
Expected pairs: dragsnap.js grab-op-begin/end + changed::drag-snap-mode → disconnects in destroy(); dragsnap.js timeout → `_stopTracking()` (called from destroy()); mover.js idle/timeout → `_pendingSources` sweep in destroy(); preview.js St.Widget → destroy(); keybindings.js 17 addKeybinding → removeKeybinding loop.
If any acquisition lacks a release, fix it before proceeding.

- [ ] **Step 2: Write `README.md`**

```markdown
# Untangler

Rectangle-style keyboard window snapping for GNOME Shell 46–48 (Wayland and X11).

## Features

- 17 snap actions with global shortcuts (halves, quarters, thirds, maximize,
  almost-maximize, center, restore, move between displays)
- Repeated-press cycling: Left Half → Left Two-Thirds → Left Third
- Restore returns a window to its pre-snap geometry
- Outer/inner gaps
- Multi-monitor: throw windows to the next/previous display keeping their
  relative size
- Extended drag snap zones: edges and corners snap to halves, quarters,
  thirds, two-thirds and sixths with a live translucent preview — a strict
  superset of GNOME's built-in edge tiling

## Default shortcuts

| Action | Shortcut |
|---|---|
| Left / Right / Top / Bottom half | `Super+Alt+Arrow` |
| Quarters | `Super+Alt+U / I / J / K` |
| Thirds | `Super+Alt+D / F / G` |
| Maximize / Almost maximize | `Super+Alt+Return` / `Super+Alt+M` |
| Center (no resize) | `Super+Alt+C` |
| Restore | `Super+Alt+BackSpace` |
| Next / previous display | `Super+Alt+PageDown` / `Super+Alt+PageUp` |

All rebindable in Preferences.

## Install (from source)

```bash
./scripts/install.sh
# log out and back in (Wayland), then:
gnome-extensions enable untangler@nebojsa.ilic
```

## Drag snapping modes

- **Replace GNOME's** (default): disables `org.gnome.mutter edge-tiling`
  while the extension is enabled and restores your original value on
  disable. Our zones are a superset, so nothing is lost.
- **Modifier-only**: native tiling untouched; zones activate only while the
  modifier (default Ctrl) is held.
- **Off**.

If the extension is ever disabled uncleanly and native edge tiling stays
off, restore it with: `gsettings reset org.gnome.mutter edge-tiling`

## Development

```bash
npm test        # pure-module unit tests (geometry, cycling, zones)
npm run check   # syntax-check all GJS sources with node
dbus-run-session -- gnome-shell --nested --wayland   # nested shell for manual testing
```
```

- [ ] **Step 3: Write `docs/TESTING.md`** — the spec §6 manual matrix as a checklist

```markdown
# Untangler manual test matrix (spec §6)

Run in a nested shell (`dbus-run-session -- gnome-shell --nested --wayland`)
or a real session. Host verified: GNOME Shell 46 / Ubuntu 24.04.

## Keyboard actions
- [ ] Every action in the table snaps the focused window correctly
- [ ] Repeated press cycles ½ → ⅔ → ⅓ (halves) and ¼ → ⅙ (quarters), wrapping
- [ ] Pressing a different action resets the cycle
- [ ] Manually moving/resizing a window resets its cycle and invalidates Restore
- [ ] Restore returns the window to pre-snap geometry
- [ ] Gaps: set outer=10, inner=8 — Left+Right half tile with an 8 px seam
- [ ] Min-size app (GNOME Calculator): snap to a small third — window re-centers within the zone
- [ ] CSD app (Text Editor), XWayland app (`GDK_BACKEND=x11 gedit`): frame-rect snapping correct
- [ ] Fixed-size window: resize actions do nothing; Center and Next Display still work
- [ ] Maximized window: any snap unmaximizes first, no race/flicker
- [ ] Two monitors: Next/Previous Display preserves relative size and wraps; work areas respected at different scales

## Drag snapping
- [ ] Replace mode: `gsettings get org.gnome.mutter edge-tiling` is false while enabled, restored on disable
- [ ] Left/right edge: top band → quarter, middle → half, bottom band → quarter — preview appears, glides between zones
- [ ] Bottom edge thirds; top-center → maximize; 24 px corners → quarters
- [ ] Ctrl (default) held: halves become two-thirds, quarters become sixths
- [ ] Modifier-only mode: zones appear only with modifier held; native tiling still works without it
- [ ] Esc during drag: preview hides, no snap
- [ ] Drop outside any zone: plain move, no snap
- [ ] Drag across monitor boundary: preview jumps to the other monitor's work area
- [ ] Restore after a drag-snap returns pre-drag size

## Lifecycle
- [ ] enable → use → disable → re-enable ×10, then check
      `journalctl /usr/bin/gnome-shell -b | grep -i untangler` — no leaked
      source/actor warnings
- [ ] After disable: all shortcuts inert, no preview widget, edge-tiling restored
```

- [ ] **Step 4: Package**

Run:

```bash
gnome-extensions pack 'untangler@nebojsa.ilic' \
  --extra-source=geometry.js --extra-source=cycle.js --extra-source=mover.js \
  --extra-source=actions.js --extra-source=keybindings.js \
  --extra-source=dragsnap.js --extra-source=preview.js \
  --force --out-dir=.
```

Expected: creates `untangler@nebojsa.ilic.shell-extension.zip` in the repo root (git-ignored). Then `unzip -l 'untangler@nebojsa.ilic.shell-extension.zip'` must list: extension.js, prefs.js, metadata.json, stylesheet.css, all 7 modules, schemas/gschemas.compiled.

- [ ] **Step 5: Final verification**

Run: `npm run check && npm test && glib-compile-schemas --strict --dry-run 'untangler@nebojsa.ilic/schemas/' && echo ALL-OK`
Expected: 36 tests PASS, `ALL-OK`.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/TESTING.md
git commit -m "docs: README, manual test matrix; verify packaging

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## What cannot be verified headlessly (be honest about this)

Unit tests fully cover geometry, cycling, and zone resolution. Everything touching Mutter/Shell (keybinding registration, window moving, grab tracking, preview rendering, prefs dialog) can only be syntax-checked here; behavioral verification requires a GNOME session — `docs/TESTING.md` is the checklist for that. Do not claim shell-side behavior "works", only that it is implemented per spec and passes static checks.

## Spec coverage map

| Spec section | Task |
|---|---|
| 3.1 actions + defaults | 1 (geometry), 4 (schema/wiring) |
| 3.2 cycling | 2 (tracker), 4 (dispatcher) |
| 3.3 restore | 4 |
| 3.4 multi-monitor | 1 (mapRect), 4 (dispatcher) |
| 3.5 gaps | 1 |
| 3.6 drag zones | 3 (resolver), 5 (manager/preview/suppression) |
| 3.7 special windows | 4 (mover/dispatcher) |
| 4.1–4.3 structure/keybindings/geometry apply | 4 |
| 4.4 drag implementation | 5 |
| 4.5 schema | 4 |
| 4.6 prefs | 6 |
| 4.7 version resilience | 4 (mover feature-detect), purity rule throughout |
| §5 M7 / §6 testing | 7 |


