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
        const id = this._mover.windowId(win);
        const frame = this._mover.frameRect(win);

        // Lazy manual-change detection: a manual move/resize since our
        // last snap resets the cycle and invalidates restore geometry.
        let record = this._records.get(win);
        if (record?.lastApplied &&
            !rectsEqual(frame, record.lastApplied, MANUAL_CHANGE_TOLERANCE)) {
            this._records.delete(win);
            this._cycles.reset(id);
            record = undefined;
        }

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
        if (zone.action === Action.MAXIMIZE) {
            const record = this._ensureRecord(win, frame);
            record.lastApplied = null;
            this._mover.maximize(win);
            return;
        }
        if (!this._mover.canResize(win))
            return;
        const rect = zoneRect(zone, workArea, this._gaps());
        const record = this._ensureRecord(win, frame);
        record.lastApplied = rect;
        this._mover.apply(win, rect);
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
            record = { original: { ...frame }, lastApplied: null };
            this._records.set(win, record);
        }
        return record;
    }

    _snap(win, id, frame, action) {
        // Spec 3.7: resize actions skip fixed-size windows.
        if (!this._mover.canResize(win))
            return;
        const length = this._settings.get_boolean('cycle-sizes-enabled')
            ? cycleLength(action) : 1;
        const index = this._cycles.advance(id, action, length);
        const workArea = this._mover.workArea(win);
        const rect = rectForAction(workArea, action, index, this._gaps());
        const record = this._ensureRecord(win, frame);
        record.lastApplied = rect;
        this._mover.apply(win, rect);
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
        const record = this._ensureRecord(win, frame);
        record.lastApplied = rect;
        this._mover.apply(win, rect, { resize: false });
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
            record.lastApplied = rect; // keep `original`; update expectation
        this._mover.apply(win, rect);
    }
}
