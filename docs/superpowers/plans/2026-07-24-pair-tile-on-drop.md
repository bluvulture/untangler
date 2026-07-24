# Pair-Tile on Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dropping a dragged window onto the central region of another window arranges the two as left/right halves of the work area (Ctrl held → ⅔/⅓), with a two-rect live preview.

**Spec:** `docs/superpowers/specs/2026-07-24-pair-tile-on-drop-design.md` (authoritative; § references below point there). Base spec: `docs/untangler-spec.md`.

**Architecture:** Pure math (`pickPairSide`, `pairRects`, `insetFraction`, `rectContains`) appended to `geometry.js` with Node tests; hit-testing and gating in `dragsnap.js`'s existing poll; a dim secondary widget in `ZonePreview`; `ActionDispatcher.applyPairTile` routes both windows through the existing `_applyTracked` machinery; one new GSettings key + prefs combo row. No new files except the test file.

**Tech Stack:** unchanged (GJS ESM, GTK4/Adwaita prefs, Node 24 `node --test`).

## Global Constraints

All v1 plan constraints stay in force (`docs/superpowers/plans/2026-07-23-untangler.md` → Global Constraints), notably:

- Purity: `geometry.js` and `cycle.js` never import `gi://`/`resource:///`; `actions.js` reaches Mutter only through the injected `WindowMover`.
- Every new source/actor is torn down in `destroy()` (EGO rule).
- Rects are plain `{x, y, width, height}`; gaps `{outer, inner}`.
- Test command `npm test` (bare `node --test`); syntax check `npm run check`.
- New schema key exact name/values: `pair-tile-mode`, type `s`, choices `off|modifier|always`, default `'always'` (spec §4).
- Preview CSS classes: primary `.untangler-zone-preview` (existing), secondary adds `.untangler-zone-preview-dim`.
- Gating/variant table is spec §4 — copy behavior exactly; zones always take precedence over pair-tiling (spec §1).
- Current baseline: 37 tests passing at branch head. After Task 1: **44**.
- Note for manual testing (not part of any task): GNOME Shell caches ESM per process — after code changes, `disable`/`enable` is NOT enough; restart the shell (X11: Alt+F2 `r`) after running `scripts/install.sh`.

---

### Task 1: Pure pair-tile geometry

**Files:**
- Modify: `untangler@nebojsa.ilic/geometry.js` (append only; do not touch existing code)
- Test: `tests/pair.test.js` (new)

**Interfaces:**
- Consumes (existing): `Action`, `rectForAction(workArea, action, cycleIndex, gaps)`, `NO_GAPS`.
- Produces (appended exports, used by Tasks 2–3):
  - `pickPairSide(pointerX, targetFrame) → 'left' | 'right'` — `'left'` iff `pointerX < targetFrame.x + targetFrame.width / 2`.
  - `pairRects(workArea, side, variant, gaps = NO_GAPS) → {a: rect, b: rect}` — spec §3 table.
  - `insetFraction(rect, fractionX, fractionY) → rect` — inset by `Math.round(size * fraction)` per side.
  - `rectContains(rect, px, py) → boolean` — half-open: `[x, x+width) × [y, y+height)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/pair.test.js` exactly:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Action, NO_GAPS, rectForAction,
  pickPairSide, pairRects, insetFraction, rectContains,
} from '../untangler@nebojsa.ilic/geometry.js';

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
```

- [ ] **Step 2: Run tests, verify the new file fails**

Run: `npm test`
Expected: existing 37 PASS; pair tests FAIL at module load (`pickPairSide` not exported).

- [ ] **Step 3: Append to `untangler@nebojsa.ilic/geometry.js`**

Append at the end of the file (after the `clamp` function):

```js
// --- Pair tiling (docs/superpowers/specs/2026-07-24-pair-tile-on-drop-design.md) ---

// Which side the dragged window takes: 'left' iff the pointer is left of
// the target frame's horizontal center ('right' on the exact center).
export function pickPairSide(pointerX, targetFrame) {
    return pointerX < targetFrame.x + targetFrame.width / 2 ? 'left' : 'right';
}

// The two rects for a pair-tile drop (spec §3). `side` is where the
// dragged window (a) goes. With `variant` (modifier held), a takes
// two-thirds and b the remaining third — cycle indices 1 and 2 of the
// half tables complement exactly, so the pair tiles like keyboard snaps.
export function pairRects(workArea, side, variant, gaps = NO_GAPS) {
    const aAction = side === 'left' ? Action.LEFT_HALF : Action.RIGHT_HALF;
    const bAction = side === 'left' ? Action.RIGHT_HALF : Action.LEFT_HALF;
    return {
        a: rectForAction(workArea, aAction, variant ? 1 : 0, gaps),
        b: rectForAction(workArea, bAction, variant ? 2 : 0, gaps),
    };
}

// `rect` inset by the given fraction of its size on each side
// (0.25, 0.25 → the central 50% × 50%). Used for the pair-tile
// central-region hit test (spec §2).
export function insetFraction(rect, fractionX, fractionY) {
    const dx = Math.round(rect.width * fractionX);
    const dy = Math.round(rect.height * fractionY);
    return {
        x: rect.x + dx,
        y: rect.y + dy,
        width: rect.width - 2 * dx,
        height: rect.height - 2 * dy,
    };
}

// Half-open containment: [x, x+width) × [y, y+height).
export function rectContains(rect, px, py) {
    return px >= rect.x && px < rect.x + rect.width &&
        py >= rect.y && py < rect.y + rect.height;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test`
Expected: PASS — 44 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add 'untangler@nebojsa.ilic/geometry.js' tests/pair.test.js
git commit -m "feat: pure pair-tile geometry (side picking, pair rects, central region)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Schema key, mover.raise, dispatcher applyPairTile, prefs row

**Files:**
- Modify: `untangler@nebojsa.ilic/schemas/org.gnome.shell.extensions.untangler.gschema.xml`
- Modify: `untangler@nebojsa.ilic/mover.js`
- Modify: `untangler@nebojsa.ilic/actions.js`
- Modify: `untangler@nebojsa.ilic/prefs.js`

**Interfaces:**
- Consumes: `pairRects(workArea, side, variant, gaps)` from Task 1; existing `_ensureRecord(win, frame)`, `_applyTracked(win, record, rect, resize = true)`, `CycleTracker.reset(id)`, `WindowMover` facade.
- Produces (used by Task 3):
  - `ActionDispatcher.applyPairTile(winA, winB, workArea, side, variant) → void`
  - `WindowMover.raise(window) → void`
  - GSettings key `pair-tile-mode` (`'off' | 'modifier' | 'always'`, default `'always'`).

- [ ] **Step 1: Add the schema key**

In the gschema XML, insert directly after the `drag-snap-modifier` key:

```xml
    <key name="pair-tile-mode" type="s">
      <choices><choice value="off"/><choice value="modifier"/><choice value="always"/></choices>
      <default>'always'</default>
      <summary>Pair-tile when dropping a window onto another window</summary>
    </key>
```

- [ ] **Step 2: Verify the schema compiles and refresh the dev-install compile**

Run: `glib-compile-schemas --strict --dry-run 'untangler@nebojsa.ilic/schemas/' && glib-compile-schemas 'untangler@nebojsa.ilic/schemas/'`
Expected: exit 0. (The second call refreshes the git-ignored `gschemas.compiled` used by the symlinked dev install.)

- [ ] **Step 3: Add `raise` to `untangler@nebojsa.ilic/mover.js`**

Insert after the `isMaximized(window)` method:

```js
    raise(window) {
        window.raise();
    }
```

- [ ] **Step 4: Add `applyPairTile` to `untangler@nebojsa.ilic/actions.js`**

Extend the geometry import at the top of the file — replace:

```js
import {
    Action, rectForAction, cycleLength, centerRect, mapRectToWorkArea,
    rectsEqual, zoneRect,
} from './geometry.js';
```

with:

```js
import {
    Action, rectForAction, cycleLength, centerRect, mapRectToWorkArea,
    rectsEqual, zoneRect, pairRects,
} from './geometry.js';
```

Insert the following method directly after the existing `applyZone` method:

```js
    // Pair-tile drop (pair-tile spec §5): arrange the dragged window A and
    // the drop target B side by side. Both get restore records, cycle
    // resets, and settle tracking; B is raised so the result is visible
    // even if a third window covered its new area. A keeps focus.
    applyPairTile(winA, winB, workArea, side, variant) {
        if (!winA || !winB)
            return;
        if (!this._mover.canResize(winA) || !this._mover.canResize(winB))
            return;
        const { a, b } = pairRects(workArea, side, variant, this._gaps());
        this._cycles.reset(this._mover.windowId(winA));
        this._cycles.reset(this._mover.windowId(winB));
        this._applyTracked(winA, this._ensureRecord(winA, this._mover.frameRect(winA)), a);
        this._applyTracked(winB, this._ensureRecord(winB, this._mover.frameRect(winB)), b);
        this._mover.raise(winB);
    }
```

- [ ] **Step 5: Add the prefs combo row**

In `untangler@nebojsa.ilic/prefs.js`, `buildDragPage`, insert directly after the `drag-snap-modifier` comboRow call (before the `edge-band-px` spinRow):

```js
    group.add(comboRow(settings, 'pair-tile-mode', 'Pair tiling on drop',
        'Dropping a window onto the middle of another window tiles the two side by side',
        ['off', 'modifier', 'always'],
        ['Off', 'With modifier held', 'Always']));
```

- [ ] **Step 6: Verify**

Run: `npm run check && npm test && glib-compile-schemas --strict --dry-run 'untangler@nebojsa.ilic/schemas/' && echo ALL-OK`
Expected: 44 tests PASS, `ALL-OK`.

- [ ] **Step 7: Commit**

```bash
git add 'untangler@nebojsa.ilic'
git commit -m "feat: pair-tile dispatcher path, schema key, prefs row

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Drag integration — hit-testing, gating, two-rect preview, docs

**Files:**
- Modify: `untangler@nebojsa.ilic/dragsnap.js`
- Modify: `untangler@nebojsa.ilic/preview.js`
- Modify: `untangler@nebojsa.ilic/stylesheet.css`
- Modify: `docs/TESTING.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-24-pair-tile-on-drop-design.md` (occlusion clarification, Step 8)

**Interfaces:**
- Consumes: `pickPairSide`, `pairRects`, `insetFraction`, `rectContains` (Task 1); `dispatcher.applyPairTile(winA, winB, workArea, side, variant)` (Task 2); existing `ZonePreview`, poll/gating structure.
- Produces: `ZonePreview.showPair(aRect, bRect)`; pair candidate tracking + drop wiring in `DragSnapManager`.

- [ ] **Step 1: Restructure `untangler@nebojsa.ilic/preview.js` for a secondary widget**

Replace the entire file with:

```js
// preview.js — translucent zone preview overlay (spec 3.6/4.4), plus a
// dimmer secondary rect for pair-tiling (pair-tile spec §1).
import Clutter from 'gi://Clutter';
import St from 'gi://St';

const ANIMATION_MS = 120;

export class ZonePreview {
    constructor() {
        // Secondary is added first so it stacks below the primary; both sit
        // under the dragged window's actor (keepBelow() raises the actor
        // above the primary, which is above the secondary).
        this._secondary = new St.Widget({
            style_class: 'untangler-zone-preview untangler-zone-preview-dim',
            visible: false,
        });
        global.window_group.add_child(this._secondary);
        this._widget = new St.Widget({
            style_class: 'untangler-zone-preview',
            visible: false,
        });
        global.window_group.add_child(this._widget);
    }

    showAt(rect) {
        this._hideWidget(this._secondary);
        this._showWidget(this._widget, rect);
    }

    // Pair-tile preview: the dragged window's destination in the normal
    // style, the target window's destination dimmed.
    showPair(aRect, bRect) {
        this._showWidget(this._widget, aRect);
        this._showWidget(this._secondary, bRect);
    }

    keepBelow(windowActor) {
        if (this._widget && windowActor &&
            windowActor.get_parent() === this._widget.get_parent())
            global.window_group.set_child_above_sibling(windowActor, this._widget);
    }

    hide() {
        this._hideWidget(this._widget);
        this._hideWidget(this._secondary);
    }

    destroy() {
        // EGO requirement: actors must not outlive disable().
        this._widget?.destroy();
        this._widget = null;
        this._secondary?.destroy();
        this._secondary = null;
    }

    _showWidget(widget, rect) {
        if (!widget)
            return;
        if (!widget.visible) {
            // First appearance: jump into place and fade in.
            widget.set_position(rect.x, rect.y);
            widget.set_size(rect.width, rect.height);
            widget.opacity = 0;
            widget.show();
            widget.ease({
                opacity: 255,
                duration: ANIMATION_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            return;
        }
        // Target change: glide to the new rect.
        widget.ease({
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            duration: ANIMATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _hideWidget(widget) {
        if (widget) {
            widget.remove_all_transitions();
            widget.hide();
        }
    }
}
```

- [ ] **Step 2: Add the dim style**

Append to `untangler@nebojsa.ilic/stylesheet.css`:

```css
/* Secondary (target window) rect of the pair-tile preview. */
.untangler-zone-preview-dim {
  background-color: rgba(53, 132, 228, 0.12);
  border-color: rgba(53, 132, 228, 0.4);
}
```

- [ ] **Step 3: Wire pair candidates into `untangler@nebojsa.ilic/dragsnap.js`**

Edit 3a — extend the geometry import. Replace:

```js
import { resolveZone, zoneRect, rectsEqual } from './geometry.js';
```

with:

```js
import {
    resolveZone, zoneRect, rectsEqual,
    pickPairSide, pairRects, insetFraction, rectContains,
} from './geometry.js';
```

Edit 3b — add a constant after `const POLL_INTERVAL_MS = 16; ...`:

```js
const PAIR_CENTRAL_INSET = 0.25; // pair-tile hit region: central 50% × 50%
```

Edit 3c — in the constructor, after `this._zone = null;` add:

```js
        this._pair = null;
```

Edit 3d — in `_stopTracking()`, after `this._zone = null;` add:

```js
        this._pair = null;
```

Edit 3e — replace the entire `_poll()` method with:

```js
    _poll() {
        if (!this._window)
            return;
        const [x, y, mods] = global.get_pointer();
        const mode = this._settings.get_string('drag-snap-mode');
        const modifierName = this._settings.get_string('drag-snap-modifier');
        const mask = MODIFIER_MASKS[modifierName] ?? MODIFIER_MASKS.ctrl;
        const modifierHeld = (mods & mask) !== 0;

        let zone = null;
        let pair = null;
        let workArea = null;
        // Modifier-only mode: zones and pair-tiling exist only while the
        // modifier is held (zero-conflict with native tiling); the modifier
        // is then the activation key, so variant sizes are unavailable.
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
                // Zones take precedence; pair-tiling only where no zone hit.
                if (!zone)
                    pair = this._findPair(x, y, monitor.index, modifierHeld, mode);
            }
        }

        const key = zone && workArea
            ? `${zone.action}:${zone.cycleIndex}:${workArea.x}:${workArea.y}:${workArea.width}:${workArea.height}`
            : pair && workArea
                ? `pair:${pair.side}:${pair.variant}:${pair.window.get_id()}:${workArea.x}:${workArea.y}:${workArea.width}:${workArea.height}`
                : null;
        if (key === this._zoneKey)
            return;
        this._zoneKey = key;
        this._zone = zone;
        this._pair = pair;
        this._zoneWorkArea = workArea;

        if (!zone && !pair) {
            this._preview?.hide();
            return;
        }
        if (!this._settings.get_boolean('show-preview'))
            return;
        const gaps = {
            outer: this._settings.get_int('outer-gap'),
            inner: this._settings.get_int('inner-gap'),
        };
        if (zone) {
            this._preview?.showAt(zoneRect(zone, workArea, gaps));
        } else {
            const rects = pairRects(workArea, pair.side, pair.variant, gaps);
            this._preview?.showPair(rects.a, rects.b);
        }
        const actor = this._window.get_compositor_private();
        if (actor)
            this._preview?.keepBelow(actor);
    }
```

Edit 3f — add two new methods directly after `_poll()`:

```js
    // Pair-tile gating (pair-tile spec §4) + target lookup. Returns
    // { window, side, variant } or null.
    _findPair(x, y, monitorIndex, modifierHeld, mode) {
        const pairMode = this._settings.get_string('pair-tile-mode');
        if (pairMode === 'off')
            return null;
        if (pairMode === 'modifier' && !modifierHeld)
            return null;
        if (!this._window.allows_resize())
            return null;
        const target = this._findPairTarget(x, y, monitorIndex);
        if (!target)
            return null;
        return {
            window: target.window,
            side: pickPairSide(x, target.frame),
            // The modifier means "variant sizes" only when it is not
            // already spoken for as an activation key (spec §4 table).
            variant: modifierHeld && pairMode === 'always' && mode !== 'modifier',
        };
    }

    // The visible window under the pointer decides: pair with it if the
    // pointer is in its central region and it is eligible — otherwise no
    // pair at all. Windows beneath the one the user sees are never
    // targets (pair-tile spec §2).
    _findPairTarget(x, y, monitorIndex) {
        const windows = global.display.sort_windows_by_stacking(
            global.workspace_manager.get_active_workspace().list_windows());
        for (let i = windows.length - 1; i >= 0; i--) {
            const win = windows[i];
            if (win === this._window || win.minimized)
                continue;
            if (win.get_window_type() !== Meta.WindowType.NORMAL)
                continue;
            const r = win.get_frame_rect();
            const frame = { x: r.x, y: r.y, width: r.width, height: r.height };
            if (!rectContains(frame, x, y))
                continue;
            if (win.is_fullscreen() || win.get_monitor() !== monitorIndex ||
                !win.allows_resize())
                return null;
            if (!rectContains(
                insetFraction(frame, PAIR_CENTRAL_INSET, PAIR_CENTRAL_INSET), x, y))
                return null;
            return { window: win, frame };
        }
        return null;
    }
```

Edit 3g — replace the body of `_onGrabEnd` with:

```js
    _onGrabEnd(window, op) {
        if (op !== Meta.GrabOp.MOVING || window !== this._window)
            return;
        const zone = this._zone;
        const pair = this._pair;
        const workArea = this._zoneWorkArea;
        const startFrame = this._startFrame;
        this._stopTracking();
        if ((!zone && !pair) || !workArea)
            return;
        // Esc-cancel heuristic: grab-op-end doesn't report cancellation,
        // but Mutter restores the pre-grab frame on cancel. If the frame is
        // back at its starting geometry, treat it as cancelled.
        if (startFrame && rectsEqual(this._mover.frameRect(window), startFrame, 1))
            return;
        if (zone)
            this._dispatcher.applyZone(window, zone, workArea);
        else
            this._dispatcher.applyPairTile(window, pair.window, workArea, pair.side, pair.variant);
    }
```

- [ ] **Step 4: Verify**

Run: `npm run check && npm test && echo ALL-OK`
Expected: 44 tests PASS, `ALL-OK`.

- [ ] **Step 5: Document — `docs/TESTING.md`**

Append this section at the end of the file:

```markdown
## Pair tiling
- [ ] Drop A onto the middle of B: both become left/right halves; A on the side of B where dropped; preview showed both rects (B's dimmer)
- [ ] Same drop with Ctrl held: A two-thirds, B one-third
- [ ] Drop near B's edge (outside its central 50%): plain move, no pair
- [ ] Pointer in an edge band while over B: edge zone wins, single preview
- [ ] B maximized: pair-tile unmaximizes and tiles it
- [ ] B non-resizable: plain move (no pair preview)
- [ ] Restore on B returns its pre-pair geometry; Restore on A returns its drop-time frame
- [ ] pair-tile-mode = With modifier: pair only while Ctrl held (halves only, no ⅔ variant)
- [ ] drag-snap-mode = Modifier-only: Ctrl gates zones AND pair; releasing Ctrl mid-drag clears the pair preview
- [ ] Esc during drag while the pair preview is visible: no snap, both windows unchanged
- [ ] Two monitors: dropping on a window on the other monitor tiles within that monitor's work area
```

- [ ] **Step 6: Document — `README.md`**

In the Features list, append this bullet after the drag-snap-zones bullet:

```markdown
- Pair tiling: drop a window onto the middle of another window to tile the
  two side by side (hold the modifier for a ⅔ / ⅓ split) — off/modifier/always
  in Preferences
```

- [ ] **Step 7: Update the design spec's §2 with the occlusion rule (decided during planning)**

In `docs/superpowers/specs/2026-07-24-pair-tile-on-drop-design.md`, replace the sentence:

```
**Eligible B:** the topmost window, in stacking order, satisfying all of: not A; `get_window_type() === Meta.WindowType.NORMAL`; not minimized; not fullscreen; on the pointer's monitor; `allows_resize()`; and the pointer is inside the **central region** of B's frame rect — the frame inset by 25% of its width on the left/right and 25% of its height on the top/bottom. The central-region rule keeps casual stacking (dropping near B's edges) a plain move; only a deliberate drop onto B's middle pair-tiles.
```

with:

```
**Eligible B:** the topmost non-minimized NORMAL window (in stacking order, excluding A) whose frame contains the pointer — i.e. the window the user visually drops onto. If that window is fullscreen, on another monitor, or not resizable, there is **no pair** (windows beneath it are never considered — pairing with an occluded window would be confusing). Otherwise B pairs only if the pointer is inside its **central region** — the frame inset by 25% of its width on the left/right and 25% of its height on the top/bottom. The central-region rule keeps casual stacking (dropping near B's edges) a plain move; only a deliberate drop onto B's middle pair-tiles.
```

- [ ] **Step 8: Final verify and commit**

Run: `npm run check && npm test && glib-compile-schemas --strict --dry-run 'untangler@nebojsa.ilic/schemas/' && echo ALL-OK`
Expected: 44 tests PASS, `ALL-OK`.

```bash
git add 'untangler@nebojsa.ilic' docs/TESTING.md README.md docs/superpowers/specs/2026-07-24-pair-tile-on-drop-design.md
git commit -m "feat: pair-tile on drop with two-rect preview and gating

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Known accepted edge (do not "fix" without discussion)

If the target window B closes in the final <16 ms between the last poll and `grab-op-end`, `applyPairTile` may touch a disposed `Meta.Window`. The poll refreshes the candidate every 16 ms (a closed window drops out of `list_windows()` on the next tick), so the race window is one tick; the dispatcher's guards make the worst case a caught GJS error on a dead wrapper. Accepted for v1 of this feature — reviewers should note but not block on it.

## Spec coverage map

| Spec § | Task |
|---|---|
| §1 behavior/preview/precedence | 3 |
| §2 trigger + eligibility (incl. occlusion rule) | 3 (hit-test), 1 (insetFraction/rectContains) |
| §3 geometry table | 1 |
| §4 settings/gating | 2 (key/prefs), 3 (gating) |
| §5 drop semantics | 2 (applyPairTile), 3 (wiring) |
| §6 architecture | all (file placement as specified) |
| §7 edge cases | 3 + "known accepted edge" above |
| §9 testing | 1 (Node), 3 (TESTING.md) |
