# Untangler architecture (current state)

This documents the implementation as it is, for contributors. User-facing
behavior is in the README; the GSettings schema
(`untangler@bluvulture/schemas/…gschema.xml`) is the source of truth for
settings names, types, ranges, and defaults.

## Module map and the purity boundary

| Module | Runs in | May import | Responsibility |
|---|---|---|---|
| `geometry.js` | anywhere (Node-tested) | nothing | All geometry math: action rects, cycle tables, gaps, zone resolution, pair/footprint splits, placement invariants |
| `cycle.js` | anywhere (Node-tested) | nothing | Per-window repeated-press cycle state (WeakMap, generation clear) |
| `traymodel.js` | anywhere (Node-tested) | nothing | Pure indicator-menu data: action rows shared with prefs, menu groups, accelerator display formatting |
| `log.js` | anywhere | nothing | `Untangler: `-prefixed warn/error for failure paths |
| `actions.js` | shell process (Node-loadable) | geometry, cycle, log | ActionDispatcher: orchestrates every placement; owns records; NO direct Mutter access — everything via the injected WindowMover |
| `mover.js` | shell process | GLib, Meta, geometry | The only file calling `Meta.Window` methods; deferred settle machinery |
| `keybindings.js` | shell process | Meta, Shell, Main, geometry | Registers/removes the 17 shortcuts |
| `dragsnap.js` | shell process | Clutter, Gio, GLib, Meta, Main, geometry, log, preview | Drag tracking, zone/pair/footprint candidates, edge-tiling ownership |
| `preview.js` | shell process | Clutter, St | The two translucent preview rects (`.untangler-zone-preview`, `.untangler-zone-preview-dim`) |
| `indicator.js` | shell process | Clutter, Gio, GObject, Meta, St, PanelMenu, PopupMenu, keybindings, traymodel | Top-bar indicator: action menu with shortcut hints, Preferences item, `show-tray-icon` visibility |
| `extension.js` | shell process | Extension API, the shell-side modules above, log | Lifecycle only: build on enable, isolated teardown on disable |
| `prefs.js` | separate GTK process | Adw, Gdk, Gio, Gtk, prefs resource | Preferences dialog; talks to the extension only through GSettings |

The purity boundary is enforced by tests being plain-Node: `geometry.js`,
`cycle.js`, `traymodel.js`, and `actions.js` (through fakes) load without a
GNOME session.

## Placement model

Rects are plain `{x, y, width, height}` objects in logical pixels; gaps are
`{outer, inner}`. Gap settings are clamped (`clampGaps`) inside the rect
producers so canonical slices keep at least `MIN_PLACEMENT_PX` (16 px) per
axis; `splitFootprint` guards its own seam and refuses unsplittable
footprints; and the dispatcher refuses ANY rect below the minimum before it
reaches Mutter (with an `Untangler:` log line) — that final guard is what
makes the invariant unconditional.

Per window the dispatcher keeps one record (WeakMap):

- `original` + `originalMaximized` — the frame (and maximized state) before
  the current placement chain began. **Restore is session-original**: it
  returns here, re-maximizing if needed. A manual move/resize re-baselines
  the record (detected lazily at the next action, ±2 px tolerance);
  a manual unmaximize after our Maximize does too (`expectMaximized` flag).
- `lastApplied` — what we last placed, updated to the *settled* rect.
- `settling` — placement in flight; manual-change detection is suspended.

Placement itself (`mover.apply`): unmaximize first if needed (deferred one
main-loop iteration — unmaximize geometry is async), then
`move_resize_frame`, then a **bounded read-back** (up to 3 reads, 50 ms
apart, until the size matches or stabilizes — slow Wayland clients ack
late). If the app clamped our size (minimum sizes), the actual size is
re-centered within the target and reported back via `onSettled`. A new
placement for the same window **cancels** any pending deferred work for it
(superseded-placement cancellation; per-window WeakMap of source ids) —
rapid re-placements cannot race.

## Drag pipeline

`grab-op-begin` (`Meta.GrabOp.MOVING`, NORMAL windows, drag mode not Off,
window snappable) starts a 16 ms poll; `grab-op-end` stops it. Per tick:

1. Read pointer, modifier state, gaps; find the pointer's monitor work area.
2. **Zones win**: corners (24 px) → top-center 50 % (maximize) → left/right
   bands (quarter/half/quarter by 25/75 % height) → bottom thirds. The
   variant modifier bumps halves→two-thirds, quarters→sixths.
3. No zone → **pair candidate**: the topmost non-minimized NORMAL window
   under the pointer decides (occluded windows are never targets); it must
   be on the pointer's monitor, snappable, with the pointer inside its
   central 50 % × 50 % region. Then:
   - **Footprint split** if the target sits in a recognized snapped region —
     the dispatcher's own fresh tracking first (any rect we placed), else a
     stateless geometric match against the canonical half/quarter/third
     rects (survives shell restarts and covers every canonical cycle rect —
     halves at ½/⅔/⅓, quarters at ¼/⅙, thirds). Non-canonical fragments
     left by earlier footprint splits, plus almost-maximized and centered
     placements, are recognized only while live tracking remembers them.
     Split along the longer axis, dragged window takes the pointer's end,
     variant → ⅔/⅓; refused (→ whole-area halves) if a piece would drop
     below the placement minimum.
   - **Whole-area halves** otherwise (dragged window takes the drop side).
4. The rects are computed once per change and the same objects are
   previewed and applied — preview and drop cannot disagree.
5. Drop: Esc-cancel heuristic first (frame back at its pre-grab rect ±1 px
   ⇒ treat as cancelled — Mutter exposes no cancellation flag on 46–48;
   the deliberate-drop-at-start-position misread is a documented
   limitation). Then the zone or pair path applies through the dispatcher
   (records, cycle resets, raise-target, all-or-nothing pair semantics
   with rollback).

Settings changes apply mid-drag: mode→Off stops tracking immediately,
preview-off hides immediately, any relevant key invalidates the memoized
candidate so the next tick recomputes.

## Native edge tiling (Replace mode)

Replace mode rewrites the GLOBAL `org.gnome.mutter edge-tiling` setting,
ownership-aware: write only if writable, verify by read-back, remember the
user's original value once (crash-safe: never overwritten while the claim
flag stands), watch for external changes and **adopt** (stop claiming) if
something else re-enables native tiling, restore on disable — or whenever
the mode leaves Replace — only if the current value is still the one we
imposed. Recovery command if anything ever goes wrong:
`gsettings reset org.gnome.mutter edge-tiling`.

## Interaction rules (the non-obvious ones)

1. Pair tiling and zones exist only while drag snapping is not Off.
2. Zones always take precedence over pair targets.
3. Pair targets use the central 50 % of the visible window under the pointer.
4. The modifier means "variant sizes" only when it is not already an
   activation key (Modifier-only drag mode, or pair mode "With modifier")
   (zone variants depend only on the drag mode).
5. Footprints split along their longer axis.
6. Stateless footprint recognition knows every canonical snap rect,
   including cycled sizes like two-thirds; fragments produced by footprint
   splits themselves — and almost-maximize/centered placements — are
   recognized only while in-memory tracking lives.
7. Preview and final geometry can be constrained by an app's minimum size —
   the window is then re-centered within the target zone.
8. A maximize-zone preview can appear for a window that cannot maximize
   (resizable but `can_maximize()` false); the drop is a no-op. Previews are
   suppressed entirely only for fixed-size windows. A pair or footprint
   preview can likewise advertise a drop that is refused at apply time when
   a piece would fall below the placement minimum (tiny-footprint cases).

## GNOME version notes

- `Meta.MaximizeFlags` is removed in GNOME **49** (not 48): `mover.js`
  feature-detects once; the flags branch is live on 46–48.
- Mutter reports `allows_resize() === false` for fully-maximized windows —
  everywhere we gate on resizability, "maximized" counts as snappable
  (`_snappable`), because snapping a maximized window is the
  unmaximize-first flow.
- GNOME Shell caches extension ESM per process: after code changes,
  disable/enable is not enough — restart the shell (X11: Alt+F2 `r`;
  Wayland: log out/in).

## Testing

`npm test` (Node ≥ 20): 100 tests over the pure modules and the dispatcher
(via `tests/helpers/fakes.js` — a synchronous WindowMover model with an
explicit settle pump). Shell-side files (`mover.js`, `keybindings.js`,
`dragsnap.js`, `preview.js`, `prefs.js`, `indicator.js`, `extension.js`) are
validated by `node --check` plus the manual matrix in `docs/TESTING.md` —
pure-module coverage is never presented as whole-extension coverage.
`npm run verify` adds schema validation, script checks, and byte-verified
reproducible packaging (`scripts/verify-package.sh`, also usable against a
downloaded release zip via `VERIFY_ZIP=…`).
