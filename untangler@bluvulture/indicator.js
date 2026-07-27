// SPDX-License-Identifier: GPL-2.0-or-later
// indicator.js — top-bar panel indicator: a Rectangle-style menu of every
// snap action (with its current shortcut) plus Preferences. The menu is
// rebuilt on every open, so hints track rebinds with no listeners to
// disconnect; the target window is captured at open time because the menu
// grab can disturb get_focus_window() by click time.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { KEYBINDINGS } from './keybindings.js';
import { ACTION_ROWS, MENU_GROUPS, formatAccel } from './traymodel.js';

const LABELS = new Map(ACTION_ROWS);
const HINT_OPACITY = 128;   // dim via actor opacity: theme-neutral

export const UntanglerIndicator = GObject.registerClass(
class UntanglerIndicator extends PanelMenu.Button {
    _init(settings, dispatcher, extension) {
        super._init(0.5, 'Untangler', false);
        this._settings = settings;
        this._dispatcher = dispatcher;
        this._extension = extension;
        this._target = null;
        this._targetUnmanagedId = 0;

        this.add_child(new St.Icon({
            gicon: Gio.icon_new_for_string(
                `${extension.path}/icons/untangler-symbolic.svg`),
            style_class: 'system-status-icon',
        }));

        this.menu.connect('open-state-changed', (_menu, open) => {
            this._untrackTarget();
            if (!open)
                return;
            // Same window policy as the keyboard path (mover.focusedWindow):
            // only NORMAL windows; the MRU fallback also skips minimized
            // windows the keyboard path could never target.
            const focus = global.display.get_focus_window();
            this._trackTarget(
                focus?.get_window_type() === Meta.WindowType.NORMAL
                    ? focus
                    : global.display.get_tab_list(Meta.TabList.NORMAL,
                        global.workspace_manager.get_active_workspace())
                        .find(w => !w.minimized) ?? null);
            this._rebuildMenu();
        });

        settings.bind('show-tray-icon', this, 'visible',
            Gio.SettingsBindFlags.GET);

        // PopupMenu.open() refuses to open an empty menu (isEmpty() guard
        // runs before the open-state-changed emission), so seed the full
        // menu once; the open handler rebuilds it with fresh hints.
        this._rebuildMenu();
    }

    destroy() {
        this._untrackTarget();
        super.destroy();
    }

    // The target may be closed while the menu is open (e.g. by another
    // process); drop it so a click becomes a no-op instead of dispatching
    // on an unmanaged window.
    _trackTarget(win) {
        this._target = win;
        if (win) {
            this._targetUnmanagedId = win.connect('unmanaged',
                () => this._untrackTarget());
        }
    }

    _untrackTarget() {
        if (this._target && this._targetUnmanagedId)
            this._target.disconnect(this._targetUnmanagedId);
        this._targetUnmanagedId = 0;
        this._target = null;
    }

    _rebuildMenu() {
        this.menu.removeAll();
        for (const group of MENU_GROUPS) {
            for (const key of group)
                this.menu.addMenuItem(this._actionItem(key));
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }
        const prefs = new PopupMenu.PopupMenuItem(_('Preferences…'));
        prefs.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(prefs);
    }

    _actionItem(key) {
        const item = new PopupMenu.PopupMenuItem(_(LABELS.get(key)));
        const hintText = formatAccel(this._settings.get_strv(key)[0] ?? '');
        if (hintText) {
            item.add_child(new St.Label({
                text: hintText,
                x_expand: true,
                x_align: Clutter.ActorAlign.END,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'untangler-shortcut-hint',
                opacity: HINT_OPACITY,
            }));
        }
        item.connect('activate', () =>
            this._dispatcher.run(KEYBINDINGS[key], this._target));
        return item;
    }
});
