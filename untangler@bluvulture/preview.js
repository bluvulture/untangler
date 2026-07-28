// SPDX-License-Identifier: GPL-2.0-or-later
// preview.js — translucent zone preview overlay, plus a dimmer secondary
// rect for pair-tiling.
import Clutter from 'gi://Clutter';
import St from 'gi://St';

const ANIMATION_MS = 120;

export class ZonePreview {
    constructor() {
        // Secondary is added first so it stacks below the primary; both sit
        // under the dragged window's actor (keepBelow() raises the actor
        // above the primary, which is above the secondary).
        this._secondary = new St.Widget({
            style_class: 'untangler-zone-preview untangler-zone-preview-dim',
            visible: false,
        });
        global.window_group.add_child(this._secondary);
        this._widget = new St.Widget({
            style_class: 'untangler-zone-preview',
            visible: false,
        });
        global.window_group.add_child(this._widget);
    }

    showAt(rect) {
        this._hideWidget(this._secondary);
        this._showWidget(this._widget, rect);
    }

    // Pair-tile preview: the dragged window's destination in the normal
    // style, the target window's destination dimmed.
    showPair(aRect, bRect) {
        this._showWidget(this._widget, aRect);
        this._showWidget(this._secondary, bRect);
    }

    keepBelow(windowActor) {
        if (windowActor && windowActor.get_parent() === this._widget.get_parent())
            global.window_group.set_child_above_sibling(windowActor, this._widget);
    }

    hide() {
        this._hideWidget(this._widget);
        this._hideWidget(this._secondary);
    }

    destroy() {
        // EGO requirement: actors must not outlive disable().
        this._widget.destroy();
        this._widget = null;
        this._secondary.destroy();
        this._secondary = null;
    }

    _showWidget(widget, rect) {
        if (!widget.visible) {
            // First appearance: jump into place and fade in.
            widget.set_position(rect.x, rect.y);
            widget.set_size(rect.width, rect.height);
            widget.opacity = 0;
            widget.show();
            widget.ease({
                opacity: 255,
                duration: ANIMATION_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            return;
        }
        // Target change: glide to the new rect.
        widget.ease({
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            duration: ANIMATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _hideWidget(widget) {
        widget.remove_all_transitions();
        widget.hide();
    }
}
