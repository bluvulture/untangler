# Release checklist

## Automated gate
- [ ] `npm run verify` green locally and in CI on the release commit

## Manual compatibility matrix (record date + versions for each)
| Check | GNOME 46 Wayland | GNOME 47 Wayland | GNOME 48 Wayland | X11/XWayland |
|---|---|---|---|---|
| Clean install + enable | | | | |
| Upgrade from previous release | | | | |
| Keyboard matrix (docs/TESTING.md §Keyboard) | | | | |
| Drag matrix (§Drag snapping) | | | | |
| Pair + footprint (§Pair tiling) | | | | |
| Lifecycle 10× enable/disable, journal clean | | | | |
| Edge-tiling crash recovery | | | | |

Also record: distribution, Mutter and GJS versions; 1/2/3-monitor runs; mixed
100%/200% scaling; CSD (Text Editor), SSD, fixed-size (Calculator), min-size
apps; maximized and natively-tiled windows; drags across monitor boundaries;
Esc cancellation; rapid repeated shortcuts; pair target closed mid-drop.

## Accessibility pass (manual)
- [ ] Preferences fully keyboard-navigable
- [ ] Orca reads preference rows sensibly
- [ ] High-contrast and large-text: preview and prefs legible
- [ ] RTL locale spot-check
- [ ] Reduced-motion: animations acceptable

## Release steps
- [ ] CHANGELOG section finalized, date stamped
- [ ] `version-name` in metadata.json matches the release
- [ ] Annotated tag `vX.Y.Z` pushed (tags are immutable — never move one)
- [ ] Release workflow's draft release reviewed; zip + .sha256 attached;
      notes include the commit SHA
- [ ] Publish the release; verify the zip installs via
      `gnome-extensions install`
- [ ] Verify the downloaded release asset against the tag:
      VERIFY_ZIP=<downloaded zip> npm run verify
- [ ] For 0.9.0 (pre-public review) — identity DECIDED 2026-07-24:
      pseudonymous (bluvulture; repo git config already set). Before
      flipping public: rewrite history once with git filter-repo (map all
      author/committer names to bluvulture + the noreply email; drop the
      old-UUID docs/superpowers blobs from history), force-push the
      rewritten main (private repo, no forks — safe), re-verify CI green;
      enable private vulnerability reporting; enable Discussions (or
      update SUPPORT.md); then flip the repository to public

## EGO submission (at/after 0.9.0)
- [ ] Zip passes EGO review guidelines (teardown audit re-run)
- [ ] Screenshot uploaded, description matches metadata
- [ ] Submitted at extensions.gnome.org

## 1.0.0 promotion criteria (from the release plan)
- [ ] All release blockers closed
- [ ] High-priority correctness findings fixed or documented as accepted
- [ ] Full supported-platform matrix has dated results
- [ ] CI reproduces and verifies the release artifact
- [ ] User/contributor/support/security docs published
- [ ] Release candidate completed an external testing period

## Deferred automation (backlog, deliberate)
- Coverage reporting with an explicit eligible-file list (after the
  dispatcher fake harness lands)
- Documentation link checking in CI (beyond the stale-path grep)
