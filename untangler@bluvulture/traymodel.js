// SPDX-License-Identifier: GPL-2.0-or-later
// traymodel.js — pure data for the top-bar indicator menu and the prefs
// shortcut rows, plus accelerator display formatting for shell UI (where
// Gtk.ShortcutLabel is unavailable). No gi:// imports; Node-tested.

const N_ = s => s;   // extraction marker only; translated at display time

// GSettings key ('as') → user-visible label, in gschema order. Shared by
// prefs.js (shortcut rows) and indicator.js (menu items); sync.test.js
// holds this, KEYBINDINGS, and the gschema to the same 17 keys.
export const ACTION_ROWS = Object.freeze([
    ['snap-left-half', N_('Left half')],
    ['snap-right-half', N_('Right half')],
    ['snap-top-half', N_('Top half')],
    ['snap-bottom-half', N_('Bottom half')],
    ['snap-top-left-quarter', N_('Top-left quarter')],
    ['snap-top-right-quarter', N_('Top-right quarter')],
    ['snap-bottom-left-quarter', N_('Bottom-left quarter')],
    ['snap-bottom-right-quarter', N_('Bottom-right quarter')],
    ['snap-first-third', N_('First third')],
    ['snap-center-third', N_('Center third')],
    ['snap-last-third', N_('Last third')],
    ['snap-maximize', N_('Maximize')],
    ['snap-almost-maximize', N_('Almost maximize')],
    ['snap-center', N_('Center (no resize)')],
    ['snap-restore', N_('Restore')],
    ['snap-next-display', N_('Next display')],
    ['snap-prev-display', N_('Previous display')],
]);

// Menu sections for the indicator, separated in the popup.
export const MENU_GROUPS = Object.freeze([
    ['snap-left-half', 'snap-right-half', 'snap-top-half', 'snap-bottom-half'],
    ['snap-top-left-quarter', 'snap-top-right-quarter',
        'snap-bottom-left-quarter', 'snap-bottom-right-quarter'],
    ['snap-first-third', 'snap-center-third', 'snap-last-third'],
    ['snap-maximize', 'snap-almost-maximize', 'snap-center', 'snap-restore'],
    ['snap-next-display', 'snap-prev-display'],
]);

const MOD_ORDER = ['Super', 'Alt', 'Ctrl', 'Shift'];
const MOD_NAMES = {
    super: 'Super',
    alt: 'Alt',
    control: 'Ctrl', ctrl: 'Ctrl', primary: 'Ctrl',
    shift: 'Shift',
};
const KEY_LABELS = {
    Left: '←', Right: '→', Up: '↑', Down: '↓',
    Return: 'Enter', BackSpace: 'Backspace',
    Page_Up: 'Page Up', Page_Down: 'Page Down',
    space: 'Space',
};

// GTK accelerator string → display text. Best-effort and total: unknown
// modifiers are dropped, unknown keysyms pass through; never throws.
export function formatAccel(accel) {
    if (!accel)
        return '';
    const mods = new Set();
    let rest = accel;
    for (;;) {
        const m = rest.match(/^<([A-Za-z_]+)>/);
        if (!m)
            break;
        const name = MOD_NAMES[m[1].toLowerCase()];
        if (name)
            mods.add(name);
        rest = rest.slice(m[0].length);
    }
    if (rest.length === 1 && /[a-z]/.test(rest))
        rest = rest.toUpperCase();
    else
        rest = KEY_LABELS[rest] ?? rest;
    const parts = MOD_ORDER.filter(m => mods.has(m));
    if (rest)
        parts.push(rest);
    return parts.join('+');
}
