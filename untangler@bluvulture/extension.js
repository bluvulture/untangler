// SPDX-License-Identifier: GPL-2.0-or-later
// extension.js — lifecycle only: construct on enable, tear down fully on
// disable (EGO requirement). All logic lives in the managers.
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { ActionDispatcher } from './actions.js';
import { KeybindingManager } from './keybindings.js';
import { WindowMover } from './mover.js';
import { DragSnapManager } from './dragsnap.js';

export default class UntanglerExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._mover = new WindowMover();
        this._dispatcher = new ActionDispatcher(this._settings, this._mover);
        this._keybindings = new KeybindingManager(this._settings, this._dispatcher);
        this._keybindings.enable();
        this._dragSnap = new DragSnapManager(this._settings, this._dispatcher, this._mover);
        this._dragSnap.enable();
    }

    disable() {
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
