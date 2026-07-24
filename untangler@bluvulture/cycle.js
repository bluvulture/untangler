// SPDX-License-Identifier: GPL-2.0-or-later
// cycle.js — CycleTracker: per-window repeated-press state.
// Pure JS, no Shell imports — unit-tested under Node.
//
// Keys are objects (the dispatcher passes the Meta.Window itself), held in
// a WeakMap so state can never outlive its window and window-id reuse can
// never alias state. clear() bumps a generation instead of iterating —
// WeakMaps are not enumerable, and O(1) is what we want anyway.

export class CycleTracker {
    constructor() {
        this._states = new WeakMap();
        this._generation = 0;
    }

    advance(key, action, length) {
        const previous = this._states.get(key);
        let index = 0;
        if (previous && previous.generation === this._generation &&
            previous.action === action)
            index = (previous.index + 1) % length;
        this._states.set(key, { action, index, generation: this._generation });
        return index;
    }

    peek(key) {
        const state = this._states.get(key);
        if (!state || state.generation !== this._generation)
            return null;
        return { action: state.action, index: state.index };
    }

    reset(key) {
        this._states.delete(key);
    }

    clear() {
        this._generation += 1;
    }
}
