// dragsnap.js — DragSnapManager (spec 3.6/4.4): grab-op tracking, 60 Hz
// pointer polling during a move grab, zone preview, drop handling, and
// native edge-tiling suppression with crash-safe restore.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    resolveZone, zoneRect, rectsEqual,
    pickPairSide, pairRects, insetFraction, rectContains,
    matchSnappedRect, splitFootprint,
} from './geometry.js';
import { ZonePreview } from './preview.js';

const POLL_INTERVAL_MS = 16; // ~60 Hz; the source exists only during a drag
const PAIR_CENTRAL_INSET = 0.25; // pair-tile hit region: central 50% × 50%

const MODIFIER_MASKS = {
    ctrl: Clutter.ModifierType.CONTROL_MASK,
    alt: Clutter.ModifierType.MOD1_MASK,
    shift: Clutter.ModifierType.SHIFT_MASK,
    super: Clutter.ModifierType.MOD4_MASK,
};

export class DragSnapManager {
    constructor(settings, dispatcher, mover) {
        this._settings = settings;
        this._dispatcher = dispatcher;
        this._mover = mover;
        this._preview = null;
        this._mutterSettings = null;
        this._grabBeginId = 0;
        this._grabEndId = 0;
        this._modeChangedId = 0;
        this._pollId = 0;
        this._window = null;
        this._startFrame = null;
        this._zone = null;
        this._pair = null;
        this._zoneWorkArea = null;
        this._zoneKey = null;
    }

    enable() {
        this._preview = new ZonePreview();
        this._grabBeginId = global.display.connect('grab-op-begin',
            (_display, window, op) => this._onGrabBegin(window, op));
        this._grabEndId = global.display.connect('grab-op-end',
            (_display, window, op) => this._onGrabEnd(window, op));
        this._modeChangedId = this._settings.connect('changed::drag-snap-mode',
            () => this._syncEdgeTiling());
        this._syncEdgeTiling();
    }

    destroy() {
        this._stopTracking();
        if (this._grabBeginId) {
            global.display.disconnect(this._grabBeginId);
            this._grabBeginId = 0;
        }
        if (this._grabEndId) {
            global.display.disconnect(this._grabEndId);
            this._grabEndId = 0;
        }
        if (this._modeChangedId) {
            this._settings.disconnect(this._modeChangedId);
            this._modeChangedId = 0;
        }
        this._restoreEdgeTiling();
        this._preview?.destroy();
        this._preview = null;
        this._mutterSettings = null;
    }

    // --- Native edge-tiling suppression (spec 3.6/4.4) ---

    _mutter() {
        if (!this._mutterSettings)
            this._mutterSettings = new Gio.Settings({ schema_id: 'org.gnome.mutter' });
        return this._mutterSettings;
    }

    _syncEdgeTiling() {
        if (this._settings.get_string('drag-snap-mode') === 'replace')
            this._suppressEdgeTiling();
        else
            this._restoreEdgeTiling();
    }

    _suppressEdgeTiling() {
        const mutter = this._mutter();
        if (!this._settings.get_boolean('edge-tiling-suppressed')) {
            // First suppression: remember the user's value. If the shell
            // crashed while suppressed, the flag is still set and the saved
            // value is still the user's original — do NOT overwrite it with
            // our own `false` (spec §7 crash-recovery risk).
            this._settings.set_boolean('saved-edge-tiling',
                mutter.get_boolean('edge-tiling'));
            this._settings.set_boolean('edge-tiling-suppressed', true);
        }
        mutter.set_boolean('edge-tiling', false);
    }

    _restoreEdgeTiling() {
        if (!this._settings.get_boolean('edge-tiling-suppressed'))
            return;
        this._mutter().set_boolean('edge-tiling',
            this._settings.get_boolean('saved-edge-tiling'));
        this._settings.set_boolean('edge-tiling-suppressed', false);
    }

    // --- Grab lifecycle (spec 4.4) ---

    _onGrabBegin(window, op) {
        if (op !== Meta.GrabOp.MOVING)
            return; // ignore resizes and keyboard ops
        if (this._settings.get_string('drag-snap-mode') === 'off')
            return;
        if (!window || window.get_window_type() !== Meta.WindowType.NORMAL)
            return;
        this._stopTracking(); // defensive: never leak a stale poll source
        this._window = window;
        this._startFrame = this._mover.frameRect(window);
        // Poll the pointer: position-changed under-fires for zone purposes
        // (the pointer, not the frame, defines the zone) and pointer motion
        // events aren't deliverable to us during a compositor grab.
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_INTERVAL_MS,
            () => {
                this._poll();
                return GLib.SOURCE_CONTINUE;
            });
    }

    _onGrabEnd(window, op) {
        if (op !== Meta.GrabOp.MOVING || window !== this._window)
            return;
        const zone = this._zone;
        const pair = this._pair;
        const workArea = this._zoneWorkArea;
        const startFrame = this._startFrame;
        this._stopTracking();
        if ((!zone && !pair) || !workArea)
            return;
        // Esc-cancel heuristic: grab-op-end doesn't report cancellation,
        // but Mutter restores the pre-grab frame on cancel. If the frame is
        // back at its starting geometry, treat it as cancelled.
        if (startFrame && rectsEqual(this._mover.frameRect(window), startFrame, 1))
            return;
        if (zone)
            this._dispatcher.applyZone(window, zone, workArea);
        else
            this._dispatcher.applyPairRects(window, pair.window, pair.rects.a, pair.rects.b);
    }

    _stopTracking() {
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
        this._window = null;
        this._startFrame = null;
        this._zone = null;
        this._pair = null;
        this._zoneWorkArea = null;
        this._zoneKey = null;
        this._preview?.hide();
    }

    _poll() {
        if (!this._window)
            return;
        const [x, y, mods] = global.get_pointer();
        const mode = this._settings.get_string('drag-snap-mode');
        const modifierName = this._settings.get_string('drag-snap-modifier');
        const mask = MODIFIER_MASKS[modifierName] ?? MODIFIER_MASKS.ctrl;
        const modifierHeld = (mods & mask) !== 0;
        const gaps = {
            outer: this._settings.get_int('outer-gap'),
            inner: this._settings.get_int('inner-gap'),
        };

        let zone = null;
        let pair = null;
        let workArea = null;
        // Modifier-only mode: zones and pair-tiling exist only while the
        // modifier is held (zero-conflict with native tiling); the modifier
        // is then the activation key, so variant sizes are unavailable.
        if (mode !== 'modifier' || modifierHeld) {
            const monitor = Main.layoutManager.monitors.find(m =>
                x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height);
            if (monitor) {
                const area = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
                workArea = { x: area.x, y: area.y, width: area.width, height: area.height };
                zone = resolveZone(x, y, workArea, {
                    bandPx: this._settings.get_int('edge-band-px'),
                    variant: mode !== 'modifier' && modifierHeld,
                });
                // Zones take precedence; pair-tiling only where no zone hit.
                if (!zone)
                    pair = this._findPair(x, y, monitor.index, modifierHeld, mode, workArea, gaps);
            }
        }

        const rectKey = r => `${r.x},${r.y},${r.width},${r.height}`;
        const key = zone && workArea
            ? `${zone.action}:${zone.cycleIndex}:${workArea.x}:${workArea.y}:${workArea.width}:${workArea.height}`
            : pair && workArea
                ? `pair:${pair.window.get_id()}:${rectKey(pair.rects.a)}:${rectKey(pair.rects.b)}`
                : null;
        if (key === this._zoneKey)
            return;
        this._zoneKey = key;
        this._zone = zone;
        this._pair = pair;
        this._zoneWorkArea = workArea;

        if (!zone && !pair) {
            this._preview?.hide();
            return;
        }
        if (!this._settings.get_boolean('show-preview'))
            return;
        if (zone)
            this._preview?.showAt(zoneRect(zone, workArea, gaps));
        else
            this._preview?.showPair(pair.rects.a, pair.rects.b);
        const actor = this._window.get_compositor_private();
        if (actor)
            this._preview?.keepBelow(actor);
    }

    // Pair gating (pair spec §4) + target lookup + rect computation
    // (footprint-split spec). Returns { window, rects: {a, b} } or null;
    // `a` is the dragged window's rect. Rects are computed here, once per
    // change, so the preview and the drop are guaranteed identical.
    _findPair(x, y, monitorIndex, modifierHeld, mode, workArea, gaps) {
        const pairMode = this._settings.get_string('pair-tile-mode');
        if (pairMode === 'off')
            return null;
        if (pairMode === 'modifier' && !modifierHeld)
            return null;
        if (!this._window.allows_resize() &&
            !(this._window.maximized_horizontally || this._window.maximized_vertically))
            return null;
        const target = this._findPairTarget(x, y, monitorIndex);
        if (!target)
            return null;
        // The modifier means "variant sizes" only when it is not already
        // spoken for as an activation key (pair spec §4 table).
        const variant = modifierHeld && pairMode === 'always' && mode !== 'modifier';
        // Footprint split (spec §2): B's own fresh tracking first (any
        // rect we placed counts), else the stateless geometric match;
        // maximized B never has a footprint. No footprint → whole-area
        // halves, exactly as before.
        let footprint = null;
        if (!(target.window.maximized_horizontally || target.window.maximized_vertically)) {
            footprint = this._dispatcher.trackedRect(target.window, target.frame) ??
                matchSnappedRect(target.frame, workArea, gaps);
        }
        if (footprint) {
            return {
                window: target.window,
                rects: splitFootprint(footprint, x, y, variant, gaps.inner),
            };
        }
        const side = pickPairSide(x, target.frame);
        return {
            window: target.window,
            rects: pairRects(workArea, side, variant, gaps),
        };
    }

    // The visible window under the pointer decides: pair with it if the
    // pointer is in its central region and it is eligible — otherwise no
    // pair at all. Windows beneath the one the user sees are never
    // targets (pair-tile spec §2).
    _findPairTarget(x, y, monitorIndex) {
        const windows = global.display.sort_windows_by_stacking(
            global.workspace_manager.get_active_workspace().list_windows());
        for (let i = windows.length - 1; i >= 0; i--) {
            const win = windows[i];
            if (win === this._window || win.minimized)
                continue;
            if (win.get_window_type() !== Meta.WindowType.NORMAL)
                continue;
            const r = win.get_frame_rect();
            const frame = { x: r.x, y: r.y, width: r.width, height: r.height };
            if (!rectContains(frame, x, y))
                continue;
            if (win.is_fullscreen() || win.get_monitor() !== monitorIndex)
                return null;
            // Maximized counts as pair-eligible (pair spec §2) even though
            // Mutter reports allows_resize() === false for it.
            if (!win.allows_resize() &&
                !(win.maximized_horizontally || win.maximized_vertically))
                return null;
            if (!rectContains(
                insetFraction(frame, PAIR_CENTRAL_INSET, PAIR_CENTRAL_INSET), x, y))
                return null;
            return { window: win, frame };
        }
        return null;
    }
}
