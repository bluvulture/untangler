# Contributing to Untangler

## Development setup

- Node.js ≥ 20 (used only as a development task runner — Untangler is a GJS
  extension and has zero runtime npm dependencies; nothing is published to npm).
- GNOME Shell 46–48 for manual testing; `glib-compile-schemas` and
  `gnome-extensions` (from the gnome-shell package) for packaging.

```bash
npm run verify   # tests, syntax checks, schema validation, reproducible-package check
npm run package  # build the release zip + SHA-256 + commit provenance
./scripts/install.sh   # DEVELOPMENT install (symlinks this working tree)
```

After code changes, reload the shell (X11: Alt+F2 `r`; Wayland: log out/in) —
GNOME Shell caches extension modules per process.

## Code rules

- **Purity boundary:** `geometry.js`, `cycle.js`, and `actions.js` must not
  import `gi://` or `resource:///` — they are unit-tested under Node.
  Mutter/Shell access lives in `mover.js`, `keybindings.js`, `dragsnap.js`,
  `preview.js`, `extension.js`; `prefs.js` runs in a separate GTK process.
- **Coverage honesty:** Node tests cover the pure modules and the dispatcher.
  `mover.js`, `dragsnap.js`, `preview.js`, `prefs.js`, and `extension.js` are
  shell-side and are validated by the manual matrix in `docs/TESTING.md` —
  never present pure-module coverage as whole-extension coverage.
- Tests first (TDD) for any behavior change; every signal/source/actor
  acquired in `enable()` is released in `disable()` (EGO requirement).
- Inbound contributions are accepted under GPL-2.0-or-later.

## Pull requests

Run `npm run verify` before opening a PR, and re-run the `docs/TESTING.md`
rows your change touches in a live session. Describe what you tested.

## Translations

Preference strings use the `untangler` gettext domain. There are no committed
PO files yet; if you want to contribute a translation, open an issue and we
will set up `po/` extraction together.

## Maintainership

Untangler has a single maintainer (@bluvulture), who makes releases and final
decisions on breaking changes. The latest release line receives fixes. Setup
questions belong in GitHub issues/Discussions (see SUPPORT.md); vulnerabilities
go through SECURITY.md — not public issues.
