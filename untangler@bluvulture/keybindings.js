// SPDX-License-Identifier: GPL-2.0-or-later
// keybindings.js — registers/unregisters all shortcuts.
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Action } from './geometry.js';

// GSettings key ('as') → Action. Key names must match the gschema exactly;
// indicator.js imports this map for the tray menu's shortcut labels.
// sync.test.js holds the schema, this map, and traymodel.js's ACTION_ROWS to
// the same 17 keys.
export const KEYBINDINGS = Object.freeze({
    'snap-left-half': Action.LEFT_HALF,
    'snap-right-half': Action.RIGHT_HALF,
    'snap-top-half': Action.TOP_HALF,
    'snap-bottom-half': Action.BOTTOM_HALF,
    'snap-top-left-quarter': Action.TOP_LEFT_QUARTER,
    'snap-top-right-quarter': Action.TOP_RIGHT_QUARTER,
    'snap-bottom-left-quarter': Action.BOTTOM_LEFT_QUARTER,
    'snap-bottom-right-quarter': Action.BOTTOM_RIGHT_QUARTER,
    'snap-first-third': Action.FIRST_THIRD,
    'snap-center-third': Action.CENTER_THIRD,
    'snap-last-third': Action.LAST_THIRD,
    'snap-maximize': Action.MAXIMIZE,
    'snap-almost-maximize': Action.ALMOST_MAXIMIZE,
    'snap-center': Action.CENTER,
    'snap-restore': Action.RESTORE,
    'snap-next-display': Action.NEXT_DISPLAY,
    'snap-prev-display': Action.PREV_DISPLAY,
});

export class KeybindingManager {
    constructor(settings, dispatcher) {
        this._settings = settings;
        this._dispatcher = dispatcher;
        this._registered = [];
    }

    enable() {
        for (const [name, action] of Object.entries(KEYBINDINGS)) {
            Main.wm.addKeybinding(
                name,
                this._settings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL,
                () => this._dispatcher.run(action));
            this._registered.push(name);
        }
    }

    disable() {
        // EGO requirement: remove every registered binding.
        for (const name of this._registered)
            Main.wm.removeKeybinding(name);
        this._registered = [];
    }
}
