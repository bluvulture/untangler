// SPDX-License-Identifier: GPL-2.0-or-later
// extension.js — lifecycle only: construct on enable, tear down fully on
// disable (EGO requirement). All logic lives in the managers.
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { ActionDispatcher } from './actions.js';
import { KeybindingManager } from './keybindings.js';
import { WindowMover } from './mover.js';
import { DragSnapManager } from './dragsnap.js';
import { UntanglerIndicator } from './indicator.js';
import { logError } from './log.js';

export default class UntanglerExtension extends Extension {
    enable() {
        try {
            this._settings = this.getSettings();
            this._mover = new WindowMover();
            this._dispatcher = new ActionDispatcher(this._settings, this._mover);
            this._keybindings = new KeybindingManager(this._settings, this._dispatcher);
            this._keybindings.enable();
            this._dragSnap = new DragSnapManager(this._settings, this._dispatcher, this._mover);
            this._dragSnap.enable();
            this._indicator = new UntanglerIndicator(
                this._settings, this._dispatcher, this);
            Main.panel.addToStatusArea(this.uuid, this._indicator);
        } catch (error) {
            // Partial enablement must not linger: roll back via the same
            // teardown, then rethrow so the Shell marks us errored.
            logError('enable failed; rolling back', error);
            this.disable();
            throw error;
        }
    }

    disable() {
        // Reverse of enable()'s construction order: the indicator goes
        // first since it references the dispatcher.
        this._indicator?.destroy();
        this._indicator = null;
        this._dragSnap?.destroy();
        this._dragSnap = null;
        this._keybindings?.disable();
        this._keybindings = null;
        this._dispatcher?.destroy();
        this._dispatcher = null;
        this._mover?.destroy();
        this._mover = null;
        this._settings = null;
    }
}
