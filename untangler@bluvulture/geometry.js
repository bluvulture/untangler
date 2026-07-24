// SPDX-License-Identifier: GPL-2.0-or-later
// geometry.js — GeometryEngine: pure functions only (spec §2 key principle).
// MUST NOT import from gi:// or resource:/// — this file runs under plain
// Node for unit tests and is the extension's Shell-API-free core.

export const Action = Object.freeze({
    LEFT_HALF: 'left-half',
    RIGHT_HALF: 'right-half',
    TOP_HALF: 'top-half',
    BOTTOM_HALF: 'bottom-half',
    TOP_LEFT_QUARTER: 'top-left-quarter',
    TOP_RIGHT_QUARTER: 'top-right-quarter',
    BOTTOM_LEFT_QUARTER: 'bottom-left-quarter',
    BOTTOM_RIGHT_QUARTER: 'bottom-right-quarter',
    FIRST_THIRD: 'first-third',
    CENTER_THIRD: 'center-third',
    LAST_THIRD: 'last-third',
    MAXIMIZE: 'maximize',
    ALMOST_MAXIMIZE: 'almost-maximize',
    CENTER: 'center',
    RESTORE: 'restore',
    NEXT_DISPLAY: 'next-display',
    PREV_DISPLAY: 'prev-display',
});

export const NO_GAPS = Object.freeze({ outer: 0, inner: 0 });

// [startFraction, endFraction] spans per cycle step (spec 3.1):
// halves cycle 1/2 → 2/3 → 1/3 anchored to their edge; quarters 1/4 → 1/6
// (the 1/6 variant is a third along the long axis × half along the short).
const LEAD_HALF = [[0, 1 / 2], [0, 2 / 3], [0, 1 / 3]];
const TRAIL_HALF = [[1 / 2, 1], [1 / 3, 1], [2 / 3, 1]];
const LEAD_QUARTER = [[0, 1 / 2], [0, 1 / 3]];
const TRAIL_QUARTER = [[1 / 2, 1], [2 / 3, 1]];
const FULL = [[0, 1]];
const TOP = [[0, 1 / 2]];
const BOTTOM = [[1 / 2, 1]];

const SPANS = {
    [Action.LEFT_HALF]: { h: LEAD_HALF, v: FULL },
    [Action.RIGHT_HALF]: { h: TRAIL_HALF, v: FULL },
    [Action.TOP_HALF]: { h: FULL, v: LEAD_HALF },
    [Action.BOTTOM_HALF]: { h: FULL, v: TRAIL_HALF },
    [Action.TOP_LEFT_QUARTER]: { h: LEAD_QUARTER, v: TOP },
    [Action.TOP_RIGHT_QUARTER]: { h: TRAIL_QUARTER, v: TOP },
    [Action.BOTTOM_LEFT_QUARTER]: { h: LEAD_QUARTER, v: BOTTOM },
    [Action.BOTTOM_RIGHT_QUARTER]: { h: TRAIL_QUARTER, v: BOTTOM },
    [Action.FIRST_THIRD]: { h: [[0, 1 / 3]], v: FULL },
    [Action.CENTER_THIRD]: { h: [[1 / 3, 2 / 3]], v: FULL },
    [Action.LAST_THIRD]: { h: [[2 / 3, 1]], v: FULL },
};

export function cycleLength(action) {
    const spans = SPANS[action];
    if (!spans)
        return 1;
    return Math.max(spans.h.length, spans.v.length);
}

export function rectForAction(workArea, action, cycleIndex = 0, gaps = NO_GAPS) {
    if (action === Action.ALMOST_MAXIMIZE)
        return almostMaximize(workArea, gaps);
    const spans = SPANS[action];
    if (!spans)
        throw new Error(`Action "${action}" has no geometry`);
    const h = spans.h[cycleIndex % spans.h.length];
    const v = spans.v[cycleIndex % spans.v.length];
    const inner = insetAll(workArea, gaps.outer);
    const hs = span(inner.x, inner.width, h[0], h[1], gaps.inner);
    const vs = span(inner.y, inner.height, v[0], v[1], gaps.inner);
    return { x: hs.pos, y: vs.pos, width: hs.size, height: vs.size };
}

export function centerRect(workArea, windowRect, gaps = NO_GAPS) {
    const inner = insetAll(workArea, gaps.outer);
    return {
        x: inner.x + Math.round((inner.width - windowRect.width) / 2),
        y: inner.y + Math.round((inner.height - windowRect.height) / 2),
        width: windowRect.width,
        height: windowRect.height,
    };
}

// Spec 3.4: express `rect` as fractions of `from`, reapply on `to`.
export function mapRectToWorkArea(rect, from, to) {
    return {
        x: to.x + Math.round(((rect.x - from.x) / from.width) * to.width),
        y: to.y + Math.round(((rect.y - from.y) / from.height) * to.height),
        width: Math.round((rect.width / from.width) * to.width),
        height: Math.round((rect.height / from.height) * to.height),
    };
}

// Spec 3.7: if the app clamped our resize (min size), center the actual
// size inside the target rect instead of leaving it misaligned.
export function recenterWithin(target, actualWidth, actualHeight) {
    return {
        x: target.x + Math.round((target.width - actualWidth) / 2),
        y: target.y + Math.round((target.height - actualHeight) / 2),
        width: actualWidth,
        height: actualHeight,
    };
}

export function rectsEqual(a, b, tolerance = 0) {
    return Math.abs(a.x - b.x) <= tolerance &&
        Math.abs(a.y - b.y) <= tolerance &&
        Math.abs(a.width - b.width) <= tolerance &&
        Math.abs(a.height - b.height) <= tolerance;
}

function insetAll(rect, amount) {
    return {
        x: rect.x + amount,
        y: rect.y + amount,
        width: rect.width - 2 * amount,
        height: rect.height - 2 * amount,
    };
}

// 1-D slice of [origin, origin+size] between fractions. Edges shared with a
// neighbouring slice (fraction not 0/1) are inset by half the inner gap —
// ceil on the leading edge, floor on the trailing edge, so two adjacent
// slices end up exactly `innerGap` px apart and boundaries computed from the
// same fraction always agree (no 1 px overlap on odd sizes).
function span(origin, size, startFrac, endFrac, innerGap) {
    const start = origin + Math.round(size * startFrac) +
        (startFrac > 0 ? Math.ceil(innerGap / 2) : 0);
    const end = origin + Math.round(size * endFrac) -
        (endFrac < 1 ? Math.floor(innerGap / 2) : 0);
    return { pos: start, size: end - start };
}

function almostMaximize(workArea, gaps) {
    const inner = insetAll(workArea, gaps.outer);
    const width = Math.round(inner.width * 0.9);
    const height = Math.round(inner.height * 0.9);
    return {
        x: inner.x + Math.round((inner.width - width) / 2),
        y: inner.y + Math.round((inner.height - height) / 2),
        width,
        height,
    };
}

// --- Drag snap zones (spec 3.6) ---
// Pure: pointer position + work area → { action, cycleIndex } | null.
// `variant` = the two-thirds/thirds modifier is held; it bumps halves and
// quarters to cycle step 1 (two-thirds / sixth). Precedence: corners, then
// top edge, then left/right edges, then bottom edge.
export function resolveZone(pointerX, pointerY, workArea, options = {}) {
    const { bandPx = 16, cornerPx = 24, variant = false } = options;
    const wa = workArea;
    // Clamp so pointers over panels/struts (outside the work area) still
    // hit the nearest edge band.
    const px = clamp(pointerX, wa.x, wa.x + wa.width - 1);
    const py = clamp(pointerY, wa.y, wa.y + wa.height - 1);
    const variantIndex = variant ? 1 : 0;

    const inLeftCorner = px < wa.x + cornerPx;
    const inRightCorner = px >= wa.x + wa.width - cornerPx;
    const inTopCorner = py < wa.y + cornerPx;
    const inBottomCorner = py >= wa.y + wa.height - cornerPx;
    if (inTopCorner && inLeftCorner)
        return { action: Action.TOP_LEFT_QUARTER, cycleIndex: variantIndex };
    if (inTopCorner && inRightCorner)
        return { action: Action.TOP_RIGHT_QUARTER, cycleIndex: variantIndex };
    if (inBottomCorner && inLeftCorner)
        return { action: Action.BOTTOM_LEFT_QUARTER, cycleIndex: variantIndex };
    if (inBottomCorner && inRightCorner)
        return { action: Action.BOTTOM_RIGHT_QUARTER, cycleIndex: variantIndex };

    const nearLeft = px < wa.x + bandPx;
    const nearRight = px >= wa.x + wa.width - bandPx;
    const nearTop = py < wa.y + bandPx;
    const nearBottom = py >= wa.y + wa.height - bandPx;

    if (nearTop) {
        // Top edge, centre 50 % → maximize (native-compatible).
        if (px >= wa.x + wa.width * 0.25 && px < wa.x + wa.width * 0.75)
            return { action: Action.MAXIMIZE, cycleIndex: 0 };
        return null;
    }

    if (nearLeft || nearRight) {
        const heightFrac = (py - wa.y) / wa.height;
        if (heightFrac < 0.25) {
            return {
                action: nearLeft ? Action.TOP_LEFT_QUARTER : Action.TOP_RIGHT_QUARTER,
                cycleIndex: variantIndex,
            };
        }
        if (heightFrac >= 0.75) {
            return {
                action: nearLeft ? Action.BOTTOM_LEFT_QUARTER : Action.BOTTOM_RIGHT_QUARTER,
                cycleIndex: variantIndex,
            };
        }
        return {
            action: nearLeft ? Action.LEFT_HALF : Action.RIGHT_HALF,
            cycleIndex: variantIndex,
        };
    }

    if (nearBottom) {
        const widthFrac = (px - wa.x) / wa.width;
        if (widthFrac < 1 / 3)
            return { action: Action.FIRST_THIRD, cycleIndex: 0 };
        if (widthFrac < 2 / 3)
            return { action: Action.CENTER_THIRD, cycleIndex: 0 };
        return { action: Action.LAST_THIRD, cycleIndex: 0 };
    }

    return null;
}

// The rect a zone previews and applies. Maximize is performed via Meta's
// own maximize (spec 3.1), so its preview is simply the whole work area.
export function zoneRect(zone, workArea, gaps = NO_GAPS) {
    if (zone.action === Action.MAXIMIZE) {
        return {
            x: workArea.x, y: workArea.y,
            width: workArea.width, height: workArea.height,
        };
    }
    return rectForAction(workArea, zone.action, zone.cycleIndex, gaps);
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

// --- Pair tiling: drop one window onto another to tile them side by side ---

// Which side the dragged window takes: 'left' iff the pointer is left of
// the target frame's horizontal center ('right' on the exact center).
export function pickPairSide(pointerX, targetFrame) {
    return pointerX < targetFrame.x + targetFrame.width / 2 ? 'left' : 'right';
}

// The two rects for a pair-tile drop (spec §3). `side` is where the
// dragged window (a) goes. With `variant` (modifier held), a takes
// two-thirds and b the remaining third — cycle indices 1 and 2 of the
// half tables complement exactly, so the pair tiles like keyboard snaps.
export function pairRects(workArea, side, variant, gaps = NO_GAPS) {
    const aAction = side === 'left' ? Action.LEFT_HALF : Action.RIGHT_HALF;
    const bAction = side === 'left' ? Action.RIGHT_HALF : Action.LEFT_HALF;
    return {
        a: rectForAction(workArea, aAction, variant ? 1 : 0, gaps),
        b: rectForAction(workArea, bAction, variant ? 2 : 0, gaps),
    };
}

// `rect` inset by the given fraction of its size on each side
// (0.25, 0.25 → the central 50% × 50%). Used for the pair-tile
// central-region hit test (spec §2).
export function insetFraction(rect, fractionX, fractionY) {
    const dx = Math.round(rect.width * fractionX);
    const dy = Math.round(rect.height * fractionY);
    return {
        x: rect.x + dx,
        y: rect.y + dy,
        width: rect.width - 2 * dx,
        height: rect.height - 2 * dy,
    };
}

// Half-open containment: [x, x+width) × [y, y+height).
export function rectContains(rect, px, py) {
    return px >= rect.x && px < rect.x + rect.width &&
        py >= rect.y && py < rect.y + rect.height;
}

// --- Footprint split: dropping onto a snapped window splits its region ---

// Actions whose rects count as a "snapped footprint" for the stateless
// geometric match. Almost-maximize and centered placements are absent on
// purpose — without live tracking they read as floating, and floating
// targets pair as whole-area halves.
const FOOTPRINT_ACTIONS = [
    Action.LEFT_HALF, Action.RIGHT_HALF, Action.TOP_HALF, Action.BOTTOM_HALF,
    Action.TOP_LEFT_QUARTER, Action.TOP_RIGHT_QUARTER,
    Action.BOTTOM_LEFT_QUARTER, Action.BOTTOM_RIGHT_QUARTER,
    Action.FIRST_THIRD, Action.CENTER_THIRD, Action.LAST_THIRD,
];

// Stateless recognition of a snapped window: does `frame` match one of
// the canonical snap rects for this work area and gap settings? Returns
// the matched canonical rect, or null.
export function matchSnappedRect(frame, workArea, gaps = NO_GAPS, tolerance = 2) {
    for (const action of FOOTPRINT_ACTIONS) {
        for (let index = 0; index < cycleLength(action); index++) {
            const rect = rectForAction(workArea, action, index, gaps);
            if (rectsEqual(frame, rect, tolerance))
                return rect;
        }
    }
    return null;
}

// Split a snapped window's footprint between the dragged window (a) and
// the target (b). Splits along the footprint's longer dimension (ties →
// left/right); `a` takes the end nearest the pointer; with `variant`, a
// gets two-thirds. The shared edge carries the inner gap with the same
// ceil/floor convention as span(), from one shared boundary — so the two
// pieces are exactly `innerGap` apart and tile the footprint.
export function splitFootprint(footprint, pointerX, pointerY, variant = false, innerGap = 0) {
    const vertical = footprint.height > footprint.width;
    const origin = vertical ? footprint.y : footprint.x;
    const size = vertical ? footprint.height : footprint.width;
    const pointer = vertical ? pointerY : pointerX;
    const leading = pointer < origin + size / 2;
    const fraction = variant ? (leading ? 2 / 3 : 1 / 3) : 1 / 2;
    const boundary = origin + Math.round(size * fraction);
    const lead = { start: origin, end: boundary - Math.floor(innerGap / 2) };
    const trail = { start: boundary + Math.ceil(innerGap / 2), end: origin + size };
    const toRect = piece => vertical
        ? { x: footprint.x, y: piece.start, width: footprint.width, height: piece.end - piece.start }
        : { x: piece.start, y: footprint.y, width: piece.end - piece.start, height: footprint.height };
    return {
        a: toRect(leading ? lead : trail),
        b: toRect(leading ? trail : lead),
    };
}
