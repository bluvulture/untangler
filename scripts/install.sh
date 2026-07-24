#!/usr/bin/env bash
# Dev-install: compile schemas and symlink the extension into the user's
# extensions dir. Log out/in (Wayland) afterwards, then:
#   gnome-extensions enable untangler@bluvulture
set -euo pipefail

UUID="untangler@bluvulture"
SRC="$(cd "$(dirname "$0")/.." && pwd)/$UUID"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

glib-compile-schemas "$SRC/schemas"
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
ln -s "$SRC" "$DEST"
echo "Installed symlink: $DEST -> $SRC"
