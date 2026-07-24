// SPDX-License-Identifier: GPL-2.0-or-later
// Test fakes for the dispatcher: a synchronous WindowMover with an explicit
// settle() pump modelling the deferred read-back, plus settings/window
// stand-ins. Node-only; mirrors the real facade in mover.js.
import { recenterWithin } from '../../untangler@bluvulture/geometry.js';

const SETTINGS_DEFAULTS = {
    'outer-gap': 0,
    'inner-gap': 0,
    'cycle-sizes-enabled': true,
};

export class FakeSettings {
    constructor(overrides = {}) {
        this._values = { ...SETTINGS_DEFAULTS, ...overrides };
    }

    get_int(key) { return this._require(key); }
    get_string(key) { return this._require(key); }
    get_boolean(key) { return this._require(key); }
    set(key, value) { this._values[key] = value; }

    _require(key) {
        if (!(key in this._values))
            throw new Error(`FakeSettings: no value for "${key}"`);
        return this._values[key];
    }
}

let nextWindowId = 1;

export class FakeWindow {
    constructor({
        frame = { x: 100, y: 100, width: 800, height: 600 },
        resizable = true,
        movable = true,
        maximized = false,
        canMaximize = true,
        monitor = 0,
    } = {}) {
        this.id = nextWindowId++;
        this.frame = { ...frame };
        this.resizable = resizable;
        this.movable = movable;
        this.maximized = maximized;
        this.canMaximizeFlag = canMaximize;
        this.monitor = monitor;
        this.closed = false;
    }
}

export class FakeMover {
    constructor({ workAreas = [{ x: 0, y: 0, width: 1920, height: 1080 }] } = {}) {
        this._workAreas = workAreas;
        this._focus = null;
        this._pending = [];
        this._clampSize = null;
        this.calls = [];
    }

    // --- test controls ---
    setFocus(win) { this._focus = win; }
    setClampSize(size) { this._clampSize = size; }   // models min-size apps
    closeWindow(win) { win.closed = true; }

    // Fire pending deferred read-backs, like the real 50ms settle.
    settle() {
        for (const p of this._pending.splice(0)) {
            if (p.win.closed)
                continue;
            let finalRect = p.rect;
            if (p.applied.width !== p.rect.width || p.applied.height !== p.rect.height)
                finalRect = recenterWithin(p.rect, p.applied.width, p.applied.height);
            p.win.frame = { ...finalRect };
            p.onSettled?.(finalRect);
        }
    }

    // --- WindowMover facade (mirrors mover.js) ---
    focusedWindow() { return this._focus; }
    canResize(win) { return win.resizable && !win.maximized; } // Mutter: maximized => false
    canMove(win) { return win.movable; }
    canMaximize(win) { return win.canMaximizeFlag; }
    isMaximized(win) { return win.maximized; }
    frameRect(win) { return { ...win.frame }; }
    workArea(win) { return { ...this._workAreas[win.monitor] }; }
    monitorCount() { return this._workAreas.length; }
    currentMonitor(win) { return win.monitor; }
    workAreaForMonitor(_win, index) { return { ...this._workAreas[index] }; }

    maximize(win) {
        this.calls.push(['maximize', win.id]);
        win.maximized = true;
        win.frame = { ...this._workAreas[win.monitor] };
    }

    unmaximize(win) { win.maximized = false; }

    raise(win) { this.calls.push(['raise', win.id]); }

    apply(win, rect, { resize = true, onSettled = null } = {}) {
        this.calls.push(['apply', win.id, { ...rect }, resize]);
        if (win.maximized)
            win.maximized = false;
        let applied;
        if (resize && win.resizable) {
            applied = this._clampSize
                ? { ...this._clampSize }
                : { width: rect.width, height: rect.height };
        } else {
            applied = { width: win.frame.width, height: win.frame.height };
        }
        win.frame = { x: rect.x, y: rect.y, width: win.frame.width, height: win.frame.height };
        // Mirror mover.js decision 10: a new placement cancels the same
        // window's pending deferred ops.
        this._pending = this._pending.filter(p => p.win !== win);
        this._pending.push({ win, rect, applied, onSettled });
    }

    destroy() {}
}
