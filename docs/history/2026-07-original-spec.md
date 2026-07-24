> **Historical document** — the original pre-implementation design draft, kept
> for the record. The implementation has evolved; see `docs/ARCHITECTURE.md`
> for the current state.

# Spec: "Rectangle for GNOME" — Keyboard-Driven Window Snapping Extension

**Status:** Draft v1
**Target platform:** Ubuntu 24.04 LTS / 25.x — GNOME Shell 46–48, Wayland (X11 sessions supported for free via Mutter)
**Delivery form:** GNOME Shell extension (GJS/JavaScript) + GTK4/Adwaita preferences dialog

---

## 1. Goals & Non-Goals

### 1.1 Goals
- Replicate Rectangle's core workflow: global keyboard shortcuts that snap the focused window to predefined screen regions.
- Repeated-press cycling through size variants (e.g. Left Half → Left Two-Thirds → Left Third).
- Multi-monitor support: snap within monitor, throw window to next/previous monitor preserving relative size.
- Restore: return a window to its pre-snap geometry.
- Configurable shortcuts and gaps via a native preferences UI.
- **Extended drag snap zones**: dragging a window to edge/corner segments snaps to thirds, two-thirds, and sixths (beyond GNOME's native halves/quarters), with a live translucent preview of the target zone.
- Survive GNOME version bumps with minimal churn (thin dependency surface on Mutter API).

### 1.2 Non-Goals (v1)
- Window layouts/profiles ("arrange all windows"), Rectangle Pro-style pinning, app-specific rules.
- KDE/KWin support (separate codebase if ever).
- Settings sync.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────┐
│ GNOME Shell process (Mutter compositor)         │
│                                                 │
│  extension.js  ──► KeybindingManager            │
│                      │  Main.wm.addKeybinding() │
│                      ▼                          │
│                 ActionDispatcher                │
│                      │                          │
│        ┌─────────────┼──────────────┐           │
│        ▼             ▼              ▼           │
│  GeometryEngine  CycleTracker  WindowMover      │
│  (pure functions) (per-window   (Meta.Window    │
│                    state)        move_resize)   │
│        ▲                            ▲           │
│        │                            │           │
│  DragSnapManager ──► ZonePreview (St.Widget     │
│  (grab-op signals,   overlay in window_group)   │
│   pointer tracking)                             │
└─────────────────────────────────────────────────┘
          ▲ GSettings (schema) ▲
          │                    │
     prefs.js (GTK4/Adwaita dialog, separate process)
```

**Key principle:** all geometry math lives in `GeometryEngine` as pure functions `(workArea, action, cycleIndex, gaps) → Rect`. This module has zero Shell imports, so it is unit-testable outside GNOME and immune to Shell API churn. Only `WindowMover` and `KeybindingManager` touch Mutter APIs.

---

## 3. Feature Specification

### 3.1 Snap actions (v1 set)

| Action | Default shortcut | Cycle sequence (fractions of work area) |
|---|---|---|
| Left half | `<Super><Alt>Left` | 1/2 → 2/3 → 1/3 |
| Right half | `<Super><Alt>Right` | 1/2 → 2/3 → 1/3 |
| Top half | `<Super><Alt>Up` | 1/2 → 2/3 → 1/3 |
| Bottom half | `<Super><Alt>Down` | 1/2 → 2/3 → 1/3 |
| Top-left quarter | `<Super><Alt>U` | 1/4 → 1/6 (l-third × top-half) |
| Top-right quarter | `<Super><Alt>I` | 1/4 → 1/6 |
| Bottom-left quarter | `<Super><Alt>J` | 1/4 → 1/6 |
| Bottom-right quarter | `<Super><Alt>K` | 1/4 → 1/6 |
| First third | `<Super><Alt>D` | left 1/3 |
| Center third | `<Super><Alt>F` | center 1/3 |
| Last third | `<Super><Alt>G` | right 1/3 |
| Maximize | `<Super><Alt>Return` | (uses Meta maximize, not resize) |
| Almost maximize | `<Super><Alt>M` | 90% centered |
| Center (no resize) | `<Super><Alt>C` | — |
| Restore | `<Super><Alt>BackSpace` | restore pre-snap geometry |
| Next display | `<Super><Alt>Page_Down` | move to next monitor, same relative rect |
| Previous display | `<Super><Alt>Page_Up` | — |

Notes:
- All shortcuts rebindable; defaults chosen to avoid collisions with GNOME's built-in `<Super>Left/Right` tiling.
- Cycling: pressing the same action shortcut within the same window advances the cycle; any other action resets that window's cycle index.

### 3.2 Cycling semantics
- `CycleTracker` keeps a `Map<windowId, {lastAction, cycleIndex, timestamp}>`.
- Cycle advances only if `lastAction === currentAction`. No timeout (Rectangle behavior); index resets when a different action fires or window is moved manually (detect via `position-changed`/`size-changed` signals — if geometry differs from what we set, reset).
- Cycle wraps around.

### 3.3 Restore
- Before the *first* snap of an unsnapped window, store `{x, y, width, height}` in a `WeakMap` keyed by the `Meta.Window`, plus in the window's snap record.
- Restore action reapplies it. Manual user resize invalidates stored geometry (same signal-based detection as 3.2).

### 3.4 Multi-monitor
- Work area from `window.get_work_area_current_monitor()` — respects panels/docks per monitor.
- "Next/previous display": compute window's fractional rect relative to current work area, reapply the fraction on the target monitor's work area. Target order = `Meta.Display.get_n_monitors()` index order, wrapping.
- Focus follows the window (no change needed — moving the focused window keeps focus).

### 3.5 Gaps
- Two settings: outer gap (px, work-area inset) and inner gap (px, between adjacent snapped windows — implemented as half-gap inset on shared edges).
- Applied inside `GeometryEngine` only. Default 0.

### 3.6 Drag snap zones (extended edge tiling)

Zone map per monitor work area (all thresholds configurable, defaults in px at 100% scale):

| Pointer region during drag | Target rect |
|---|---|
| Top edge, center 50% | Maximize (matches native, kept for continuity) |
| Left/right edge, middle band (25–75% of height) | Half (matches native) |
| Left/right edge, top band (0–25%) | Top quarter on that side |
| Left/right edge, bottom band (75–100%) | Bottom quarter on that side |
| Bottom edge, left / center / right third segments | First / center / last vertical third |
| Corner hot zones (24 px squares) | Quarter (native-equivalent, ours applies gaps) |
| **Modifier held (default `Ctrl`) + left/right edge bands** | Two-thirds / third variants instead of half/quarter |

Behavior:
- Zone activates when the pointer (not the window frame) enters the trigger band — edge band depth default 16 px, segments as above.
- A translucent rounded-rect **preview overlay** appears over the target zone while hovering it; moves/disappears live as the pointer changes zones. Style via CSS class (`.rg-zone-preview`), respects the shell's light/dark theme.
- On drop inside a zone, the window snaps via the same `GeometryEngine` path as keyboard actions (gaps applied, restore-geometry recorded, cycle index reset).
- On drop outside any zone: nothing happens (normal move).
- `Esc` during drag cancels (Mutter handles the grab cancel; we just hide the preview).

Interplay with Mutter's native edge tiling — **the critical design decision**:
- Native tiling (`org.gnome.mutter edge-tiling`) fires on the same left/right/top edges and would race our handler (double-snap, flicker).
- v1 approach: when the extension's drag-snap feature is enabled, we set `edge-tiling=false` on enable and restore the user's original value on disable (store prior value in our own GSettings). Our zone map is a strict superset of native behavior, so users lose nothing.
- Prefs expose a "Drag snapping: Off / Replace GNOME's / Modifier-only" selector — *Modifier-only* leaves native tiling untouched and only activates our zones while the modifier is held (zero-conflict mode).

### 3.7 Special window handling
- Skip: windows where `window.allows_resize() === false` for resize actions (still allow move/center/next-display).
- Unmaximize (`window.unmaximize(Meta.MaximizeFlags.BOTH)`) before applying any snap rect, otherwise `move_resize_frame` is ignored.
- Untile GNOME-native tiled windows first (check `window.get_maximized()` / tiling state).
- Respect min-size: after `move_resize_frame`, read back the frame rect; if the app clamped it, re-center within the target rect rather than leaving it misaligned.
- Ignore: docks, desktop, DND, splash (`window.get_window_type() !== Meta.WindowType.NORMAL`).

---

## 4. Technical Design

### 4.1 Project structure
```
rectangle-gnome@yourdomain/
├── metadata.json            # shell-version: ["46","47","48"]
├── extension.js             # Extension subclass: enable()/disable()
├── keybindings.js           # KeybindingManager
├── actions.js               # ActionDispatcher + action enum
├── geometry.js              # GeometryEngine (pure, testable)
├── cycle.js                 # CycleTracker
├── mover.js                 # WindowMover (Mutter interaction)
├── prefs.js                 # Adw.PreferencesDialog
├── schemas/
│   └── org.gnome.shell.extensions.rectangle-gnome.gschema.xml
└── tests/
    └── geometry.test.js     # runs under plain gjs or node
```

### 4.2 Keybinding registration
```js
Main.wm.addKeybinding(
  'snap-left-half',                       // GSettings key (type 'as')
  this._settings,
  Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
  Shell.ActionMode.NORMAL,
  () => this._dispatcher.run(Action.LEFT_HALF)
);
```
- One GSettings `as` (string array) key per action holding accelerator strings.
- `disable()` must call `Main.wm.removeKeybinding()` for every registered name and disconnect all signals — EGO review requirement.

### 4.3 Applying geometry
```js
window.unmaximize(Meta.MaximizeFlags.BOTH);
window.move_resize_frame(true /* user_op */, r.x, r.y, r.width, r.height);
```
- Use *frame* rect functions (not buffer rect) so client-side decorations/shadows are handled.
- Wrap in `GLib.idle_add` after unmaximize when the window was maximized — unmaximize is async-ish and immediate resize can race.

### 4.4 Drag snap implementation (`dragsnap.js`, `preview.js`)

**Grab lifecycle:**
```js
this._beginId = global.display.connect('grab-op-begin', (display, window, op) => {
  if (op !== Meta.GrabOp.MOVING) return;           // ignore resizes/keyboard ops
  if (window.get_window_type() !== Meta.WindowType.NORMAL) return;
  this._startTracking(window);
});
this._endId = global.display.connect('grab-op-end', (display, window, op) => {
  if (op !== Meta.GrabOp.MOVING) return;
  const zone = this._currentZone;
  this._stopTracking();
  if (zone) this._mover.apply(window, zone.rect);  // same path as keyboard actions
});
```

**Pointer tracking:** during an active grab, poll `global.get_pointer()` on a
`GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, …)` (~60 Hz). Polling is deliberate:
`Meta.Window::position-changed` under-fires for zone purposes (the pointer, not the
frame, defines the zone) and pointer-motion actor events aren't deliverable to us
during a compositor grab. The 16 ms source is created on `grab-op-begin` and removed
on `grab-op-end` — never runs outside a drag, so idle cost is zero.

**Zone resolution:** `ZoneResolver.resolve(pointerX, pointerY, workArea, modifierState)`
in `geometry.js` (pure, unit-tested like the rest). Modifier state read from
`global.get_pointer()`'s returned `Clutter.ModifierType` mask.

**Preview overlay:**
```js
this._preview = new St.Widget({ style_class: 'rg-zone-preview', visible: false });
global.window_group.add_child(this._preview);   // below the dragged window's actor
```
- On zone change: `preview.ease({ x, y, width, height, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD })` for the Rectangle-like "fluid" feel; `show()`/`hide()` on enter/leave.
- Raise the dragged window's actor above the preview (`window_group.set_child_above_sibling`).
- Destroy the widget in `disable()` (EGO requirement).

**Native edge-tiling suppression:** on enable (if mode = *Replace*):
```js
const mutter = new Gio.Settings({ schema_id: 'org.gnome.mutter' });
this._settings.set_boolean('saved-edge-tiling', mutter.get_boolean('edge-tiling'));
mutter.set_boolean('edge-tiling', false);
```
Restore in `disable()`. In *Modifier-only* mode, skip this entirely and require the modifier bit in `ZoneResolver`.

### 4.5 GSettings schema (excerpt)
```xml
<key name="snap-left-half" type="as"><default><![CDATA[['<Super><Alt>Left']]]></default></key>
<key name="outer-gap" type="i"><default>0</default><range min="0" max="128"/></key>
<key name="inner-gap" type="i"><default>0</default><range min="0" max="128"/></key>
<key name="cycle-sizes-enabled" type="b"><default>true</default></key>
<key name="drag-snap-mode" type="s"><default>'replace'</default></key> <!-- off|replace|modifier -->
<key name="drag-snap-modifier" type="s"><default>'ctrl'</default></key>
<key name="edge-band-px" type="i"><default>16</default><range min="4" max="64"/></key>
<key name="saved-edge-tiling" type="b"><default>true</default></key>
```

### 4.6 Preferences UI (prefs.js)
- `Adw.PreferencesDialog` with two pages:
  - **Shortcuts**: `Adw.ActionRow` per action + shortcut-capture dialog (reuse the standard `Gtk.EventControllerKey` capture pattern; store as accelerator string via `Gtk.accelerator_name`).
  - **Behavior**: gap spinners, cycling toggle, "restore on drag" toggle.
  - **Drag snapping**: mode selector (Off / Replace GNOME's / Modifier-only), modifier picker, edge band size, preview on/off.
- Prefs run in a separate process — no Shell imports allowed there; communicate only through GSettings.

### 4.7 Version resilience rules
- Import only from `resource:///org/gnome/shell/…` ESM paths (GNOME 45+ style).
- Confine Mutter API usage to `mover.js` + `keybindings.js`; everything else pure JS.
- CI matrix: lint with `eslint` + GJS globals; smoke-test geometry module under plain `gjs`.

---

## 5. Milestones

| # | Deliverable | Scope | Est. |
|---|---|---|---|
| M1 | Skeleton | `gnome-extensions create`, enable/disable lifecycle, one hardcoded keybinding snapping left-half | 1–2 days |
| M2 | Geometry engine | All rects + cycling logic, pure-function tests | 2–3 days |
| M3 | Full action set | All 17 actions wired, restore, min-size handling, multi-monitor | 3–4 days |
| M4 | Preferences | Schema, Adwaita prefs, shortcut capture UI | 3–4 days |
| M5 | Drag snap zones | grab-op tracking, ZoneResolver + tests, preview overlay, edge-tiling suppression, all three modes | 4–5 days |
| M6 | Hardening | Maximized/tiled edge cases, XWayland apps, drag on scaled/multi-monitor boundaries, signal cleanup audit | 3–4 days |
| M7 | Release | EGO submission (review checklist: no leaked signals/timeouts, destroy everything in `disable()`), README, screenshots | 1–2 days |

Total: ~3–4 weeks part-time for a solid v1.

---

## 6. Testing Plan

- **Unit:** `geometry.js` and `cycle.js` under gjs/node — every action × cycle index × gap combination against known-good rects.
- **Manual matrix:** Wayland + XWayland app (e.g. GIMP), CSD app (GNOME Text Editor), SSD app, min-size app (Calculator), 1/2/3-monitor with different scales (100%/200% — verify logical vs physical px; Mutter work areas are logical, no manual scaling needed).
- **Drag matrix:** drag across monitor boundary while zone preview active (preview must jump to the new monitor's work area); Esc-cancel mid-drag; drop exactly on a zone border; modifier pressed/released mid-drag; native `edge-tiling` correctly restored after disable and after a Shell crash-restart (`meta_restart`) — verify no orphaned `false` value.
- **Lifecycle:** enable → use → disable → re-enable loop 10×, check `journalctl /usr/bin/gnome-shell` for leaked-source warnings — including the 16 ms drag poll source.
- **Nested shell for dev:** `dbus-run-session -- gnome-shell --nested --wayland` for fast iteration without logging out.

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Shell API changes each GNOME release | Thin Mutter surface (2 files), CI against nightly GNOME OS image |
| Shortcut collisions with GNOME defaults | Conflict detection in prefs (compare against `org.gnome.desktop.wm.keybindings` + `org.gnome.mutter.keybindings`), warn inline |
| unmaximize/resize race | idle-deferred resize after unmaximize; read-back verification |
| Apps clamping size (min-size) | Read back frame rect, re-center within target |
| EGO review rejection | Follow review guidelines from day one: full teardown in `disable()`, no `Lang`, no deprecated imports |
| Race with native edge tiling | *Replace* mode disables `org.gnome.mutter edge-tiling` while enabled (restored on disable); *Modifier-only* mode avoids overlap entirely |
| Extension disabled uncleanly (crash/logout) leaves `edge-tiling=false` | Persist the user's original value in our schema; re-check & restore on next enable; document `gsettings reset org.gnome.mutter edge-tiling` in README |
| Drag poll cost | Source exists only during an active move grab; 60 Hz pointer read is negligible in-process |

---

## 8. Future (v2 backlog)
- Per-app exclusion list (`wm_class` matching).
- Layout presets ("move all windows into layout X").
- Optional top-bar indicator with action menu.
