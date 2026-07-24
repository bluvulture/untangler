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
- [ ] Modifier-only mode: hold the modifier and drop in a zone that overlaps native tiling (left edge, middle band) — check for double-snap/flicker races with GNOME's native tiling and that Restore returns to the true pre-drag frame
- [ ] Esc during drag: preview hides, no snap
- [ ] Drop outside any zone: plain move, no snap
- [ ] Drag across monitor boundary: preview jumps to the other monitor's work area
- [ ] Restore after a drag-snap returns pre-drag size

## Lifecycle
- [ ] enable → use → disable → re-enable ×10, then check
      `journalctl /usr/bin/gnome-shell -b | grep -i untangler` — no leaked
      source/actor warnings
- [ ] After disable: all shortcuts inert, no preview widget, edge-tiling restored

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
- [ ] Footprint split: with left/right halves in place, drop a third window onto the middle of one half — that half splits into stacked quarters; the other half untouched
- [ ] Drop position picks the end: drop high in the half → new window on top; drop low → bottom
- [ ] Ctrl during a footprint drop (Always mode): new window gets ⅔ of the footprint
- [ ] Drop onto a snapped quarter: splits it side-by-side into eighths (recursion)
- [ ] After a shell restart, drop onto a keyboard-snapped half: still splits (stateless geometric match)
- [ ] Free-floating target: still pairs as whole-screen halves
