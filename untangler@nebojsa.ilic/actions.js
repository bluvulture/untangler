// actions.js — ActionDispatcher: orchestrates geometry + cycle + mover.
// No gi:// imports here; all Mutter access goes through the WindowMover
// passed into the constructor (spec §2 purity boundary).
import {
    Action, rectForAction, cycleLength, centerRect, mapRectToWorkArea,
    rectsEqual, zoneRect, pairRects,
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
        const id = this._mover.windowId(win);
        const frame = this._mover.frameRect(win);

        // Lazy manual-change detection (spec 3.2/3.3).
        const record = this._freshRecord(win, id, frame);

        switch (action) {
        case Action.RESTORE:
            this._restore(win, id, record);
            break;
        case Action.NEXT_DISPLAY:
            this._moveToDisplay(win, id, frame, +1);
            break;
        case Action.PREV_DISPLAY:
            this._moveToDisplay(win, id, frame, -1);
            break;
        case Action.CENTER:
            this._center(win, id, frame);
            break;
        case Action.MAXIMIZE:
            this._maximize(win, id, frame);
            break;
        default:
            this._snap(win, id, frame, action);
        }
    }

    // Drag-snap drop path (spec 3.6): same restore-recording and gap
    // handling as keyboard actions; cycle index resets.
    applyZone(win, zone, workArea) {
        if (!win)
            return;
        const id = this._mover.windowId(win);
        this._cycles.reset(id);
        const frame = this._mover.frameRect(win);
        this._freshRecord(win, id, frame);
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

    // Pair-tile drop (pair-tile spec §5): arrange the dragged window A and
    // the drop target B side by side. Both get restore records, cycle
    // resets, and settle tracking; B is raised so the result is visible
    // even if a third window covered its new area. A keeps focus.
    applyPairTile(winA, winB, workArea, side, variant) {
        if (!winA || !winB)
            return;
        if (!this._snappable(winA) || !this._snappable(winB))
            return;
        const idA = this._mover.windowId(winA);
        const idB = this._mover.windowId(winB);
        const frameA = this._mover.frameRect(winA);
        const frameB = this._mover.frameRect(winB);
        this._freshRecord(winA, idA, frameA);
        this._freshRecord(winB, idB, frameB);
        const { a, b } = pairRects(workArea, side, variant, this._gaps());
        this._cycles.reset(idA);
        this._cycles.reset(idB);
        this._applyTracked(winA, this._ensureRecord(winA, frameA), a);
        this._applyTracked(winB, this._ensureRecord(winB, frameB), b);
        this._mover.raise(winB);
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
    _freshRecord(win, id, frame) {
        let record = this._records.get(win);
        if (record?.lastApplied && !record.settling &&
            !rectsEqual(frame, record.lastApplied, MANUAL_CHANGE_TOLERANCE)) {
            this._records.delete(win);
            this._cycles.reset(id);
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

    _snap(win, id, frame, action) {
        // Spec 3.7: resize actions skip fixed-size windows (maximized
        // windows count as resizable — see _snappable).
        if (!this._snappable(win))
            return;
        const length = this._settings.get_boolean('cycle-sizes-enabled')
            ? cycleLength(action) : 1;
        const index = this._cycles.advance(id, action, length);
        const workArea = this._mover.workArea(win);
        const rect = rectForAction(workArea, action, index, this._gaps());
        this._applyTracked(win, this._ensureRecord(win, frame), rect);
    }

    _maximize(win, id, frame) {
        this._cycles.advance(id, Action.MAXIMIZE, 1);
        const record = this._ensureRecord(win, frame);
        // Maximized geometry is Mutter's, not ours — skip the manual-change
        // comparison on the next action.
        record.lastApplied = null;
        this._mover.maximize(win);
    }

    _center(win, id, frame) {
        // Center never resizes, so it's allowed for fixed-size windows
        // (spec 3.7).
        this._cycles.advance(id, Action.CENTER, 1);
        const workArea = this._mover.workArea(win);
        const rect = centerRect(workArea, frame, this._gaps());
        this._applyTracked(win, this._ensureRecord(win, frame), rect, false);
    }

    _restore(win, id, record) {
        this._cycles.reset(id);
        if (!record?.original)
            return;
        const original = record.original;
        this._records.delete(win);
        this._mover.apply(win, original);
    }

    _moveToDisplay(win, id, frame, direction) {
        const count = this._mover.monitorCount();
        if (count < 2 || !this._mover.canMove(win))
            return;
        this._cycles.reset(id);
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
