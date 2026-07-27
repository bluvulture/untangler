#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Build the release zip with provenance: SHA-256 + source commit.
set -euo pipefail
cd "$(dirname "$0")/.."
UUID="untangler@bluvulture"
EXTRA=()
for f in "$UUID"/*.js; do
  base=$(basename "$f")
  if [ "$base" != "extension.js" ] && [ "$base" != "prefs.js" ]; then
    EXTRA+=("--extra-source=$base")
  fi
done
EXTRA+=("--extra-source=icons")
gnome-extensions pack "$UUID" "${EXTRA[@]}" --force --out-dir=.
echo "commit: $(git rev-parse HEAD)"
sha256sum "$UUID.shell-extension.zip"
