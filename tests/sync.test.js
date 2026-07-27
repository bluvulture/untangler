// SPDX-License-Identifier: GPL-2.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ACTION_ROWS } from '../untangler@bluvulture/traymodel.js';

const EXT_DIR = new URL('../untangler@bluvulture/', import.meta.url);

function read(name) {
    return readFileSync(new URL(name, EXT_DIR), 'utf8');
}

function matches(text, re) {
    return [...text.matchAll(re)].map(m => m[1]);
}

test('schema, KEYBINDINGS and ACTION_ROWS list the same 17 snap keys in the same order', () => {
    const schema = matches(
        read('schemas/org.gnome.shell.extensions.untangler.gschema.xml'),
        /<key name="(snap-[a-z-]+)" type="as">/g);
    const keybindings = matches(read('keybindings.js'), /'(snap-[a-z-]+)':/g);
    assert.equal(schema.length, 17);
    assert.deepEqual(keybindings, schema);
    assert.deepEqual(ACTION_ROWS.map(([key]) => key), schema);
});

test('prefs.js uses the shared ACTION_ROWS, not a private copy', () => {
    const prefs = read('prefs.js');
    assert.match(prefs, /import \{ ACTION_ROWS \} from '\.\/traymodel\.js'/);
    assert.doesNotMatch(prefs, /SHORTCUT_ROWS/);
});

test('show-tray-icon key exists in the schema with a true default', () => {
    assert.match(
        read('schemas/org.gnome.shell.extensions.untangler.gschema.xml'),
        /<key name="show-tray-icon" type="b"><default>true<\/default>/);
});
