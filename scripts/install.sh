#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# DEVELOPMENT-ONLY installer: compiles schemas and symlinks this working
# tree into the user's extensions directory. Normal users should install
# the packaged release zip with `gnome-extensions install` instead.
set -euo pipefail

UUID="untangler@bluvulture"
SRC="$(cd "$(dirname "$0")/.." && pwd)/$UUID"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
FORCE="${1:-}"

command -v glib-compile-schemas > /dev/null || {
  echo "glib-compile-schemas not found — install libglib2.0-bin" >&2
  exit 1
}

if [ -e "$DEST" ] && [ ! -L "$DEST" ] && [ "$FORCE" != "--force" ]; then
  echo "Refusing to remove $DEST: it exists and is not a symlink" >&2
  echo "(probably a real packaged install). Re-run with --force to replace it." >&2
  exit 1
fi

glib-compile-schemas "$SRC/schemas"
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
ln -s "$SRC" "$DEST"
echo "Installed symlink: $DEST -> $SRC"
echo "Reload the shell (X11: Alt+F2 r; Wayland: log out/in), then:"
echo "  gnome-extensions enable $UUID"
