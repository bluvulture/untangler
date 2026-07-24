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
- Pair tiling: drop a window onto the middle of another window to tile the
  two side by side; if the target is already snapped to a half/quarter/third,
  the drop splits that region instead — a half becomes stacked quarters
  (in Always mode, hold the modifier for a ⅔ / ⅓ split) —
  off/modifier/always in Preferences

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
