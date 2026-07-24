# Changelog

All notable changes to Untangler are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

## [0.9.0] – Unreleased (public beta)

### Added
- 17 keyboard snap actions (halves, quarters, thirds, maximize, almost
  maximize, center, restore, next/previous display) with repeated-press
  size cycling (½ → ⅔ → ⅓; ¼ → ⅙) and per-window restore.
- Outer/inner gap settings applied to every snap.
- Extended drag snap zones (halves, quarters, thirds, two-thirds, sixths)
  with a live translucent preview; Off / Replace GNOME's edge tiling /
  Modifier-only modes with crash-safe restore of the native setting.
- Pair tiling: drop a window onto another window to tile the two side by
  side (modifier for a ⅔/⅓ split).
- Footprint splitting: drop onto a window snapped to a half/quarter/third
  to split that region instead (a half becomes stacked quarters).
- GTK4/Adwaita preferences: shortcut capture with system-conflict warnings,
  gaps, cycling toggle, drag/pair modes.
- 90 Node-run unit tests over the pure geometry/cycling/zone modules.
- Translatable preferences (gettext domain `untangler`); duplicate-shortcut
  warnings inside Untangler; conflict warnings refresh live.
- Hardened shell boundary: all-or-nothing pair drops, ownership-aware native
  edge-tiling handling, bounded Wayland settle retries, crash-safe lifecycle,
  prefixed failure logging.
