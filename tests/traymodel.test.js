// SPDX-License-Identifier: GPL-2.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ACTION_ROWS, MENU_GROUPS, formatAccel } from '../untangler@bluvulture/traymodel.js';

test('MENU_GROUPS flattens to exactly the ACTION_ROWS keys, in order, no duplicates', () => {
    const flat = MENU_GROUPS.flat();
    assert.deepEqual(flat, ACTION_ROWS.map(([key]) => key));
    assert.equal(new Set(flat).size, flat.length);
    assert.equal(flat.length, 17);
});

test('formatAccel maps arrows and named keys', () => {
    assert.equal(formatAccel('<Super><Alt>Left'), 'Super+Alt+←');
    assert.equal(formatAccel('<Super><Alt>Right'), 'Super+Alt+→');
    assert.equal(formatAccel('<Super><Alt>Up'), 'Super+Alt+↑');
    assert.equal(formatAccel('<Super><Alt>Down'), 'Super+Alt+↓');
    assert.equal(formatAccel('<Super><Alt>Return'), 'Super+Alt+Enter');
    assert.equal(formatAccel('<Super><Alt>BackSpace'), 'Super+Alt+Backspace');
    assert.equal(formatAccel('<Super><Alt>Page_Up'), 'Super+Alt+Page Up');
    assert.equal(formatAccel('<Super><Alt>Page_Down'), 'Super+Alt+Page Down');
    assert.equal(formatAccel('<Super>space'), 'Super+Space');
});

test('formatAccel uppercases single letters', () => {
    assert.equal(formatAccel('<Super><Alt>m'), 'Super+Alt+M');
    assert.equal(formatAccel('<Super><Alt>1'), 'Super+Alt+1');
});

test('formatAccel emits modifiers in canonical Super,Alt,Ctrl,Shift order', () => {
    assert.equal(formatAccel('<Alt><Super>x'), 'Super+Alt+X');
    assert.equal(formatAccel('<Shift><Control><Super>F1'), 'Super+Ctrl+Shift+F1');
});

test('formatAccel treats Primary and Ctrl as Ctrl', () => {
    assert.equal(formatAccel('<Primary>a'), 'Ctrl+A');
    assert.equal(formatAccel('<Ctrl>a'), 'Ctrl+A');
});

test('formatAccel degrades gracefully on empty or odd input', () => {
    assert.equal(formatAccel(''), '');
    assert.equal(formatAccel(undefined), '');
    assert.equal(formatAccel('not-an-accel'), 'not-an-accel'); // unmapped remainder passes through
    assert.equal(formatAccel('<Hyper>z'), 'Z');                // unknown modifier dropped, never throws
    assert.equal(formatAccel('<Super>'), 'Super');             // modifier-only accel
});
