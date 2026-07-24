// SPDX-License-Identifier: GPL-2.0-or-later
// actions.js — ActionDispatcher: orchestrates geometry + cycle + mover.
// No gi:// imports here; all Mutter access goes through the WindowMover
// passed into the constructor (spec §2 purity boundary).
import {
    Action, rectForAction, cycleLength, centerRect, mapRectToWorkArea,
    rectsEqual, zoneRect,
} from './geometry.js';
import { CycleTracker } from './cycle.js';

// Frame-rect drift beyond this (px) counts as a manual move/resize.
const MANUAL_CHANGE_TOLERANCE = 2;

export class ActionDispatcher {
    constructor(settings, mover) {
        this._settings = settings;
        this._mover = mover;
        this._cycles = new CycleTracker();
        // Per-window snap records: `original` = pre-snap geometry for
        // Restore (spec 3.3), `lastApplied` = what we last set, used for
        // lazy manual-change detection (spec 3.2/3.3 — checked on the next
        // action instead of per-window signals; same observable behavior,
        // nothing to disconnect). WeakMap so closed windows drop out.
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

        // Lazy manual-change detection (spec 3.2/3.3).
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

    // Drag-snap drop path (spec 3.6): same restore-recording and gap
    // handling as keyboard actions; cycle index resets.
    applyZone(win, zone, workArea) {
        if (!win)
            return;
        this._cycles.reset(win);
        const frame = this._mover.frameRect(win);
        this._freshRecord(win, frame);
        if (zone.action === Action.MAXIMIZE) {
            const record = this._ensureRecord(win, frame);
            record.lastApplied = null;
            this._mover.maximize(win);
            return;
        }
        if (!this._snappable(win))
            return;
        const rect = zoneRect(zone, workArea, this._gaps());
        this._applyTracked(win, this._ensureRecord(win, frame), rect);
    }

    // Pair drop (pair spec §5, footprint-split spec §4): place the dragged
    // window A and drop target B at the rects the caller previewed. Both
    // get restore records, cycle resets, and settle tracking; B is raised
    // so the result is visible even if a third window covered its new
    // area. A keeps focus.
    applyPairRects(winA, winB, aRect, bRect) {
        if (!winA || !winB)
            return;
        if (!this._snappable(winA) || !this._snappable(winB))
            return;
        const frameA = this._mover.frameRect(winA);
        const frameB = this._mover.frameRect(winB);
        this._freshRecord(winA, frameA);
        this._freshRecord(winB, frameB);
        this._cycles.reset(winA);
        this._cycles.reset(winB);
        this._applyTracked(winA, this._ensureRecord(winA, frameA), aRect);
        this._applyTracked(winB, this._ensureRecord(winB, frameB), bRect);
        this._mover.raise(winB);
    }

    // Read-only: the rect we placed `win` at, if it is still exactly
    // there (footprint-split spec §2.1). Used by drag-snap to decide
    // whether a pair target sits in a snapped footprint.
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
            record = { original: { ...frame }, lastApplied: null, settling: false };
            this._records.set(win, record);
        }
        return record;
    }

    // Lazy manual-change detection (spec 3.2/3.3): a manual move/resize
    // since our last snap resets the cycle and invalidates restore
    // geometry. Runs on every path that reuses a record — keyboard, zone
    // drop, and pair drop. Returns the still-valid record, or undefined.
    _freshRecord(win, frame) {
        let record = this._records.get(win);
        if (record?.lastApplied && !record.settling &&
            !rectsEqual(frame, record.lastApplied, MANUAL_CHANGE_TOLERANCE)) {
            this._records.delete(win);
            this._cycles.reset(win);
            record = undefined;
        }
        return record;
    }

    // Mutter reports allows_resize() === false for maximized windows, but
    // snapping one is exactly the unmaximize-first case the spec demands
    // (v1 spec 3.7, pair spec §2) — maximized counts as resizable here.
    _snappable(win) {
        return this._mover.canResize(win) || this._mover.isMaximized(win);
    }

    // Route every tracked placement through the mover's settle callback:
    // the final rect can legitimately differ from the requested one
    // (min-size clamp → read-back re-centering), and treating that as a
    // manual move would wrongly reset the cycle and drop restore geometry.
    _applyTracked(win, record, rect, resize = true) {
        record.settling = true;
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
        // Spec 3.7: resize actions skip fixed-size windows (maximized
        // windows count as resizable — see _snappable).
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
        this._cycles.advance(win, Action.MAXIMIZE, 1);
        const record = this._ensureRecord(win, frame);
        // Maximized geometry is Mutter's, not ours — skip the manual-change
        // comparison on the next action.
        record.lastApplied = null;
        this._mover.maximize(win);
    }

    _center(win, frame) {
        // Center never resizes, so it's allowed for fixed-size windows
        // (spec 3.7).
        this._cycles.advance(win, Action.CENTER, 1);
        const workArea = this._mover.workArea(win);
        const rect = centerRect(workArea, frame, this._gaps());
        this._applyTracked(win, this._ensureRecord(win, frame), rect, false);
    }

    _restore(win, record) {
        this._cycles.reset(win);
        if (!record?.original)
            return;
        const original = record.original;
        this._records.delete(win);
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
        if (record)
            this._applyTracked(win, record, rect); // keeps `original`
        else
            this._mover.apply(win, rect);
    }
}
