// SPDX-License-Identifier: GPL-2.0-or-later
// actions.js — ActionDispatcher: orchestrates geometry + cycle + mover.
// No gi:// imports here; all Mutter access goes through the WindowMover
// passed into the constructor (see ARCHITECTURE.md: module map and the
// purity boundary).
import {
    Action, rectForAction, cycleLength, centerRect, mapRectToWorkArea,
    rectsEqual, zoneRect, MIN_PLACEMENT_PX,
} from './geometry.js';
import { CycleTracker } from './cycle.js';
import { logWarn, logError } from './log.js';

// Frame-rect drift beyond this (px) counts as a manual move/resize.
const MANUAL_CHANGE_TOLERANCE = 2;

export class ActionDispatcher {
    constructor(settings, mover) {
        this._settings = settings;
        this._mover = mover;
        this._cycles = new CycleTracker();
        // Per-window snap records (see ARCHITECTURE.md: placement model):
        // `original` = pre-snap geometry for Restore, `lastApplied` = what
        // we last set, used for lazy manual-change detection (checked on
        // the next action instead of per-window signals; same observable
        // behavior, nothing to disconnect). WeakMap so closed windows drop
        // out.
        this._records = new WeakMap();
    }

    destroy() {
        this._cycles.clear();
    }

    run(action) {
        const win = this._mover.focusedWindow();
        if (!win)
            return;
        const frame = this._mover.frameRect(win);

        // Lazy manual-change detection.
        const record = this._freshRecord(win, frame);

        switch (action) {
        case Action.RESTORE:
            this._restore(win, record);
            break;
        case Action.NEXT_DISPLAY:
            this._moveToDisplay(win, frame, +1);
            break;
        case Action.PREV_DISPLAY:
            this._moveToDisplay(win, frame, -1);
            break;
        case Action.CENTER:
            this._center(win, frame);
            break;
        case Action.MAXIMIZE:
            this._maximize(win, frame);
            break;
        default:
            this._snap(win, frame, action);
        }
    }

    // Drag-snap drop path: same restore-recording and gap handling as
    // keyboard actions; cycle index resets.
    applyZone(win, zone, workArea) {
        if (!win)
            return;
        this._cycles.reset(win);
        const frame = this._mover.frameRect(win);
        this._freshRecord(win, frame);
        if (zone.action === Action.MAXIMIZE) {
            if (!this._mover.canMaximize(win))
                return;
            const record = this._ensureRecord(win, frame);
            record.lastApplied = null;
            record.expectMaximized = true;
            this._mover.maximize(win);
            return;
        }
        if (!this._snappable(win))
            return;
        const rect = zoneRect(zone, workArea, this._gaps());
        this._applyTracked(win, this._ensureRecord(win, frame), rect);
    }

    // Pair drop — all-or-nothing (see ARCHITECTURE.md: drag pipeline):
    // revalidate both windows and BOTH rects before either moves; place
    // the target (B) first and roll it back best-effort if the dragged
    // window's placement fails, so a race can never leave a half-applied
    // pair.
    applyPairRects(winA, winB, aRect, bRect) {
        if (!winA || !winB)
            return;
        if (aRect.width < MIN_PLACEMENT_PX || aRect.height < MIN_PLACEMENT_PX ||
            bRect.width < MIN_PLACEMENT_PX || bRect.height < MIN_PLACEMENT_PX) {
            logWarn('pair drop refused: sub-minimum target rect');
            return;
        }
        let frameA;
        let frameB;
        try {
            if (!this._snappable(winA) || !this._snappable(winB))
                return;
            frameA = this._mover.frameRect(winA);
            frameB = this._mover.frameRect(winB);
        } catch (error) {
            logWarn('pair drop aborted: a window vanished before placement');
            return;
        }
        this._freshRecord(winA, frameA);
        this._freshRecord(winB, frameB);
        this._cycles.reset(winA);
        this._cycles.reset(winB);
        const priorB = this._records.get(winB);
        const priorBSnapshot = priorB ? { ...priorB } : null;
        const recordB = this._ensureRecord(winB, frameB);
        try {
            this._applyTracked(winB, recordB, bRect);
            this._applyTracked(winA, this._ensureRecord(winA, frameA), aRect);
        } catch (error) {
            logError('pair drop failed mid-placement; rolling back the target', error);
            if (priorBSnapshot)
                this._records.set(winB, priorBSnapshot);
            else
                this._records.delete(winB);
            try {
                this._mover.apply(winB, frameB);
            } catch {
                // target gone too — nothing left to roll back
            }
            return;
        }
        this._mover.raise(winB);
    }

    // Read-only: the rect we placed `win` at, if it is still exactly
    // there. Used by drag-snap to decide whether a pair target sits in a
    // snapped footprint (see ARCHITECTURE.md: drag pipeline).
    trackedRect(win, frame) {
        const record = this._records.get(win);
        if (record?.lastApplied && !record.settling &&
            rectsEqual(frame, record.lastApplied, MANUAL_CHANGE_TOLERANCE))
            return record.lastApplied;
        return null;
    }

    _gaps() {
        return {
            outer: this._settings.get_int('outer-gap'),
            inner: this._settings.get_int('inner-gap'),
        };
    }

    _ensureRecord(win, frame) {
        let record = this._records.get(win);
        if (!record) {
            record = {
                original: { ...frame },
                originalMaximized: this._mover.isMaximized(win),
                lastApplied: null,
                settling: false,
                expectMaximized: false,
            };
            this._records.set(win, record);
        }
        return record;
    }

    // Lazy manual-change detection: a manual move/resize since our last
    // snap resets the cycle and invalidates restore geometry. Runs on
    // every path that reuses a record — keyboard, zone drop, and pair
    // drop. Returns the still-valid record, or undefined.
    // Mutter's maximize flags flip synchronously, so a manual unmaximize
    // can't be caught by a signal at the moment it happens — we key on
    // expectMaximized and check it lazily, at the next user action, same
    // as the manual-move case above.
    // Validated live by the TESTING.md row "rapid Maximize→Restore on Wayland".
    _freshRecord(win, frame) {
        let record = this._records.get(win);
        const manualChange = record?.lastApplied && !record.settling &&
            !rectsEqual(frame, record.lastApplied, MANUAL_CHANGE_TOLERANCE);
        const manualUnmaximize = record?.expectMaximized &&
            !this._mover.isMaximized(win);
        if (record && (manualChange || manualUnmaximize)) {
            this._records.delete(win);
            this._cycles.reset(win);
            record = undefined;
        }
        return record;
    }

    // Mutter reports allows_resize() === false for maximized windows, but
    // snapping one is exactly the unmaximize-first flow (see
    // ARCHITECTURE.md: GNOME version notes) — maximized counts as
    // resizable here.
    _snappable(win) {
        return this._mover.canResize(win) || this._mover.isMaximized(win);
    }

    // Route every tracked placement through the mover's settle callback:
    // the final rect can legitimately differ from the requested one
    // (min-size clamp → read-back re-centering), and treating that as a
    // manual move would wrongly reset the cycle and drop restore geometry.
    _applyTracked(win, record, rect, resize = true) {
        if (rect.width < MIN_PLACEMENT_PX || rect.height < MIN_PLACEMENT_PX) {
            logWarn(`refusing sub-minimum placement ${rect.width}x${rect.height}`);
            return;
        }
        record.settling = true;
        record.expectMaximized = false;
        record.lastApplied = rect;
        this._mover.apply(win, rect, {
            resize,
            onSettled: finalRect => {
                record.lastApplied = finalRect;
                record.settling = false;
            },
        });
    }

    _snap(win, frame, action) {
        // Resize actions skip fixed-size windows (maximized windows count
        // as resizable — see _snappable).
        if (!this._snappable(win))
            return;
        const length = this._settings.get_boolean('cycle-sizes-enabled')
            ? cycleLength(action) : 1;
        const index = this._cycles.advance(win, action, length);
        const workArea = this._mover.workArea(win);
        const rect = rectForAction(workArea, action, index, this._gaps());
        this._applyTracked(win, this._ensureRecord(win, frame), rect);
    }

    _maximize(win, frame) {
        if (!this._mover.canMaximize(win))
            return;
        this._cycles.advance(win, Action.MAXIMIZE, 1);
        const record = this._ensureRecord(win, frame);
        // Maximized geometry is Mutter's, not ours — skip the manual-change
        // comparison on the next action.
        record.lastApplied = null;
        record.expectMaximized = true;
        this._mover.maximize(win);
    }

    _center(win, frame) {
        // Center never resizes, so it's allowed for fixed-size windows.
        this._cycles.advance(win, Action.CENTER, 1);
        const workArea = this._mover.workArea(win);
        const rect = centerRect(workArea, frame, this._gaps());
        this._applyTracked(win, this._ensureRecord(win, frame), rect, false);
    }

    _restore(win, record) {
        this._cycles.reset(win);
        if (!record?.original)
            return;
        const { original, originalMaximized } = record;
        this._records.delete(win);
        if (originalMaximized)
            this._mover.maximize(win);
        else
            this._mover.apply(win, original);
    }

    _moveToDisplay(win, frame, direction) {
        const count = this._mover.monitorCount();
        if (count < 2 || !this._mover.canMove(win))
            return;
        this._cycles.reset(win);
        const current = this._mover.currentMonitor(win);
        const target = ((current + direction) % count + count) % count;
        const fromArea = this._mover.workArea(win);
        const toArea = this._mover.workAreaForMonitor(win, target);
        const rect = mapRectToWorkArea(frame, fromArea, toArea);
        const record = this._records.get(win);
        if (record) {
            this._applyTracked(win, record, rect); // keeps `original`
        } else if (rect.width >= MIN_PLACEMENT_PX && rect.height >= MIN_PLACEMENT_PX) {
            this._mover.apply(win, rect);
        } else
            logWarn('refusing sub-minimum monitor-move placement');
    }
}
