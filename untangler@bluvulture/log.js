// SPDX-License-Identifier: GPL-2.0-or-later
// log.js — sparse, prefixed diagnostics for failure paths only. Pure JS
// so any module may import it. Never log window titles or application
// content.

export function logWarn(message) {
    console.warn(`Untangler: ${message}`);
}

export function logError(message, error) {
    if (error !== undefined)
        console.error(`Untangler: ${message}`, error);
    else
        console.error(`Untangler: ${message}`);
}
