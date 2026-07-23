// prefs.js — GTK4/Adwaita preferences (spec 4.6). Runs in a separate
// process: no Shell imports allowed; talks to the extension only via
// GSettings.
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Must stay in sync with KEYBINDINGS in keybindings.js (which we cannot
// import here — it pulls in Shell UI modules).
const SHORTCUT_ROWS = [
    ['snap-left-half', 'Left half'],
    ['snap-right-half', 'Right half'],
    ['snap-top-half', 'Top half'],
    ['snap-bottom-half', 'Bottom half'],
    ['snap-top-left-quarter', 'Top-left quarter'],
    ['snap-top-right-quarter', 'Top-right quarter'],
    ['snap-bottom-left-quarter', 'Bottom-left quarter'],
    ['snap-bottom-right-quarter', 'Bottom-right quarter'],
    ['snap-first-third', 'First third'],
    ['snap-center-third', 'Center third'],
    ['snap-last-third', 'Last third'],
    ['snap-maximize', 'Maximize'],
    ['snap-almost-maximize', 'Almost maximize'],
    ['snap-center', 'Center (no resize)'],
    ['snap-restore', 'Restore'],
    ['snap-next-display', 'Next display'],
    ['snap-prev-display', 'Previous display'],
];

export default class UntanglerPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.add(buildShortcutsPage(settings));
        window.add(buildBehaviorPage(settings));
        window.add(buildDragPage(settings));
    }
}

// --- Shortcuts page ---

function buildShortcutsPage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Shortcuts',
        icon_name: 'input-keyboard-symbolic',
    });
    const group = new Adw.PreferencesGroup({
        description: 'Click a row, then press the new shortcut. BackSpace clears, Esc cancels.',
    });
    for (const [key, label] of SHORTCUT_ROWS)
        group.add(buildShortcutRow(settings, key, label));
    page.add(group);
    return page;
}

function buildShortcutRow(settings, key, title) {
    const row = new Adw.ActionRow({ title, activatable: true });
    const shortcutLabel = new Gtk.ShortcutLabel({
        disabled_text: 'Disabled',
        valign: Gtk.Align.CENTER,
    });
    row.add_suffix(shortcutLabel);
    const sync = () => {
        const accel = settings.get_strv(key)[0] ?? '';
        shortcutLabel.accelerator = accel;
        // Spec §7: warn inline about collisions with GNOME's own shortcuts.
        row.subtitle = conflictWarning(accel);
    };
    settings.connect(`changed::${key}`, sync);
    sync();
    row.connect('activated', () => openCaptureDialog(row, settings, key));
    return row;
}

function openCaptureDialog(row, settings, key) {
    const dialog = new Adw.Window({
        modal: true,
        transient_for: row.get_root(),
        title: 'Set Shortcut',
        default_width: 380,
        default_height: 200,
        content: new Adw.StatusPage({
            title: 'Press a shortcut',
            description: 'Press BackSpace to clear, Esc to cancel',
            icon_name: 'input-keyboard-symbolic',
        }),
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

// --- Conflict detection against GNOME's own keybinding schemas (spec §7) ---

let systemShortcutsCache = null;

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
    return hit ? `⚠ Conflicts with GNOME shortcut “${hit}”` : '';
}

// --- Behavior page ---

function buildBehaviorPage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Behavior',
        icon_name: 'preferences-system-symbolic',
    });
    const gaps = new Adw.PreferencesGroup({ title: 'Gaps' });
    gaps.add(spinRow(settings, 'outer-gap', 'Outer gap',
        'Pixels between snapped windows and the screen edge', 0, 128));
    gaps.add(spinRow(settings, 'inner-gap', 'Inner gap',
        'Pixels between adjacent snapped windows', 0, 128));
    const cycling = new Adw.PreferencesGroup({ title: 'Cycling' });
    cycling.add(switchRow(settings, 'cycle-sizes-enabled',
        'Cycle sizes on repeated press', 'Left Half → Two Thirds → Third'));
    page.add(gaps);
    page.add(cycling);
    return page;
}

// --- Drag snapping page ---

function buildDragPage(settings) {
    const page = new Adw.PreferencesPage({
        title: 'Drag Snapping',
        icon_name: 'input-mouse-symbolic',
    });
    const group = new Adw.PreferencesGroup();
    group.add(comboRow(settings, 'drag-snap-mode', 'Drag snapping',
        'Replace disables GNOME’s built-in edge tiling while the extension is enabled',
        ['off', 'replace', 'modifier'],
        ['Off', 'Replace GNOME’s edge tiling', 'Modifier-only']));
    group.add(comboRow(settings, 'drag-snap-modifier', 'Modifier key',
        'Hold while dragging for two-thirds/third variants; in Modifier-only mode this activates the zones',
        ['ctrl', 'alt', 'shift', 'super'],
        ['Ctrl', 'Alt', 'Shift', 'Super']));
    group.add(spinRow(settings, 'edge-band-px', 'Edge band size',
        'Zone trigger depth from the screen edges, in pixels', 4, 64));
    group.add(switchRow(settings, 'show-preview', 'Show zone preview',
        'Translucent overlay of the target zone while dragging'));
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
