#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Reproducible-packaging check: packs the extension (or takes VERIFY_ZIP),
# asserts the archive member set matches the source tree, and byte-compares
# every member. Extra sources are derived from the directory, never listed
# by hand.
set -euo pipefail
cd "$(dirname "$0")/.."
UUID="untangler@bluvulture"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Tracked files must not reference untracked working docs. .gitignore and
# this script legitimately mention the path itself, so both are excluded.
if git grep -n 'docs/superpowers' -- ':(exclude)docs/superpowers' ':(exclude).gitignore' ':(exclude)scripts/verify-package.sh' > "$TMP/stale" 2>/dev/null; then
  echo "FAIL: tracked files reference docs/superpowers:" >&2
  cat "$TMP/stale" >&2
  exit 1
fi

if [ -n "${VERIFY_ZIP:-}" ]; then
  ZIP="$VERIFY_ZIP"
else
  EXTRA=()
  for f in "$UUID"/*.js; do
    base=$(basename "$f")
    if [ "$base" != "extension.js" ] && [ "$base" != "prefs.js" ]; then
      EXTRA+=("--extra-source=$base")
    fi
  done
  gnome-extensions pack "$UUID" "${EXTRA[@]}" --force --out-dir="$TMP" > /dev/null
  ZIP="$TMP/$UUID.shell-extension.zip"
fi

{
  echo "metadata.json"
  echo "extension.js"
  echo "prefs.js"
  echo "stylesheet.css"
  for f in "$UUID"/*.js; do
    base=$(basename "$f")
    if [ "$base" != "extension.js" ] && [ "$base" != "prefs.js" ]; then
      echo "$base"
    fi
  done
  echo "schemas/org.gnome.shell.extensions.untangler.gschema.xml"
} | sort > "$TMP/expected"
zipinfo -1 "$ZIP" | grep -v '/$' | sort > "$TMP/actual"   # drop directory entries

if ! diff -u "$TMP/expected" "$TMP/actual" >&2; then
  echo "FAIL: archive member set differs from the source tree" >&2
  exit 1
fi

while IFS= read -r member; do
  if ! unzip -p "$ZIP" "$member" | cmp -s - "$UUID/$member"; then
    echo "FAIL: packed $member differs from the source tree" >&2
    exit 1
  fi
done < "$TMP/actual"

echo "verify-package: OK ($(wc -l < "$TMP/actual") files byte-identical to source)"
