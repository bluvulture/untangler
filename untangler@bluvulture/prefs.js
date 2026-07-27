// SPDX-License-Identifier: GPL-2.0-or-later
// prefs.js — GTK4/Adwaita preferences. Runs in a separate process: no
// Shell imports allowed; talks to the extension only via GSettings.
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { ACTION_ROWS } from './traymodel.js';

export default class UntanglerPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        // GNOME's own keybindings may have been edited (e.g. in GNOME
        // Settings) since this cache was last built, including while this
        // window was closed — never show conflict state from a prior window.
        invalidateSystemShortcuts();
        const settings = this.getSettings();
        window.add(buildShortcutsPage(settings));
        window.add(buildBehaviorPage(settings));
        window.add(buildDragPage(settings));
    }
}

// --- Shortcuts page ---

function buildShortcutsPage(settings) {
    const page = new Adw.PreferencesPage({
        title: _('Shortcuts'),
        icon_name: 'input-keyboard-symbolic',
    });
    const group = new Adw.PreferencesGroup({
        description: _('Click a row, then press the new shortcut. BackSpace clears, Esc cancels. Conflicts with other extensions cannot be detected.'),
    });
    const syncs = [];
    for (const [key, label] of ACTION_ROWS) {
        const { row, sync } = buildShortcutRow(settings, key, label);
        group.add(row);
        syncs.push(sync);
    }
    // A change to ANY snap key can create or clear a duplicate warning on
    // every OTHER row, so re-sync the whole page whenever one changes.
    settings.connect('changed', (_settings, key) => {
        if (key.startsWith('snap-'))
            syncs.forEach(s => s());
    });
    page.add(group);
    return page;
}

function buildShortcutRow(settings, key, title) {
    const row = new Adw.ActionRow({ title: _(title), activatable: true });
    const shortcutLabel = new Gtk.ShortcutLabel({
        disabled_text: _('Disabled'),
        valign: Gtk.Align.CENTER,
    });
    row.add_suffix(shortcutLabel);
    const sync = () => {
        const accel = settings.get_strv(key)[0] ?? '';
        shortcutLabel.accelerator = accel;
        // Warn inline about collisions with Untangler's own shortcuts first
        // (they're more likely to be a mistake), then GNOME's.
        const duplicate = untanglerDuplicate(settings, key, accel);
        if (duplicate)
            row.subtitle = _('⚠ Also assigned to “%s” in Untangler').replace('%s', _(duplicate));
        else
            row.subtitle = conflictWarning(accel);
    };
    // Page-level 'changed' listener (below, in buildShortcutsPage) already
    // re-syncs every row — including this one — on any snap-key change, so
    // no separate changed::<key> connection is needed here.
    sync();
    row.connect('activated', () => openCaptureDialog(row, settings, key));
    return { row, sync };
}

function openCaptureDialog(row, settings, key) {
    // GNOME's own keybindings may have changed concurrently (e.g. the user
    // has GNOME Settings open in another window) — refresh deterministically
    // for the row being edited right now, rather than trusting a cache that
    // may predate this capture.
    invalidateSystemShortcuts();
    const dialog = new Adw.Window({
        modal: true,
        transient_for: row.get_root(),
        title: _('Set Shortcut'),
        default_width: 380,
        default_height: 200,
        content: new Adw.StatusPage({
            title: _('Press a shortcut'),
            description: _('Press BackSpace to clear, Esc to cancel'),
            icon_name: 'input-keyboard-symbolic',
        }),
    });
    // ...and GNOME's keybindings may change again while this dialog is open
    // (same concurrent-edit scenario), so refresh once more on close too.
    dialog.connect('close-request', () => {
        invalidateSystemShortcuts();
        return false;
    });
    const controller = new Gtk.EventControllerKey();
    controller.connect('key-pressed', (_controller, keyval, _keycode, state) => {
        const mask = state & Gtk.accelerator_get_default_mod_mask();
        if (keyval === Gdk.KEY_Escape && mask === 0) {
            dialog.close();
            return Gdk.EVENT_STOP;
        }
        if (keyval === Gdk.KEY_BackSpace && mask === 0) {
            settings.set_strv(key, []);
            dialog.close();
            return Gdk.EVENT_STOP;
        }
        if (!Gtk.accelerator_valid(keyval, mask))
            return Gdk.EVENT_STOP; // bare modifier press etc. — keep waiting
        settings.set_strv(key, [Gtk.accelerator_name(keyval, mask)]);
        dialog.close();
        return Gdk.EVENT_STOP;
    });
    dialog.add_controller(controller);
    dialog.present();
}

// --- Conflict detection against GNOME's own keybinding schemas ---

let systemShortcutsCache = null;

function invalidateSystemShortcuts() {
    systemShortcutsCache = null;
}

function systemShortcuts() {
    if (systemShortcutsCache)
        return systemShortcutsCache;
    systemShortcutsCache = new Map();
    const source = Gio.SettingsSchemaSource.get_default();
    for (const schemaId of ['org.gnome.desktop.wm.keybindings', 'org.gnome.mutter.keybindings']) {
        const schema = source?.lookup(schemaId, true);
        if (!schema)
            continue;
        const gsettings = new Gio.Settings({ settings_schema: schema });
        for (const name of schema.list_keys()) {
            if (gsettings.get_value(name).get_type_string() !== 'as')
                continue;
            for (const accel of gsettings.get_strv(name))
                systemShortcutsCache.set(normalizeAccel(accel), name);
        }
    }
    return systemShortcutsCache;
}

function normalizeAccel(accel) {
    const [ok, keyval, mods] = Gtk.accelerator_parse(accel);
    return ok ? Gtk.accelerator_name(keyval, mods) : accel;
}

function conflictWarning(accel) {
    if (!accel)
        return '';
    const hit = systemShortcuts().get(normalizeAccel(accel));
    return hit ? _('⚠ Conflicts with GNOME shortcut “%s”').replace('%s', hit) : '';
}

// --- Conflict detection against Untangler's own shortcuts ---

function untanglerDuplicate(settings, ownKey, accel) {
    if (!accel)
        return null;
    const normalized = normalizeAccel(accel);
    for (const [key, label] of ACTION_ROWS) {
        if (key === ownKey)
            continue;
        const other = settings.get_strv(key)[0];
        if (other && normalizeAccel(other) === normalized)
            return label;
    }
    return null;
}

// --- Behavior page ---

function buildBehaviorPage(settings) {
    const page = new Adw.PreferencesPage({
        title: _('Behavior'),
        icon_name: 'preferences-system-symbolic',
    });
    const gaps = new Adw.PreferencesGroup({ title: _('Gaps') });
    gaps.add(spinRow(settings, 'outer-gap', _('Outer gap'),
        _('Pixels between snapped windows and the screen edge'), 0, 128));
    gaps.add(spinRow(settings, 'inner-gap', _('Inner gap'),
        _('Pixels between adjacent snapped windows'), 0, 128));
    const cycling = new Adw.PreferencesGroup({ title: _('Cycling') });
    cycling.add(switchRow(settings, 'cycle-sizes-enabled',
        _('Cycle sizes on repeated press'), _('Left Half → Two Thirds → Third')));
    const topBar = new Adw.PreferencesGroup({ title: _('Top bar') });
    topBar.add(switchRow(settings, 'show-tray-icon',
        _('Show top bar icon'),
        _('Menu with all snap actions and preferences')));
    page.add(gaps);
    page.add(cycling);
    page.add(topBar);
    return page;
}

// --- Drag snapping page ---

function buildDragPage(settings) {
    const page = new Adw.PreferencesPage({
        title: _('Drag Snapping'),
        icon_name: 'input-mouse-symbolic',
    });
    const group = new Adw.PreferencesGroup();
    group.add(comboRow(settings, 'drag-snap-mode', _('Drag snapping'),
        _('Replace disables GNOME’s built-in edge tiling while the extension is enabled'),
        ['off', 'replace', 'modifier'],
        [_('Off'), _('Replace GNOME’s edge tiling'), _('Modifier-only')]));
    group.add(comboRow(settings, 'drag-snap-modifier', _('Modifier key'),
        _('Hold while dragging for two-thirds/third variants; in Modifier-only mode this activates the zones'),
        ['ctrl', 'alt', 'shift', 'super'],
        [_('Ctrl'), _('Alt'), _('Shift'), _('Super')]));
    const pairRow = comboRow(settings, 'pair-tile-mode', _('Pair tiling on drop'),
        '',
        ['off', 'modifier', 'always'],
        [_('Off'), _('With modifier held'), _('Always')]);
    group.add(pairRow);
    // The pair-tiling drop gesture only exists while drag snapping itself
    // is enabled; grey the row out (and explain why) whenever it's off.
    const syncPairRow = () => {
        const active = settings.get_string('drag-snap-mode') !== 'off';
        pairRow.sensitive = active;
        pairRow.subtitle = active
            ? _('Dropping a window onto the middle of another window tiles the two side by side')
            : _('Requires drag snapping to be enabled');
    };
    settings.connect('changed::drag-snap-mode', syncPairRow);
    syncPairRow();
    group.add(spinRow(settings, 'edge-band-px', _('Edge band size'),
        _('Zone trigger depth from the screen edges, in pixels'), 4, 64));
    group.add(switchRow(settings, 'show-preview', _('Show zone preview'),
        _('Translucent overlay of the target zone while dragging')));
    page.add(group);
    return page;
}

// --- Row helpers ---

function spinRow(settings, key, title, subtitle, lower, upper) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({ lower, upper, step_increment: 1 }),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function switchRow(settings, key, title, subtitle) {
    const row = new Adw.SwitchRow({ title, subtitle });
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function comboRow(settings, key, title, subtitle, values, labels) {
    const row = new Adw.ComboRow({
        title,
        subtitle,
        model: Gtk.StringList.new(labels),
    });
    row.selected = Math.max(0, values.indexOf(settings.get_string(key)));
    row.connect('notify::selected', () => {
        settings.set_string(key, values[row.selected]);
    });
    return row;
}
