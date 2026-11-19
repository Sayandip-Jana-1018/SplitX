import { describe, expect, it } from 'vitest';
import { buildEdgeLayouts, getLayoutBounds, initNodes, REST_STEPS, restingLayout, simulate, spreadLabels, type Box } from '@/lib/settleMap';

const PHONE = { width: 340, height: 330 };
const four = ['Asha', 'Ravi', 'Kiran', 'Meera'];
const payments = [
    { from: 'Ravi', to: 'Asha', amount: 60000 },
    { from: 'Kiran', to: 'Asha', amount: 25000 },
    { from: 'Meera', to: 'Ravi', amount: 12050 },
];

describe('the settle-up map’s layout', () => {
    it('keeps everyone inside the map’s margins, however many people there are', () => {
        for (const count of [1, 2, 3, 5, 8, 12]) {
            const members = Array.from({ length: count }, (_, i) => `Person ${i}`);
            const ring = members.slice(1).map((name, i) => ({ from: name, to: members[i], amount: 100 * (i + 1) }));
            const { bounds, nodes } = restingLayout(members, ring, PHONE.width, PHONE.height, true);
            expect(nodes).toHaveLength(count);
            for (const node of nodes) {
                expect(node.x).toBeGreaterThanOrEqual(bounds.left);
                expect(node.x).toBeLessThanOrEqual(PHONE.width - bounds.right);
                expect(node.y).toBeGreaterThanOrEqual(bounds.top);
                expect(node.y).toBeLessThanOrEqual(PHONE.height - bounds.bottom);
                expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true);
            }
        }
    });

    it('comes to rest: one more step barely moves anyone', () => {
        const { nodes } = restingLayout(four, payments, PHONE.width, PHONE.height, true);
        const before = nodes.map((node) => ({ ...node }));
        const bounds = getLayoutBounds(true, PHONE.width);
        const edges = payments.map((p) => ({ source: four.indexOf(p.from), target: four.indexOf(p.to) }));
        simulate(nodes, edges, PHONE.width, PHONE.height, bounds, true);
        for (let i = 0; i < nodes.length; i++) expect(Math.hypot(nodes[i].x - before[i].x, nodes[i].y - before[i].y)).toBeLessThan(0.5);
    });

    it('gives the same picture every time for the same group', () => {
        expect(restingLayout(four, payments, PHONE.width, PHONE.height, true)).toEqual(restingLayout(four, payments, PHONE.width, PHONE.height, true));
    });

    it('draws one arrow per payment between two people it knows, and skips the rest', () => {
        const { arrows } = restingLayout(four, [...payments, { from: 'Someone gone', to: 'Asha', amount: 500 }], PHONE.width, PHONE.height, true);
        expect(arrows.map((arrow) => arrow.settlement.amount)).toEqual([60000, 25000, 12050]);
    });

    it('starts arrows outside the payer’s circle and ends them before the receiver’s, with the amount inside the map', () => {
        const bounds = getLayoutBounds(true, PHONE.width);
        const nodes = initNodes(four, PHONE.width, PHONE.height, bounds, true);
        for (let step = 0; step < REST_STEPS; step++) simulate(nodes, [], PHONE.width, PHONE.height, bounds, true);
        const [arrow] = buildEdgeLayouts({ settlements: payments.slice(0, 1), members: four, nodes, bounds, width: PHONE.width, height: PHONE.height, instanceId: 't', compact: true });
        const ravi = nodes[1];
        const asha = nodes[0];
        expect(Math.hypot(arrow.sx - ravi.x, arrow.sy - ravi.y)).toBeCloseTo(34, 5);
        expect(Math.hypot(arrow.ex - asha.x, arrow.ey - asha.y)).toBeCloseTo(42, 5);
        expect(arrow.pillX).toBeGreaterThanOrEqual(bounds.left + 40);
        expect(arrow.pillX).toBeLessThanOrEqual(PHONE.width - bounds.right - 40);
    });

    it('takes the phone’s own margins when given', () => {
        const margins = { top: 34, right: 48, bottom: 54, left: 48 };
        const { bounds, nodes } = restingLayout(four, payments, PHONE.width, PHONE.height, true, margins);
        expect(bounds).toEqual(margins);
        for (const node of nodes) expect(node.y).toBeLessThanOrEqual(PHONE.height - 54);
    });
});

describe('the amounts’ labels', () => {
    const hits = (a: Box, b: Box) => Math.abs(a.x - b.x) < (a.width + b.width) / 2 - 0.5 && Math.abs(a.y - b.y) < (a.height + b.height) / 2 - 0.5;

    it('end up on top of no other label and no person, inside the map', () => {
        const area = { width: 300, height: 300 };
        const labels: Box[] = [
            { x: 120, y: 100, width: 84, height: 24 },
            { x: 130, y: 104, width: 84, height: 24 },
            { x: 125, y: 98, width: 84, height: 24 },
            { x: 290, y: 5, width: 84, height: 24 },
        ];
        const people: Box[] = [{ x: 150, y: 150, width: 56, height: 56 }, { x: 60, y: 90, width: 56, height: 56 }];
        const spread = spreadLabels(labels, people, area).map((c, i) => ({ ...labels[i], ...c }));
        for (let i = 0; i < spread.length; i++) {
            for (let j = i + 1; j < spread.length; j++) expect(hits(spread[i], spread[j])).toBe(false);
            for (const person of people) expect(hits(spread[i], person)).toBe(false);
            expect(spread[i].x - spread[i].width / 2).toBeGreaterThanOrEqual(0);
            expect(spread[i].x + spread[i].width / 2).toBeLessThanOrEqual(area.width);
            expect(spread[i].y - spread[i].height / 2).toBeGreaterThanOrEqual(0);
        }
    });

    it('leaves labels that already fit where they are', () => {
        const labels: Box[] = [{ x: 60, y: 40, width: 84, height: 24 }, { x: 200, y: 200, width: 84, height: 24 }];
        expect(spreadLabels(labels, [], { width: 300, height: 300 })).toEqual([{ x: 60, y: 40 }, { x: 200, y: 200 }]);
    });
});
