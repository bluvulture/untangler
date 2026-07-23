// cycle.js — CycleTracker (spec 3.2): per-window repeated-press state.
// Pure JS, no Shell imports — unit-tested under Node.
//
// Rectangle semantics: no timeout; the cycle advances only when the same
// action repeats on the same window, wraps around, and resets when any
// other action fires. Manual-move invalidation is the dispatcher's job
// (it calls reset()).

export class CycleTracker {
    constructor() {
        this._states = new Map();
    }

    advance(windowId, action, length) {
        const previous = this._states.get(windowId);
        let index = 0;
        if (previous && previous.action === action)
            index = (previous.index + 1) % length;
        this._states.set(windowId, { action, index });
        return index;
    }

    peek(windowId) {
        return this._states.get(windowId) ?? null;
    }

    reset(windowId) {
        this._states.delete(windowId);
    }

    clear() {
        this._states.clear();
    }
}
