// preview.js — translucent zone preview overlay (spec 3.6/4.4).
import Clutter from 'gi://Clutter';
import St from 'gi://St';

const ANIMATION_MS = 120;

export class ZonePreview {
    constructor() {
        this._widget = new St.Widget({
            style_class: 'untangler-zone-preview',
            visible: false,
        });
        // In window_group so it sits under the dragged window's actor
        // (which keepBelow() then raises above us).
        global.window_group.add_child(this._widget);
    }

    showAt(rect) {
        if (!this._widget)
            return;
        if (!this._widget.visible) {
            // First appearance: jump into place and fade in.
            this._widget.set_position(rect.x, rect.y);
            this._widget.set_size(rect.width, rect.height);
            this._widget.opacity = 0;
            this._widget.show();
            this._widget.ease({
                opacity: 255,
                duration: ANIMATION_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            return;
        }
        // Zone change: glide to the new rect (the Rectangle "fluid" feel).
        this._widget.ease({
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            duration: ANIMATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    keepBelow(windowActor) {
        if (this._widget && windowActor &&
            windowActor.get_parent() === this._widget.get_parent())
            global.window_group.set_child_above_sibling(windowActor, this._widget);
    }

    hide() {
        if (this._widget) {
            this._widget.remove_all_transitions();
            this._widget.hide();
        }
    }

    destroy() {
        // EGO requirement: actor must not outlive disable().
        this._widget?.destroy();
        this._widget = null;
    }
}
