# Untangler

[![CI](https://github.com/bluvulture/untangler/actions/workflows/ci.yml/badge.svg)](https://github.com/bluvulture/untangler/actions/workflows/ci.yml)

Rectangle-style window snapping for GNOME Shell 46–48 (Wayland and X11):
keyboard actions with repeated-press size cycling, extended drag snap zones
with live preview, pair tiling, and footprint splitting.

**Status: 0.1.0 public beta.** The pure geometry core is heavily unit-tested;
GNOME 46/47/48 runtime validation is in progress (see the compatibility
table). Feedback and bug reports are very welcome.

<!-- TODO screenshot: 1920px-wide capture of two windows pair-tiled with the
     dim preview visible mid-drag; take with GNOME Screenshot on Wayland,
     store as docs/media/pair-preview.png and reference it here. -->

## Features

- 17 snap actions on global shortcuts: halves, quarters, thirds, maximize,
  almost-maximize (90 %), center, restore, move to next/previous display
- Repeated presses cycle sizes: ½ → ⅔ → ⅓ (halves), ¼ → ⅙ (quarters)
- Restore returns a window to where it was before its current snap chain
  began (session-original; re-maximizes if it was maximized)
- Outer and inner gaps, applied consistently to every snap
- Drag snap zones beyond GNOME's built-ins: edge bands for halves and
  quarters, bottom-edge thirds, corner hot zones — with a live translucent
  preview, and two-thirds/sixth variants while holding the modifier
- Pair tiling: drop a window onto the middle of another window to tile the
  two side by side (modifier → ⅔ / ⅓ split)
- Footprint splitting: drop onto a window that is already snapped to a
  half/quarter/third and the two windows split that region instead — a half
  becomes stacked quarters; splits recurse
- Top-bar indicator: a Rectangle-style menu of every snap action with its
  current shortcut, plus quick access to preferences; hideable in settings
- GTK4/Adwaita preferences: rebindable shortcuts with conflict warnings,
  gaps, cycling toggle, drag/pair modes

## Compatibility

| | Wayland | X11 |
|---|---|---|
| GNOME 46 | validation in progress | validation in progress |
| GNOME 47 | not yet validated (experimental) | not yet validated (experimental) |
| GNOME 48 | not yet validated (experimental) | not yet validated (experimental) |

Dated results land here as the release-candidate matrix is executed.

## Install

From a packaged release (recommended):

1. Download `untangler@bluvulture.shell-extension.zip` (and its `.sha256`)
   from the [releases page](https://github.com/bluvulture/untangler/releases);
   optionally verify: `sha256sum -c untangler@bluvulture.shell-extension.zip.sha256`
2. `gnome-extensions install untangler@bluvulture.shell-extension.zip`
3. Reload GNOME Shell: log out and back in (Wayland) or press Alt+F2, type
   `r`, Enter (X11)
4. `gnome-extensions enable untangler@bluvulture`

Preferences: `gnome-extensions prefs untangler@bluvulture` (or via the
Extensions app).

**Update:** `gnome-extensions install --force untangler@bluvulture.shell-extension.zip`, then reload the shell. **Uninstall:** `gnome-extensions uninstall
untangler@bluvulture`.

## Default shortcuts

| Action | Shortcut | Cycles |
|---|---|---|
| Left / Right half | Super+Alt+← / → | ½ → ⅔ → ⅓ |
| Top / Bottom half | Super+Alt+↑ / ↓ | ½ → ⅔ → ⅓ |
| Quarters (TL/TR/BL/BR) | Super+Alt+U / I / J / K | ¼ → ⅙ |
| Thirds (first/center/last) | Super+Alt+D / F / G | — |
| Maximize | Super+Alt+Return | — |
| Almost maximize (90 %) | Super+Alt+M | — |
| Center (no resize) | Super+Alt+C | — |
| Restore | Super+Alt+BackSpace | — |
| Next / previous display | Super+Alt+PageDown / PageUp | — |

All rebindable in Preferences; rows warn when a shortcut collides with
common GNOME system shortcuts (window-manager and Mutter keybindings) or
another Untangler action (conflicts with *other extensions* cannot be
detected — best effort only).

## Settings reference

| Key | Type / default | Meaning |
|---|---|---|
| `outer-gap` | int, 0 (0–128) | Pixels between snapped windows and the work-area edge |
| `inner-gap` | int, 0 (0–128) | Pixels between adjacent snapped windows |
| `cycle-sizes-enabled` | bool, true | Repeated presses cycle size variants |
| `drag-snap-mode` | `off` \| `replace` \| `modifier`, default `replace` | Drag zones: off / replace GNOME's edge tiling / only while the modifier is held |
| `drag-snap-modifier` | `ctrl` \| `alt` \| `shift` \| `super`, default `ctrl` | The variant/activation modifier |
| `pair-tile-mode` | `off` \| `modifier` \| `always`, default `always` | Pair-tile when dropping a window onto another |
| `edge-band-px` | int, 16 (4–64) | Zone trigger depth from screen edges |
| `show-preview` | bool, true | Translucent preview of the drop target |
| `saved-edge-tiling`, `edge-tiling-suppressed` | internal | Crash-safe bookkeeping for Replace mode — don't edit |

Gaps too large for the monitor are clamped automatically; Untangler never
places a window smaller than 16 px per side.

## How the drag modes combine

| Drag snapping | Pair tiling | Zones trigger… | Pair triggers… | Modifier means |
|---|---|---|---|---|
| Off | any | never | never | — |
| Replace | Always | always | pointer over a window's center | variant sizes (⅔/⅓, sixths) |
| Replace | With modifier | always | only while modifier held | pair activation; zones still get variant sizes |
| Replace | Off | always | never | variant sizes (zones only) |
| Modifier-only | any | only while modifier held | only while modifier held (never if pair tiling is Off) | activation (no variants) |

## Restore semantics

Restore is **session-original**: it returns the window to its geometry from
before Untangler's current placement chain began — through any number of
cycling presses, zone drops, pair tiles, or monitor moves — and re-maximizes
it if it was maximized. Manually moving, resizing, or unmaximizing a window
re-baselines it: the next Untangler action starts a fresh chain from the
manual position.

## Known limitations

- **Replace mode changes a global GNOME setting** (`org.gnome.mutter
  edge-tiling`) while enabled and restores it on disable. It checks
  writability, keeps crash-safe backups, and if anything else re-enables
  native tiling, Untangler logs `adopting` and stops claiming the setting.
  Manual recovery, should you ever need it:
  `gsettings reset org.gnome.mutter edge-tiling`
- **Esc-cancel is a heuristic** (Mutter exposes no cancel flag): a drop that
  lands exactly at the window's pre-drag position reads as a cancel, and a
  cancelled drag that Mutter restores late could in principle read as a
  drop. In practice both are rare.
- The top screen edge outside its center 50 % deliberately has no drop target.
- Apps with large minimum sizes can't shrink below them: the window is
  re-centered inside the target zone instead.
- A resizable window that cannot maximize still shows a maximize-zone
  preview; the drop does nothing.
- Odd footprint fragments (e.g. the ⅔ piece of an already-split half) are
  recognized as splittable only until the shell restarts.

## Troubleshooting

```
journalctl /usr/bin/gnome-shell -b 0 --no-pager | grep -i untangler
```

Untangler logs only on failure paths, always prefixed `Untangler:` —
placement refusals (`refusing sub-minimum …`), pair-drop aborts/rollbacks,
edge-tiling suppression problems (`… not writable`, `failed to suppress`,
`re-enabled externally; adopting`), and lifecycle errors (`enable failed`,
`teardown step failed`). Include that output in bug reports, plus the
diagnostics the issue template asks for.

## Development

```bash
npm run verify    # tests + checks + byte-verified reproducible packaging
npm run package   # release zip + SHA-256 + commit provenance
./scripts/install.sh   # DEVELOPMENT install: symlinks this working tree
```

The dev installer replaces `~/.local/share/gnome-shell/extensions/untangler@bluvulture`
(it refuses real installs unless you pass `--force`) — normal users should
install the packaged zip instead. After code changes, reload the shell
(ESM is cached per process).

More: [Architecture](docs/ARCHITECTURE.md) ·
[Contributing](CONTRIBUTING.md) · [Manual test matrix](docs/TESTING.md)

## License

GPL-2.0-or-later — see [LICENSE](LICENSE).
Security policy: [SECURITY.md](SECURITY.md) · Support: [SUPPORT.md](SUPPORT.md)
