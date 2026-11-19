/**
 * The settle-up map's layout: everyone in a group as a node, each payment as a curved arrow with
 * its amount, spread by a small force simulation (people push apart, payments pull together, a
 * gentle pull keeps the cluster centred). Pure numbers, so the website's map
 * (src/components/features/SettlementGraph.tsx) and the phone app's draw it the same way.
 * Tested in tests/unit/settleMap.test.ts.
 */

export interface MapPayment {
    from: string;
    to: string;
    amount: number;
}

export interface NodeState {
    x: number;
    y: number;
    vx: number;
    vy: number;
    fx: number | null;
    fy: number | null;
    name: string;
}

export interface LayoutBounds {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

interface EdgeLayout {
    settlement: MapPayment;
    gradientId: string;
    routePathId: string;
    sx: number;
    sy: number;
    ex: number;
    ey: number;
    cpx: number;
    cpy: number;
    pillX: number;
    pillY: number;
}

export function getLayoutBounds(compact: boolean, width: number): LayoutBounds {
    const narrow = width <= 390;

    if (compact) {
        return narrow
            ? { top: 50, right: 82, bottom: 116, left: 56 }
            : { top: 46, right: 74, bottom: 104, left: 52 };
    }

    return narrow
        ? { top: 58, right: 82, bottom: 108, left: 60 }
        : { top: 54, right: 76, bottom: 100, left: 56 };
}

export function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

export function buildEdgeLayouts(params: {
    settlements: MapPayment[];
    members: string[];
    nodes: NodeState[];
    bounds: LayoutBounds;
    width: number;
    height: number;
    instanceId: string;
    compact: boolean;
}) {
    const layouts: EdgeLayout[] = [];
    const pillMinX = params.bounds.left + 40;
    const pillMaxX = params.width - params.bounds.right - 40;
    const pillMinY = params.bounds.top + 18;
    const pillMaxY = params.height - params.bounds.bottom - 18;

    for (let index = 0; index < params.settlements.length; index++) {
        const settlement = params.settlements[index];
        const fromIdx = params.members.indexOf(settlement.from);
        const toIdx = params.members.indexOf(settlement.to);
        if (fromIdx === -1 || toIdx === -1) continue;

        const fromNode = params.nodes[fromIdx];
        const toNode = params.nodes[toIdx];
        if (!fromNode || !toNode) continue;

        const dx = toNode.x - fromNode.x;
        const dy = toNode.y - fromNode.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nodeRadius = 34;

        const sx = fromNode.x + (dx / len) * nodeRadius;
        const sy = fromNode.y + (dy / len) * nodeRadius;
        const ex = toNode.x - (dx / len) * (nodeRadius + 8);
        const ey = toNode.y - (dy / len) * (nodeRadius + 8);

        const mx = (sx + ex) / 2;
        const my = (sy + ey) / 2;
        const nx = -(dy / len);
        const ny = dx / len;
        const bow = 24 + (index % 3) * 10;
        const dir = index % 2 === 0 ? 1 : -1;
        const cpx = mx + nx * bow * dir;
        const cpy = my + ny * bow * dir;

        const tx = 0.25 * sx + 0.5 * cpx + 0.25 * ex;
        const ty = 0.25 * sy + 0.5 * cpy + 0.25 * ey;
        const pillX = tx + nx * (params.compact ? 8 : 10) * dir;
        let pillY = ty - (params.compact ? 20 : 24);

        const distanceFromSource = Math.hypot(pillX - fromNode.x, pillY - fromNode.y);
        const distanceFromTarget = Math.hypot(pillX - toNode.x, pillY - toNode.y);
        const nearestNodeDistance = Math.min(distanceFromSource, distanceFromTarget);

        if (nearestNodeDistance < 82) {
            pillY -= 14;
        }

        layouts.push({
            settlement,
            gradientId: `edge-gradient-${params.instanceId}-${index}`,
            routePathId: `edge-route-${params.instanceId}-${index}`,
            sx,
            sy,
            ex,
            ey,
            cpx,
            cpy,
            pillX: clamp(pillX, pillMinX, pillMaxX),
            pillY: clamp(pillY, pillMinY, pillMaxY),
        });
    }

    return layouts;
}

/**
 * The compact map (phones) starts everyone on a circle. The full map (desktop) has a wide
 * canvas, so it starts them on an ellipse that fills it and lets the forces spread them
 * further (see simulate), instead of bunching four people in the middle.
 */
export function initNodes(members: string[], w: number, h: number, bounds: LayoutBounds, compact: boolean): NodeState[] {
    const usableW = Math.max(120, w - bounds.left - bounds.right);
    const usableH = Math.max(120, h - bounds.top - bounds.bottom);
    const cx = bounds.left + usableW / 2;
    const cy = bounds.top + usableH / 2;
    const r = Math.min(usableW, usableH) * (members.length <= 3 ? 0.24 : 0.3);
    const share = members.length <= 3 ? 0.3 : 0.38;
    const rx = compact ? r : usableW * share;
    const ry = compact ? r : usableH * share;

    return members.map((name, i) => {
        const angle = (2 * Math.PI * i) / Math.max(members.length, 1) - Math.PI / 2;
        return {
            x: cx + rx * Math.cos(angle),
            y: cy + ry * Math.sin(angle),
            vx: 0,
            vy: 0,
            fx: null,
            fy: null,
            name,
        };
    });
}

export function simulate(
    nodes: NodeState[],
    edges: { source: number; target: number }[],
    w: number,
    h: number,
    bounds: LayoutBounds,
    compact: boolean,
) {
    const usableW = Math.max(120, w - bounds.left - bounds.right);
    const usableH = Math.max(120, h - bounds.top - bounds.bottom);
    const cx = bounds.left + usableW / 2;
    const cy = bounds.top + usableH / 2;
    const repulsion = compact ? 8400 : 16000;
    const springK = 0.014;
    const idealLen = (compact ? Math.min(usableW, usableH) : (usableW + usableH) / 2) * 0.62;
    const centerPull = 0.0022;
    const damping = 0.76;

    for (const node of nodes) {
        if (node.fx !== null) {
            node.x = node.fx;
            node.y = node.fy ?? node.y;
            node.vx = 0;
            node.vy = 0;
        }
    }

    for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].fx !== null) continue;
        for (let j = i + 1; j < nodes.length; j++) {
            const dx = nodes[j].x - nodes[i].x;
            const dy = nodes[j].y - nodes[i].y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = repulsion / (dist * dist);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            if (nodes[i].fx === null) {
                nodes[i].vx -= fx;
                nodes[i].vy -= fy;
            }
            if (nodes[j].fx === null) {
                nodes[j].vx += fx;
                nodes[j].vy += fy;
            }
        }
    }

    for (const edge of edges) {
        const a = nodes[edge.source];
        const b = nodes[edge.target];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const displacement = dist - idealLen;
        const force = springK * displacement;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (a.fx === null) {
            a.vx += fx;
            a.vy += fy;
        }
        if (b.fx === null) {
            b.vx -= fx;
            b.vy -= fy;
        }
    }

    for (const node of nodes) {
        if (node.fx !== null) continue;
        node.vx += (cx - node.x) * centerPull;
        node.vy += (cy - node.y) * centerPull;
    }

    for (const node of nodes) {
        if (node.fx !== null) continue;
        node.vx *= damping;
        node.vy *= damping;
        node.x += node.vx;
        node.y += node.vy;
        node.x = clamp(node.x, bounds.left, w - bounds.right);
        node.y = clamp(node.y, bounds.top, h - bounds.bottom);
    }

    // Centroid correction — shift entire cluster so its center-of-mass
    // stays at the geometric center of the usable area every tick
    const freeNodes = nodes.filter((n) => n.fx === null);
    if (freeNodes.length > 0) {
        const centX = freeNodes.reduce((s, n) => s + n.x, 0) / freeNodes.length;
        const centY = freeNodes.reduce((s, n) => s + n.y, 0) / freeNodes.length;
        const shiftX = (cx - centX) * 0.12;
        const shiftY = (cy - centY) * 0.12;
        for (const node of freeNodes) {
            node.x = clamp(node.x + shiftX, bounds.left, w - bounds.right);
            node.y = clamp(node.y + shiftY, bounds.top, h - bounds.bottom);
        }
    }
}

/** How many steps the map takes to come to rest (the website animates them, one a frame). */
export const REST_STEPS = 320;

/**
 * Where everyone ends up once the map has come to rest, worked out at once: for a screen that
 * shows the settled map rather than animating each step. `margins` replaces the website's, which
 * leave room for its own overlays.
 */
export function restingLayout(members: string[], payments: MapPayment[], width: number, height: number, compact: boolean, margins?: LayoutBounds) {
    const bounds = margins ?? getLayoutBounds(compact, width);
    const nodes = initNodes(members, width, height, bounds, compact);
    const edges = payments
        .map((payment) => ({ source: members.indexOf(payment.from), target: members.indexOf(payment.to) }))
        .filter((edge) => edge.source !== -1 && edge.target !== -1);
    for (let step = 0; step < REST_STEPS; step++) simulate(nodes, edges, width, height, bounds, compact);
    const arrows = buildEdgeLayouts({ settlements: payments, members, nodes, bounds, width, height, instanceId: 'rest', compact });
    return { bounds, nodes, arrows };
}

export interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.width / 2, b.x + b.width / 2) - Math.max(a.x - a.width / 2, b.x - b.width / 2)) * Math.max(0, Math.min(a.y + a.height / 2, b.y + b.height / 2) - Math.max(a.y - a.height / 2, b.y - b.height / 2));

/**
 * Moves the amounts' labels (boxes by their centres) off each other and off the people, a little
 * at a time, and keeps them inside the map. On a phone's narrow map, the website's placement can
 * put two amounts on top of each other. Returns new centres, in the same order.
 */
export function spreadLabels(labels: Box[], people: Box[], area: { width: number; height: number }, rounds = 60): { x: number; y: number }[] {
    const placed = labels.map((label) => ({ ...label }));
    const keepInside = (box: Box) => {
        box.x = clamp(box.x, box.width / 2 + 2, area.width - box.width / 2 - 2);
        box.y = clamp(box.y, box.height / 2 + 2, area.height - box.height / 2 - 2);
    };
    for (let round = 0; round < rounds; round++) {
        let moved = false;
        for (let i = 0; i < placed.length; i++) {
            const a = placed[i];
            for (let j = i + 1; j < placed.length; j++) {
                const b = placed[j];
                if (overlap(a, b) === 0) continue;
                // Apart along the shorter way out: usually up and down, as labels are wide.
                const needY = (a.height + b.height) / 2 - Math.abs(a.y - b.y);
                const needX = (a.width + b.width) / 2 - Math.abs(a.x - b.x);
                if (needY <= needX) {
                    const dir = a.y <= b.y ? -1 : 1;
                    a.y += (dir * (needY + 1)) / 2;
                    b.y -= (dir * (needY + 1)) / 2;
                } else {
                    const dir = a.x <= b.x ? -1 : 1;
                    a.x += (dir * (needX + 1)) / 2;
                    b.x -= (dir * (needX + 1)) / 2;
                }
                moved = true;
            }
            for (const person of people) {
                if (overlap(a, person) === 0) continue;
                const needY = (a.height + person.height) / 2 - Math.abs(a.y - person.y);
                const needX = (a.width + person.width) / 2 - Math.abs(a.x - person.x);
                if (needY <= needX) a.y += (a.y <= person.y ? -1 : 1) * (needY + 1);
                else a.x += (a.x <= person.x ? -1 : 1) * (needX + 1);
                moved = true;
            }
            keepInside(a);
        }
        if (!moved) break;
    }
    return placed.map(({ x, y }) => ({ x, y }));
}
