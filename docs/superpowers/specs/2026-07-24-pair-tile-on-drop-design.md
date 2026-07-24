# Pair-Tile on Drop — Design

**Status:** Approved in brainstorming 2026-07-24 (trigger: always-with-preview; layout: work-area halves; Ctrl variant: confirmed)
**Base:** Untangler v1 (branch `feat/untangler-v1`, head `2b2cdb5`)
**Spec owner sections in v1 spec:** extends `docs/untangler-spec.md` §3.6 (drag snap); v1 §1.2 non-goal "arrange all windows" stays — this feature arranges exactly two windows, never more.

## 1. Feature

While dragging window A, dropping it onto another window B arranges the two side by side automatically:

- A live preview shows both destinations before release: A's target half in the normal preview style, B's target in a dimmer secondary style.
- On release, A and B become the left/right halves of the work area of the monitor the pointer is on. A takes the side where the pointer was relative to B's center (pointer left of B's center → A left, B right).
- **Ctrl variant:** if the variant modifier (`drag-snap-modifier`, default Ctrl) is held at drop time, A gets two-thirds on its side and B the remaining third — same modifier language as edge zones, using the existing cycle fractions so the two rects complement exactly.
- Esc during drag cancels (existing heuristic). Dropping while inside an edge/corner/bottom zone keeps today's zone behavior — **zones take precedence** over pair-tiling.

## 2. Trigger and eligibility

Pair-tiling is considered on each poll tick only when ALL hold:

1. Drag tracking is active (existing gating: `drag-snap-mode ≠ 'off'`, `Meta.GrabOp.MOVING`, NORMAL window).
2. No edge zone resolved for the pointer (`resolveZone(...) === null`).
3. `pair-tile-mode` gating passes (see §4).
4. Dragged window A `allows_resize()`.
5. An eligible target B exists under the pointer.

**Eligible B:** the topmost window, in stacking order, satisfying all of: not A; `get_window_type() === Meta.WindowType.NORMAL`; not minimized; not fullscreen; on the pointer's monitor; `allows_resize()`; and the pointer is inside the **central region** of B's frame rect — the frame inset by 25% of its width on the left/right and 25% of its height on the top/bottom. The central-region rule keeps casual stacking (dropping near B's edges) a plain move; only a deliberate drop onto B's middle pair-tiles.

If any condition fails → plain move, exactly as today.

**Maximized B** is eligible (it will be unmaximized by the normal apply path). A maximized A cannot be in a move grab in practice; no special handling.

## 3. Resulting geometry

All rects come from the existing pure cycle tables (no new fractions):

| Case | A | B |
|---|---|---|
| side left, no modifier | `rectForAction(wa, LEFT_HALF, 0, gaps)` | `rectForAction(wa, RIGHT_HALF, 0, gaps)` |
| side left, modifier | `rectForAction(wa, LEFT_HALF, 1, gaps)` (⅔) | `rectForAction(wa, RIGHT_HALF, 2, gaps)` (right ⅓) |
| side right, no modifier | `RIGHT_HALF, 0` | `LEFT_HALF, 0` |
| side right, modifier | `RIGHT_HALF, 1` (⅔) | `LEFT_HALF, 2` (left ⅓) |

Gap semantics are unchanged: outer gap insets the work area; the shared edge carries the inner gap split ceil/floor, so the pair tiles exactly like keyboard Left Half + Right Half.

Split axis is always left/right (per the approved layout decision), regardless of monitor orientation.

## 4. Settings

New GSettings key on the existing schema:

```xml
<key name="pair-tile-mode" type="s">
  <choices><choice value="off"/><choice value="modifier"/><choice value="always"/></choices>
  <default>'always'</default>
  <summary>Pair-tile when dropping a window onto another window</summary>
</key>
```

Gating and modifier meaning (consistent with the v1 zone rules):

| drag-snap-mode | pair-tile-mode | Pair-tile triggers when… | Ctrl (variant ⅔/⅓) available? |
|---|---|---|---|
| off | any | never (no drag tracking at all) | — |
| replace/modifier | off | never | — |
| replace | always | pointer over eligible B | yes (Ctrl held at drop) |
| replace | modifier | only while Ctrl held | no (Ctrl is the activation key) |
| modifier | always/modifier | only while Ctrl held (Ctrl already gates all zones) | no |

Prefs: one new `Adw.ComboRow` "Pair tiling on drop" (Off / With modifier / Always) on the Drag Snapping page, same combo-row helper as the existing mode rows.

## 5. Behavior on drop

Through the existing dispatcher, for **both** windows:

- Restore geometry recorded (`_ensureRecord`) — Restore works on B even though the user didn't drag it. For A, the recorded original is the drop-time frame (v1 decision 3); for B it is B's true pre-move frame.
- Cycle state reset for both windows.
- Placement via `_applyTracked` (settle-callback tracking, min-size read-back re-centering, superseded-placement cancellation — decisions 9/10 apply unchanged).
- B is raised (`Meta.Window.raise()`) so the result is visible even if a third window covered B's new area; A keeps focus (it has it from the grab).

## 6. Architecture

Purity boundary unchanged. New code lands in existing files only:

- **geometry.js (pure, Node-tested):**
  - `pickPairSide(pointerX, targetFrame) → 'left' | 'right'` — `'left'` iff pointer x < frame center x.
  - `pairRects(workArea, side, variant, gaps) → {a: rect, b: rect}` — table in §3.
  - `insetFraction(rect, fx, fy) → rect` — helper for the central region (inset by fraction per axis); used shell-side but pure and tested.
- **dragsnap.js:** per poll, when no zone resolves and gating passes, hit-test B (stacking-order iteration: filter eligible windows, take topmost whose central region contains the pointer); extend the change-detection key with `pair:{side}:{variant}:{B id}` (or `null`); on grab-op-end with an active pair candidate, call `dispatcher.applyPairTile(...)` after the existing Esc-cancel check.
- **preview.js:** `ZonePreview` manages a second St.Widget with style class `untangler-zone-preview untangler-zone-preview-dim` for B's destination; `showPair(aRect, bRect)` / existing `showAt` hides the secondary; `hide()`/`destroy()` cover both (EGO teardown).
- **stylesheet.css:** `.untangler-zone-preview-dim` — same visual family, lower opacity.
- **actions.js:** `applyPairTile(winA, winB, workArea, side, variant)` — gaps from settings, `pairRects`, records/cycle-reset/`_applyTracked` for both, then raise B via a new `mover.raise(window)`.
- **mover.js:** `raise(window)` wrapper (one line; keeps the Mutter surface confined).
- **prefs.js:** the combo row; **schema:** the key.

Stacking-order source (shell-side, mover-adjacent code in dragsnap.js): active workspace's window list sorted by `global.display.sort_windows_by_stacking()`, iterated top-down.

## 7. Edge cases

- Pointer inside an edge band → zone wins; pair preview hidden.
- No eligible B / A not resizable / gating off → plain move (today's behavior).
- B under multiple overlapping windows → topmost eligible wins.
- Pointer in B's central region but B on another monitor than the pointer → ineligible (cannot happen — containment implies same monitor — but the monitor check stays as a guard for edge-spanning frames).
- Drop with modifier released mid-drag: variant/gating evaluated per poll from live modifier state, so the last tick before release decides — same rule as zones.
- Extension disable mid-drag: existing `_stopTracking()` + preview destroy covers the secondary widget too.

## 8. Non-goals

- Arranging more than two windows; tile groups; swap-on-drop; top/bottom splits; remembering pairs. (v1 spec §1.2 non-goal stands.)

## 9. Testing

- **Node tests (tests/pair.test.js):** `pickPairSide` boundary (center → 'right' by the `<` rule, both sides, offset frames); `pairRects` complement invariants — for both sides × variant on/off × gaps {0,0} and {10,8}: `a` and `b` tile the inner work area exactly with the inner-gap seam (`b.x − (a.x+a.width) === inner` for side left, mirrored for right), and match the corresponding `rectForAction` outputs; `insetFraction` arithmetic incl. rounding.
- **Sync test:** extend `tests/sync.test.js` expectation only if new snap-* keys were added (none are — `pair-tile-mode` is not a keybinding; no change).
- **Manual (docs/TESTING.md, new section):** always-mode drop on central region (both sides); Ctrl ⅔/⅓; drop near B's edge = plain move; zone precedence; B maximized; B non-resizable app; Restore on B; modifier-only combinations per §4 table; Esc-cancel with pair preview showing; multi-monitor drop.
