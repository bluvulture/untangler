// mover.js — WindowMover: the only file that calls Meta.Window methods.
// Everything the dispatcher needs from Mutter goes through here (spec 4.7:
// thin, replaceable Mutter surface).
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import { recenterWithin } from './geometry.js';

// GNOME 48 removed Meta.MaximizeFlags and the flags argument to
// maximize()/unmaximize(). Feature-detect once; this is the only
// version-dependent spot in the codebase.
let MAXIMIZE_BOTH = null;
try {
    MAXIMIZE_BOTH = Meta.MaximizeFlags.BOTH;
} catch {
    MAXIMIZE_BOTH = null;
}

export class WindowMover {
    constructor() {
        this._pendingSources = new Set();
    }

    destroy() {
        for (const id of this._pendingSources)
            GLib.source_remove(id);
        this._pendingSources.clear();
    }

    focusedWindow() {
        const window = global.display.get_focus_window();
        if (!window)
            return null;
        // Spec 3.7: ignore docks, desktop, splash, DND, etc.
        if (window.get_window_type() !== Meta.WindowType.NORMAL)
            return null;
        return window;
    }

    windowId(window) {
        return window.get_id();
    }

    canResize(window) {
        return window.allows_resize();
    }

    canMove(window) {
        return window.allows_move();
    }

    frameRect(window) {
        const r = window.get_frame_rect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    }

    workArea(window) {
        const r = window.get_work_area_current_monitor();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    }

    monitorCount() {
        return global.display.get_n_monitors();
    }

    currentMonitor(window) {
        return window.get_monitor();
    }

    workAreaForMonitor(window, monitorIndex) {
        const r = window.get_work_area_for_monitor(monitorIndex);
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    }

    isMaximized(window) {
        return Boolean(window.maximized_horizontally || window.maximized_vertically);
    }

    maximize(window) {
        if (MAXIMIZE_BOTH !== null)
            window.maximize(MAXIMIZE_BOTH);
        else
            window.maximize();
    }

    unmaximize(window) {
        if (MAXIMIZE_BOTH !== null)
            window.unmaximize(MAXIMIZE_BOTH);
        else
            window.unmaximize();
    }

    // Apply a target rect (spec 3.7/4.3): unmaximize/untile first and defer
    // one main-loop iteration when we did (unmaximize is async — an
    // immediate resize races it). Then move_resize_frame + deferred
    // min-size read-back: if the app clamped our size, re-center the
    // actual size inside the target rect.
    apply(window, rect, { resize = true } = {}) {
        if (this.isMaximized(window)) {
            this.unmaximize(window);
            this._defer(() => this._place(window, rect, resize));
        } else {
            this._place(window, rect, resize);
        }
    }

    _place(window, rect, resize) {
        if (resize && window.allows_resize()) {
            window.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
            // Read-back must also be deferred: on Wayland the frame rect
            // only updates once the client acks the configure.
            this._defer(() => {
                const frame = window.get_frame_rect();
                if (frame.width === rect.width && frame.height === rect.height)
                    return;
                const centered = recenterWithin(rect, frame.width, frame.height);
                window.move_frame(true, centered.x, centered.y);
            }, 50);
        } else {
            window.move_frame(true, rect.x, rect.y);
        }
    }

    _defer(callback, ms = 0) {
        let id;
        const run = () => {
            this._pendingSources.delete(id);
            callback();
            return GLib.SOURCE_REMOVE;
        };
        id = ms === 0
            ? GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, run)
            : GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, run);
        this._pendingSources.add(id);
    }
}
