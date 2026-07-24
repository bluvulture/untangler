import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const EXT_DIR = new URL('../untangler@bluvulture/', import.meta.url);

function read(name) {
    return readFileSync(new URL(name, EXT_DIR), 'utf8');
}

function matches(text, re) {
    return [...text.matchAll(re)].map(m => m[1]);
}

test('schema, KEYBINDINGS and SHORTCUT_ROWS list the same 17 snap keys in the same order', () => {
    const schema = matches(
        read('schemas/org.gnome.shell.extensions.untangler.gschema.xml'),
        /<key name="(snap-[a-z-]+)" type="as">/g);
    const keybindings = matches(read('keybindings.js'), /'(snap-[a-z-]+)':/g);
    const prefs = matches(read('prefs.js'), /\['(snap-[a-z-]+)', '/g);
    assert.equal(schema.length, 17);
    assert.deepEqual(keybindings, schema);
    assert.deepEqual(prefs, schema);
});
