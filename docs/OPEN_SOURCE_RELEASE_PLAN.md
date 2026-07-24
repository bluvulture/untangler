# Open-Source Production Readiness Plan

**Project:** Untangler  
**Audit date:** 2026-07-24  
**Current namespace:** `untangler@bluvulture`  
**Recommended release target:** `0.9.0` public beta, followed by `1.0.0` after compatibility validation

## Verdict

Untangler has a strong pure geometry core and a sufficiently complete feature set for an initial public release. It is not production-ready yet.

Do not prioritize major new features before release. The main gaps are:

- Open-source licensing and project policies
- Correctness at the GNOME Shell and Mutter boundary
- Reproducible packaging and release automation
- Automated coverage outside the pure geometry modules
- Verified GNOME 46-48 and Wayland/X11 compatibility
- Accurate user, contributor, and architecture documentation

The highest-risk code is not the geometry engine. It is the interaction with live windows, drag lifecycle, Mutter settings, and asynchronous Wayland behavior.

## Current Strengths

- The geometry and cycle modules are pure JavaScript and directly unit-testable.
- Existing tests cover actions, cycling, gaps, zones, pair layouts, and footprint splitting at the geometry level.
- Schema, shortcut registration, and preferences keys have synchronization coverage.
- Shell actors, signals, keybindings, and deferred sources generally have explicit teardown paths.
- There are no runtime package dependencies.
- There are no network calls, telemetry, secrets, authentication, or remote code loading.
- The current release ZIP uses the renamed UUID and the checked source files match the working tree.
- The source tree is compact and its module responsibilities are mostly clear.

## Release Blockers

### 1. Add an open-source license

No `LICENSE`, SPDX identifier, or package license field currently exists. Publicly visible source without a license does not grant permission to copy, modify, or redistribute it.

Actions:

- [ ] Choose an OSI-approved license.
- [ ] Add a root `LICENSE` file.
- [ ] Add the SPDX identifier to project metadata where applicable.
- [ ] Confirm whether any adapted code requires third-party attribution.

MIT or Apache-2.0 are reasonable defaults for a permissive project.

### 2. Make releases reproducible

The current ZIP matches the checked source, but ZIP files are ignored and there is no automated packaging or provenance check. A future artifact can drift from its source commit without detection.

Actions:

- [ ] Add an `npm run verify` command.
- [ ] Add an `npm run package` command using `gnome-extensions pack`.
- [ ] Derive archive contents from the extension directory rather than a hand-maintained file list.
- [ ] Compare every packaged file with the source tree in CI.
- [ ] Publish the release version, Git commit SHA, and SHA-256 checksum together.
- [ ] Create immutable Git tags for published versions.
- [ ] Publish release artifacts through the repository host rather than keeping a mutable local ZIP as the release source.

The verification command should include:

```text
npm test
npm run check
glib-compile-schemas --strict --dry-run untangler@bluvulture/schemas
bash -n scripts/install.sh
metadata.json validation
archive-to-source comparison
```

### 3. Validate advertised compatibility

The README and metadata advertise GNOME Shell 46-48 and both Wayland and X11. The current testing document records only a GNOME 46 host, and its manual checks are not marked as completed.

Actions:

- [ ] Test clean installation and upgrade on GNOME 46.
- [ ] Test clean installation and upgrade on GNOME 47.
- [ ] Test clean installation and upgrade on GNOME 48.
- [ ] Record Wayland results for every supported Shell version.
- [ ] Record X11 or XWayland results where available.
- [ ] Record exact distribution, Shell, Mutter, and GJS versions.
- [ ] Narrow `shell-version` or label unverified combinations experimental until validation is complete.

### 4. Guarantee valid geometry

Both gaps accept values up to 128 pixels. Geometry calculations subtract those values without guaranteeing a positive target width or height. Small work areas or recursively split footprints can therefore produce zero or negative dimensions.

Relevant code:

- `untangler@bluvulture/geometry.js`: `insetAll`, `span`, and `splitFootprint`
- `untangler@bluvulture/schemas/org.gnome.shell.extensions.untangler.gschema.xml`: gap ranges

Actions:

- [ ] Clamp effective gaps relative to the destination rectangle.
- [ ] Preserve a minimum positive width and height.
- [ ] Reject invalid placements before invoking Mutter.
- [ ] Add tests for maximum gaps and tiny work areas.
- [ ] Add tests for recursive footprint splitting with small rectangles.
- [ ] Add tests for one-pixel boundaries and oversized application minimum sizes.

## Product Correctness

### Fixed-size windows

The documented contract says resize actions do nothing for fixed-size windows. Keyboard maximize and drag-zone maximize currently bypass the ordinary snappability check. Drag previews can also advertise a placement that will not execute.

Actions:

- [ ] Decide whether maximize counts as a prohibited resize action for fixed-size windows.
- [ ] Apply that rule consistently to keyboard and drag paths.
- [ ] Suppress previews for drops that will not be applied.
- [ ] Add dispatcher tests for fixed-size, movable-only, and maximized windows.

### Restore semantics

Restore currently behaves like returning to the first geometry recorded by Untangler. Some documentation instead promises operation-level undo, especially for the target of a pair drop.

Example: if target B was already snapped and is then footprint-split, its existing `original` record is preserved. Restore may return B to its geometry from before the earlier snap instead of its geometry immediately before pairing.

Actions:

- [ ] Define Restore as either session-original restore or latest-operation undo.
- [ ] Define keyboard, drag, maximize, monitor-transfer, and pair behavior separately.
- [ ] Implement the chosen pair-target behavior explicitly.
- [ ] Track prior maximized or tiled state if restoring only geometry is insufficient.
- [ ] Add dispatcher-level tests for every Restore path.
- [ ] Make README, schema summaries, preferences, and testing documentation agree.

### Live drag setting changes

Changing drag snapping to Off during an active drag does not explicitly stop tracking. The polling condition treats every mode except `modifier` as active, so a drag begun under another mode can continue custom snapping after Off is selected.

Preview invalidation also excludes gap and preview settings. Changing gaps can leave an old preview visible while the drop uses new geometry. Turning previews off can leave an existing preview visible.

Actions:

- [ ] Stop active tracking when drag mode becomes Off.
- [ ] Clear zone and pair state when mode changes.
- [ ] Hide previews immediately when `show-preview` becomes false.
- [ ] Recompute previews when gaps or relevant mode settings change.
- [ ] Use an explicit mode switch instead of `mode !== 'modifier'` gating.
- [ ] Add tests for settings changes during an active drag.

### Drag cancellation

Esc cancellation is inferred by comparing the final frame with the drag's starting frame. This can misclassify a legitimate drop whose geometry did not change, and it depends on Mutter restoring geometry before the grab-end handler runs.

Actions:

- [ ] Investigate an explicit cancellation or grab-state API for GNOME 46-48.
- [ ] If no reliable API exists, document the heuristic as a limitation.
- [ ] Test signal ordering and cancellation on every supported Shell version.
- [ ] Add cases for overlapping targets and unchanged-frame drops.

### Pair operation races

A pair target can close between the final pointer poll and application. Pair placement is not transactional, so a failure after moving the dragged window can leave a partial layout.

Actions:

- [ ] Revalidate both windows immediately before placement.
- [ ] Guard initial frame reads and placement calls against disposed windows.
- [ ] Define an application order that minimizes partial updates.
- [ ] Add best-effort rollback if a second placement fails.
- [ ] Add tests for target-close and dragged-window-close races.

### Maximized-window tracking

Maximize clears `lastApplied` because Mutter owns the final geometry. Manual-change detection only runs when `lastApplied` exists, so manually unmaximizing and moving a window can leave stale Restore state.

Actions:

- [ ] Track maximized state explicitly in snap records.
- [ ] Invalidate stale records after manual unmaximize, move, or resize.
- [ ] Add maximize, manual-unmaximize, and Restore tests.

### Native edge-tiling ownership

Replace mode modifies the global `org.gnome.mutter edge-tiling` setting. Writes are not checked for writability or success, and disable restores a historical value even if the user or another extension changed it while Untangler was active.

Actions:

- [ ] Check whether the setting is writable before suppression.
- [ ] Check setter results or read back the applied value.
- [ ] Log or surface a clear fallback when suppression fails.
- [ ] Observe external setting changes while Untangler is active.
- [ ] Restore only if the current value is still the value Untangler imposed.
- [ ] Consider Modifier-only as the safer default until Replace mode is fully validated.

### Wayland settling

Window placement currently performs one read-back after a fixed 50 ms delay. A slow client may still report stale geometry, leading to incorrect recentering and incorrect manual-change tracking.

Actions:

- [ ] Prefer a relevant geometry/configure notification where practical.
- [ ] Otherwise use a short bounded retry until geometry stabilizes.
- [ ] Keep a hard timeout so a client cannot retain pending work indefinitely.
- [ ] Test slow clients, minimum-size clients, and rapid repeated actions.

### Cycle state lifetime

Cycle state uses a strong `Map` keyed by numeric window ID and is not pruned when a window closes. Long sessions can accumulate entries, and a reused ID could inherit stale cycle state.

Actions:

- [ ] Key cycle state by window objects in a `WeakMap`, or remove state on `unmanaged`.
- [ ] Add window-close and identifier-reuse tests.

### Transactional lifecycle

Extension enablement creates resources sequentially without rollback. A failure after some keybindings, actors, signals, or global settings have been acquired can leave partial state. Cleanup is also sequential, so one teardown exception can prevent later cleanup.

Actions:

- [ ] Make enablement transactional with reverse-order rollback.
- [ ] Make manager enable/disable operations idempotent.
- [ ] Isolate teardown steps so one failure does not block the remainder.
- [ ] Add failure-injection tests for partial initialization.
- [ ] Repeat enable, use, disable, and re-enable cycles while checking Shell logs.

## Documentation Plan

### README

Expand the README into a complete user entry point.

Add:

- [ ] Project status and maturity
- [ ] Screenshot or short demonstration
- [ ] Release download link
- [ ] Installation prerequisites
- [ ] Packaged release installation
- [ ] Developer symlink installation with a destructive-operation warning
- [ ] How to enable the extension and open Preferences
- [ ] Update and uninstall instructions
- [ ] Wayland logout/login and X11 reload guidance
- [ ] Troubleshooting and log collection
- [ ] Settings reference
- [ ] Pair-mode and drag-mode interaction table
- [ ] Restore behavior by operation type
- [ ] Known limitations
- [ ] Verified compatibility table
- [ ] Links to contributing, support, and security policies
- [ ] License and project links

Remove or qualify the claim that Replace mode is a strict superset where nothing is lost. The current top-edge map intentionally has no target outside its central region, and complete native equivalence has not been demonstrated.

### Architecture documentation

`docs/untangler-spec.md` is still marked Draft and contains implementation drift.

Actions:

- [ ] Rename or rewrite it as current architecture documentation.
- [ ] Replace placeholder directory and schema names.
- [ ] Correct the list of modules that use Shell and Mutter APIs.
- [ ] Correct the preview CSS class.
- [ ] Remove the nonexistent Restore-on-drag preference.
- [ ] Replace planned ESLint and CI statements with actual tooling or mark them as backlog.
- [ ] Integrate pair tiling and footprint splitting.
- [ ] Separate current behavior from historical decisions and future work.
- [ ] Move durable design documents out of ignored `docs/superpowers` paths.
- [ ] Remove source comments that link to documentation unavailable in a normal clone.

### User behavior reference

Document the non-obvious interaction rules:

- [ ] Pair tiling is unavailable when drag snapping is Off.
- [ ] Zones take precedence over pair targets.
- [ ] Pair targets use the central 50 percent region.
- [ ] Modifier behavior depends on both drag and pair modes.
- [ ] Footprints split along their longer axis.
- [ ] Stateless footprint recognition has geometric limitations.
- [ ] Preview and final geometry can be constrained by application minimum size.
- [ ] Native edge-tiling replacement changes a global Mutter preference.

### Developer installer

`scripts/install.sh` is a developer symlink installer and recursively removes the existing extension destination.

Actions:

- [ ] Label it clearly as development-only in the README.
- [ ] Refuse to remove an unexpected real directory by default.
- [ ] Verify destination ownership or require an explicit force flag.
- [ ] Check required tools before modifying the destination.
- [ ] Add uninstall and rollback instructions.
- [ ] Keep normal users on the packaged `gnome-extensions install` path.

## Open-Source Project Files

Add these files before announcing the project:

- [ ] `LICENSE`
- [ ] `CONTRIBUTING.md`
- [ ] `SECURITY.md`
- [ ] `CODE_OF_CONDUCT.md`
- [ ] `SUPPORT.md`
- [ ] `CHANGELOG.md`
- [ ] A concise maintainer or governance statement
- [ ] Bug-report issue template
- [ ] Feature-request issue template
- [ ] Pull-request template
- [ ] Release checklist

The policies can be short for a single-maintainer project. They should still answer:

- Who can make releases?
- How are breaking decisions made?
- Which versions receive fixes?
- Where should setup questions be asked?
- How are vulnerabilities reported privately?
- What diagnostics should a bug report include?

GNOME-specific bug reports should request:

- Untangler version
- GNOME Shell version
- Distribution and version
- Wayland or X11 session
- Number and scaling of monitors
- Reproduction steps
- Relevant `journalctl` output

## Metadata And Discovery

Actions:

- [ ] Add project URL, issue tracker, and license metadata where supported.
- [ ] Update the extension description to mention pair tiling and footprint splitting.
- [ ] Explain that npm is used only as a development task runner if npm publication is not intended.
- [ ] Add a Node engine requirement for development commands.
- [ ] Establish a repository remote and default branch before public release.
- [ ] Use monotonically increasing release versions.

## Test And CI Plan

### Automated tests

Keep the existing pure-module tests and expand coverage to Shell-facing orchestration through fakes.

Add tests for:

- [ ] `ActionDispatcher` with fake settings, windows, and mover
- [ ] Fixed-size and maximized behavior
- [ ] Restore semantics for all operation types
- [ ] Pair application and partial failures
- [ ] Window disposal during deferred operations
- [ ] Drag-mode and modifier gating
- [ ] Preview invalidation after settings changes
- [ ] Mutter edge-tiling suppression and restoration
- [ ] Failed or locked GSettings writes
- [ ] Duplicate Untangler shortcut detection
- [ ] Extension lifecycle rollback and teardown
- [ ] Invalid geometry rejection
- [ ] Cycle cleanup after window close

Coverage reports must not present geometry-only coverage as whole-extension coverage.

### Continuous integration

Required CI gates:

- [ ] JavaScript syntax checks
- [ ] Unit tests
- [ ] Coverage reporting with an explicit eligible-file list
- [ ] Strict GSettings schema validation
- [ ] Shell script syntax validation
- [ ] Metadata JSON validation
- [ ] Reproducible extension packaging
- [ ] Archive-to-source comparison
- [ ] Release checksum generation
- [ ] Documentation link and stale-path checks

### Manual compatibility matrix

Record dated results for:

- [ ] GNOME Shell 46 on Wayland
- [ ] GNOME Shell 47 on Wayland
- [ ] GNOME Shell 48 on Wayland
- [ ] X11 or representative XWayland applications
- [ ] One, two, and three monitors
- [ ] Mixed 100 and 200 percent scaling
- [ ] Client-side and server-side decorated applications
- [ ] Fixed-size and minimum-size applications
- [ ] Maximized and native-tiled windows
- [ ] Drag across monitor boundaries
- [ ] Esc cancellation
- [ ] Rapid repeated shortcuts
- [ ] Pair target closing during drop
- [ ] Enable/disable/re-enable repeated ten times
- [ ] Crash recovery for native edge tiling

## Preferences, Accessibility, And Localization

The metadata declares a gettext domain, but user-visible preference strings are currently hard-coded.

Actions:

- [ ] Wrap all user-visible strings for translation.
- [ ] Add translation extraction and contribution instructions.
- [ ] Detect duplicate shortcuts within Untangler.
- [ ] Refresh system-shortcut conflicts when relevant settings change.
- [ ] Explain that conflicts with other extensions are best-effort only.
- [ ] Disable or annotate pair controls when drag snapping is Off.
- [ ] Test Preferences using keyboard-only navigation.
- [ ] Test with Orca.
- [ ] Test high-contrast and large-text modes.
- [ ] Test right-to-left layouts.
- [ ] Respect reduced-motion or global animation preferences where available.

## Observability

Add sparse, privacy-safe diagnostics for failure paths.

Actions:

- [ ] Log extension enable failures with an Untangler prefix.
- [ ] Log teardown failures without stopping remaining cleanup.
- [ ] Log rejected invalid geometry.
- [ ] Log failed or non-writable Mutter settings.
- [ ] Distinguish expected closed-window races from unexpected exceptions.
- [ ] Document the exact `journalctl` command users should run.
- [ ] Do not log window titles or application content.

## Delivery Phases

### Phase 1: Public-release foundation

- [ ] Add the license and project policies.
- [ ] Complete repository and extension metadata.
- [ ] Add semantic versioning and a changelog.
- [ ] Add reproducible verify and package commands.
- [ ] Add baseline CI.
- [ ] Publish artifacts with checksums and commit provenance.

Exit criteria: a clean clone can run one documented verification command and produce a byte-verified extension package.

### Phase 2: Correctness hardening

- [ ] Enforce geometry invariants.
- [ ] Resolve and test Restore semantics.
- [ ] Fix fixed-size maximize and preview behavior.
- [ ] Handle active-drag setting changes.
- [ ] Guard window-close and pair-target races.
- [ ] Make edge-tiling suppression ownership-aware.
- [ ] Stabilize asynchronous Wayland placement.
- [ ] Make lifecycle operations transactional.
- [ ] Clean up cycle state.

Exit criteria: every identified high-priority behavior has an automated regression test or a documented GNOME runtime validation where automation is impractical.

### Phase 3: Documentation and contributor readiness

- [ ] Rewrite the README as the primary user guide.
- [ ] Replace the stale draft specification with current architecture documentation.
- [ ] Add a complete settings and behavior reference.
- [ ] Document limitations and recovery procedures.
- [ ] Add contributor, support, security, and governance documentation.
- [ ] Add issue and pull-request templates.

Exit criteria: a new user can install, configure, troubleshoot, update, and uninstall without reading source code, and a contributor can validate a change from a clean clone.

### Phase 4: Release validation

- [ ] Complete automated CI gates.
- [ ] Complete the GNOME 46-48 runtime matrix.
- [ ] Complete Wayland, X11/XWayland, multi-monitor, and mixed-scaling checks.
- [ ] Complete accessibility checks.
- [ ] Publish a release candidate and gather external feedback.

Exit criteria: advertised platform claims are backed by dated results and the release candidate has no unresolved release-blocking defects.

## Release Recommendation

Publish `0.9.0` only after Phases 1-3 are complete. Treat it as a public beta and use it to gather compatibility evidence from GNOME 46-48 users.

Promote to `1.0.0` only when:

- [ ] All release blockers are closed.
- [ ] High-priority correctness findings are fixed or explicitly documented as accepted limitations.
- [ ] The complete supported-platform matrix has recorded results.
- [ ] CI can reproduce and verify the release artifact.
- [ ] User, contributor, support, and security documentation is published.
- [ ] The release candidate has completed a reasonable external testing period.

## Residual Risk

The pure computational core already has a good reliability foundation. The remaining uncertainty is concentrated at the live GNOME Shell boundary, where unit tests alone cannot establish compatibility across Shell versions, display servers, applications, and monitor layouts.

The strongest counterargument to delaying a release is that this is a small, single-maintainer extension and extensive governance can be lightweight. That is valid for process documents, but it does not remove the need for a license, valid geometry, reproducible artifacts, safe global-setting handling, and evidence for advertised platform support.
