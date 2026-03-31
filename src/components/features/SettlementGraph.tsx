'use client';

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { formatCurrency, getAvatarColor } from '@/lib/utils';

interface Settlement {
    from: string;
    to: string;
    amount: number;
}

interface SettlementGraphProps {
    members: string[];
    settlements: Settlement[];
    memberImages?: Record<string, string | null>;
    compact?: boolean;
    instanceId?: string;
}

interface NodeState {
    x: number;
    y: number;
    vx: number;
    vy: number;
    fx: number | null;
    fy: number | null;
    name: string;
}

interface LayoutBounds {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

function getLayoutBounds(compact: boolean): LayoutBounds {
    return compact
        ? { top: 98, right: 54, bottom: 78, left: 54 }
        : { top: 116, right: 70, bottom: 88, left: 70 };
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function initNodes(members: string[], w: number, h: number, bounds: LayoutBounds): NodeState[] {
    const usableW = Math.max(120, w - bounds.left - bounds.right);
    const usableH = Math.max(120, h - bounds.top - bounds.bottom);
    const cx = bounds.left + usableW / 2;
    const cy = bounds.top + usableH / 2;
    const r = Math.min(usableW, usableH) * (members.length <= 3 ? 0.28 : 0.36);

    return members.map((name, i) => {
        const angle = (2 * Math.PI * i) / Math.max(members.length, 1) - Math.PI / 2;
        return {
            x: cx + r * Math.cos(angle),
            y: cy + r * Math.sin(angle),
            vx: 0,
            vy: 0,
            fx: null,
            fy: null,
            name,
        };
    });
}

function simulate(
    nodes: NodeState[],
    edges: { source: number; target: number }[],
    w: number,
    h: number,
    bounds: LayoutBounds,
) {
    const usableW = Math.max(120, w - bounds.left - bounds.right);
    const usableH = Math.max(120, h - bounds.top - bounds.bottom);
    const cx = bounds.left + usableW / 2;
    const cy = bounds.top + usableH / 2;
    const repulsion = 8400;
    const springK = 0.014;
    const idealLen = Math.min(usableW, usableH) * 0.62;
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
}

const hudCardStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '10px 14px',
    borderRadius: 18,
    background: 'linear-gradient(180deg, var(--bg-glass-strong), var(--bg-glass))',
    border: '1px solid rgba(var(--accent-500-rgb), 0.12)',
    boxShadow: '0 18px 40px rgba(0, 0, 0, 0.08), 0 0 30px rgba(var(--accent-500-rgb), 0.06)',
    backdropFilter: 'blur(18px)',
    WebkitBackdropFilter: 'blur(18px)',
};

export default function SettlementGraph({
    members,
    settlements,
    memberImages = {},
    compact = false,
    instanceId = 'default',
}: SettlementGraphProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ w: 360, h: compact ? 380 : 500 });
    const [nodes, setNodes] = useState<NodeState[]>([]);
    const [dragIdx, setDragIdx] = useState<number | null>(null);
    const nodesRef = useRef<NodeState[]>([]);
    const animRef = useRef<number>(0);
    const dragIdxRef = useRef<number | null>(null);
    const iterRef = useRef(0);

    const bounds = useMemo(() => getLayoutBounds(compact), [compact]);

    const edges = useMemo(
        () =>
            settlements
                .map((settlement) => ({
                    source: members.indexOf(settlement.from),
                    target: members.indexOf(settlement.to),
                }))
                .filter((edge) => edge.source !== -1 && edge.target !== -1),
        [settlements, members],
    );

    const membersKey = useMemo(() => members.join(','), [members]);
    const totalAmount = useMemo(
        () => settlements.reduce((sum, settlement) => sum + settlement.amount, 0),
        [settlements],
    );
    const connectionCounts = useMemo(() => {
        const map: Record<string, number> = {};
        for (const member of members) {
            map[member] = 0;
        }
        for (const settlement of settlements) {
            map[settlement.from] = (map[settlement.from] ?? 0) + 1;
            map[settlement.to] = (map[settlement.to] ?? 0) + 1;
        }
        return map;
    }, [members, settlements]);

    useEffect(() => {
        function onResize() {
            if (!containerRef.current) return;
            const width = containerRef.current.offsetWidth;
            const compactHeight = clamp(width * 0.92, 360, 420);
            const fullHeight = clamp(width * 0.98, 460, 560);
            setSize({ w: width, h: compact ? compactHeight : fullHeight });
        }

        onResize();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [compact]);

    const initialNodes = useMemo(() => {
        if (members.length === 0) return [];
        return initNodes(members, size.w, size.h, bounds);
    }, [bounds, members, size.h, size.w]);

    useEffect(() => {
        if (initialNodes.length === 0) return;
        nodesRef.current = initialNodes.map((node) => ({ ...node }));
        iterRef.current = 0;
    }, [initialNodes]);

    useEffect(() => {
        if (nodesRef.current.length === 0) return;

        let running = true;
        const maxIter = 320;

        function step() {
            if (!running) return;
            simulate(nodesRef.current, edges, size.w, size.h, bounds);
            iterRef.current += 1;
            setNodes([...nodesRef.current]);
            if (dragIdxRef.current !== null || iterRef.current < maxIter) {
                animRef.current = requestAnimationFrame(step);
            }
        }

        animRef.current = requestAnimationFrame(step);

        return () => {
            running = false;
            cancelAnimationFrame(animRef.current);
        };
    }, [bounds, edges, membersKey, size.h, size.w]);

    const handlePointerDown = useCallback((idx: number, e: React.PointerEvent) => {
        e.stopPropagation();
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);

        dragIdxRef.current = idx;
        setDragIdx(idx);
        nodesRef.current[idx].fx = nodesRef.current[idx].x;
        nodesRef.current[idx].fy = nodesRef.current[idx].y;
        iterRef.current = 0;

        cancelAnimationFrame(animRef.current);
        const loop = () => {
            simulate(nodesRef.current, edges, size.w, size.h, bounds);
            setNodes([...nodesRef.current]);
            if (dragIdxRef.current !== null) {
                animRef.current = requestAnimationFrame(loop);
            }
        };
        animRef.current = requestAnimationFrame(loop);
    }, [bounds, edges, size.h, size.w]);

    const handlePointerMove = useCallback((idx: number, e: React.PointerEvent) => {
        if (dragIdxRef.current !== idx || !containerRef.current) return;
        e.stopPropagation();

        const rect = containerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        nodesRef.current[idx].fx = clamp(x, bounds.left, size.w - bounds.right);
        nodesRef.current[idx].fy = clamp(y, bounds.top, size.h - bounds.bottom);
        nodesRef.current[idx].x = nodesRef.current[idx].fx ?? nodesRef.current[idx].x;
        nodesRef.current[idx].y = nodesRef.current[idx].fy ?? nodesRef.current[idx].y;
    }, [bounds, size.h, size.w]);

    const handlePointerUp = useCallback((idx: number, e: React.PointerEvent) => {
        if (dragIdxRef.current !== idx) return;
        e.stopPropagation();

        nodesRef.current[idx].fx = null;
        nodesRef.current[idx].fy = null;
        dragIdxRef.current = null;
        setDragIdx(null);
        iterRef.current = 0;

        const settle = () => {
            simulate(nodesRef.current, edges, size.w, size.h, bounds);
            iterRef.current += 1;
            setNodes([...nodesRef.current]);
            if (iterRef.current < 120) {
                animRef.current = requestAnimationFrame(settle);
            }
        };

        animRef.current = requestAnimationFrame(settle);
    }, [bounds, edges, size.h, size.w]);

    if (members.length === 0 || nodes.length === 0) {
        return (
            <div
                style={{
                    textAlign: 'center',
                    padding: 'var(--space-8)',
                    color: 'var(--fg-tertiary)',
                    fontSize: 'var(--text-sm)',
                    borderRadius: 'var(--radius-2xl)',
                    border: '1px dashed rgba(var(--accent-500-rgb), 0.16)',
                    background: 'linear-gradient(180deg, rgba(var(--accent-500-rgb), 0.03), transparent)',
                }}
            >
                No transfers to display
            </div>
        );
    }

    const markerId = `arrow-${instanceId}`;
    const lineGlowId = `line-glow-${instanceId}`;
    const pillGlowId = `pill-glow-${instanceId}`;

    return (
        <div
            ref={containerRef}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
                width: '100%',
                height: size.h,
                position: 'relative',
                overflow: 'hidden',
                borderRadius: 'calc(var(--radius-2xl) + 6px)',
                touchAction: 'none',
                border: '1px solid rgba(var(--accent-500-rgb), 0.1)',
                background: `
                    radial-gradient(circle at 20% 16%, rgba(var(--accent-500-rgb), 0.14), transparent 28%),
                    radial-gradient(circle at 78% 18%, rgba(244, 114, 182, 0.08), transparent 22%),
                    radial-gradient(circle at 52% 68%, rgba(var(--accent-500-rgb), 0.08), transparent 34%),
                    linear-gradient(180deg, rgba(var(--accent-500-rgb), 0.04), transparent 22%),
                    var(--bg-glass)
                `,
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.32), 0 24px 60px rgba(0, 0, 0, 0.12), 0 0 50px rgba(var(--accent-500-rgb), 0.05)',
            }}
        >
            <style jsx>{`
                .settlement-path-halo {
                    stroke-dasharray: 12 10;
                    animation:
                        settlement-line-draw 1.05s cubic-bezier(0.22, 1, 0.36, 1) both,
                        settlement-line-glow 5.8s ease-in-out infinite;
                }

                .settlement-path-main {
                    animation:
                        settlement-line-draw 1.2s cubic-bezier(0.22, 1, 0.36, 1) both,
                        settlement-line-flow 13.5s linear infinite,
                        settlement-line-breathe 4.8s ease-in-out infinite;
                }

                .settlement-flow-spark {
                    animation:
                        settlement-flow-spark-enter 0.8s ease-out both,
                        settlement-flow-spark-glow 3.8s ease-in-out infinite;
                }

                .settlement-pill-group {
                    transform-origin: center;
                    animation:
                        settlement-pill-enter 0.9s cubic-bezier(0.22, 1, 0.36, 1) both,
                        settlement-pill-float 5.8s ease-in-out infinite;
                }

                .settlement-node-aura {
                    animation: settlement-node-aura 6.5s ease-in-out infinite;
                }

                .settlement-node-shell {
                    animation: settlement-node-shell 7.2s ease-in-out infinite;
                }

                .settlement-node-badge {
                    animation: settlement-badge-pop 4.6s ease-in-out infinite;
                }

                @keyframes settlement-line-draw {
                    0% {
                        opacity: 0;
                        stroke-dashoffset: 90;
                    }
                    100% {
                        opacity: 1;
                        stroke-dashoffset: 0;
                    }
                }

                @keyframes settlement-line-flow {
                    0% {
                        stroke-dashoffset: 0;
                    }
                    100% {
                        stroke-dashoffset: -120;
                    }
                }

                @keyframes settlement-line-glow {
                    0%,
                    100% {
                        opacity: 0.08;
                    }
                    50% {
                        opacity: 0.17;
                    }
                }

                @keyframes settlement-line-breathe {
                    0%,
                    100% {
                        opacity: 0.72;
                    }
                    50% {
                        opacity: 1;
                    }
                }

                @keyframes settlement-pill-enter {
                    0% {
                        opacity: 0;
                        transform: translateY(8px) scale(0.92);
                    }
                    100% {
                        opacity: 1;
                        transform: translateY(0) scale(1);
                    }
                }

                @keyframes settlement-pill-float {
                    0%,
                    100% {
                        transform: translateY(0);
                    }
                    50% {
                        transform: translateY(-2px);
                    }
                }

                @keyframes settlement-flow-spark-enter {
                    0% {
                        opacity: 0;
                        transform: scale(0.6);
                    }
                    100% {
                        opacity: 1;
                        transform: scale(1);
                    }
                }

                @keyframes settlement-flow-spark-glow {
                    0%,
                    100% {
                        opacity: 0.5;
                    }
                    50% {
                        opacity: 1;
                    }
                }

                @keyframes settlement-node-aura {
                    0%,
                    100% {
                        opacity: 0.72;
                        transform: scale(1);
                    }
                    50% {
                        opacity: 0.96;
                        transform: scale(1.04);
                    }
                }

                @keyframes settlement-node-shell {
                    0%,
                    100% {
                        opacity: 0.7;
                    }
                    50% {
                        opacity: 1;
                    }
                }

                @keyframes settlement-badge-pop {
                    0%,
                    100% {
                        transform: scale(1);
                    }
                    50% {
                        transform: scale(1.06);
                    }
                }

                @media (prefers-reduced-motion: reduce) {
                    .settlement-path-halo,
                    .settlement-path-main,
                    .settlement-flow-spark,
                    .settlement-pill-group,
                    .settlement-node-aura,
                    .settlement-node-shell,
                    .settlement-node-badge {
                        animation: none !important;
                    }
                }
            `}</style>
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundImage: `
                        linear-gradient(rgba(var(--accent-500-rgb), 0.03) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(var(--accent-500-rgb), 0.03) 1px, transparent 1px)
                    `,
                    backgroundSize: compact ? '28px 28px' : '34px 34px',
                    maskImage: 'linear-gradient(180deg, rgba(0,0,0,0.55), transparent 82%)',
                    pointerEvents: 'none',
                }}
            />

            <div
                style={{
                    position: 'absolute',
                    top: 0,
                    left: '16%',
                    right: '16%',
                    height: 1,
                    background: 'linear-gradient(90deg, transparent, rgba(var(--accent-500-rgb), 0.32), transparent)',
                    pointerEvents: 'none',
                }}
            />

            <div
                style={{
                    position: 'absolute',
                    inset: 16,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 10,
                    zIndex: 2,
                    pointerEvents: 'none',
                    flexWrap: 'wrap',
                }}
            >
                <div style={{ ...hudCardStyle, maxWidth: compact ? '100%' : 280 }}>
                    <span
                        style={{
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            color: 'var(--accent-500)',
                        }}
                    >
                        Optimized route map
                    </span>
                    <div
                        className="font-display"
                        style={{
                            fontSize: compact ? 'var(--text-lg)' : 'var(--text-xl)',
                            lineHeight: 1.1,
                            fontWeight: 800,
                            color: 'var(--fg-primary)',
                        }}
                    >
                        Premium money flow
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--fg-tertiary)', lineHeight: 1.45 }}>
                        Drag avatars to spread the map. Curved paths show the fewest transfers needed to settle the group.
                    </span>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' }}>
                    <div style={hudCardStyle}>
                        <span style={{ fontSize: 10, color: 'var(--fg-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                            Transfers
                        </span>
                        <span className="font-display" style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--fg-primary)' }}>
                            {settlements.length}
                        </span>
                    </div>
                    <div style={hudCardStyle}>
                        <span style={{ fontSize: 10, color: 'var(--fg-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                            Total to settle
                        </span>
                        <span className="font-display" style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--fg-primary)' }}>
                            {formatCurrency(totalAmount)}
                        </span>
                    </div>
                </div>
            </div>

            <div
                style={{
                    position: 'absolute',
                    left: 18,
                    right: 18,
                    bottom: 14,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                    flexWrap: 'wrap',
                    zIndex: 2,
                    pointerEvents: 'none',
                }}
            >
                <div
                    style={{
                        padding: '8px 12px',
                        borderRadius: 999,
                        background: 'rgba(var(--accent-500-rgb), 0.07)',
                        border: '1px solid rgba(var(--accent-500-rgb), 0.1)',
                        color: 'var(--fg-secondary)',
                        fontSize: 11,
                        fontWeight: 600,
                    }}
                >
                    {members.length} members in this settlement map
                </div>
                <div
                    style={{
                        padding: '8px 12px',
                        borderRadius: 999,
                        background: 'rgba(255,255,255,0.45)',
                        border: '1px solid rgba(var(--accent-500-rgb), 0.08)',
                        color: 'var(--fg-tertiary)',
                        fontSize: 11,
                        fontWeight: 600,
                        backdropFilter: 'blur(14px)',
                        WebkitBackdropFilter: 'blur(14px)',
                    }}
                >
                    Fewest payments, clearest route
                </div>
            </div>

            <svg
                width={size.w}
                height={size.h}
                style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
            >
                <defs>
                    <marker
                        id={markerId}
                        markerWidth="14"
                        markerHeight="12"
                        refX="10"
                        refY="6"
                        orient="auto"
                    >
                        <path d="M0,0 L12,6 L0,12 Z" fill="rgba(var(--accent-500-rgb), 0.8)" />
                    </marker>
                    <filter id={lineGlowId}>
                        <feGaussianBlur stdDeviation="4" result="blur" />
                        <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                    <filter id={pillGlowId}>
                        <feDropShadow dx="0" dy="10" stdDeviation="12" floodColor="rgba(15,23,42,0.12)" />
                    </filter>
                </defs>
                {settlements.map((settlement, index) => {
                    const fromIdx = members.indexOf(settlement.from);
                    const toIdx = members.indexOf(settlement.to);
                    if (fromIdx === -1 || toIdx === -1) return null;

                    const fromNode = nodes[fromIdx];
                    const toNode = nodes[toIdx];
                    if (!fromNode || !toNode) return null;

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
                    const gradientId = `edge-gradient-${instanceId}-${index}`;
                    const routePathId = `edge-route-${instanceId}-${index}`;

                    return (
                        <g key={`edge-${settlement.from}-${settlement.to}-${index}`}>
                            <defs>
                                <linearGradient id={gradientId} x1={sx} y1={sy} x2={ex} y2={ey} gradientUnits="userSpaceOnUse">
                                    <stop offset="0%" stopColor="rgba(var(--accent-500-rgb), 0.18)" />
                                    <stop offset="48%" stopColor="rgba(var(--accent-500-rgb), 0.72)" />
                                    <stop offset="100%" stopColor="rgba(var(--accent-500-rgb), 0.34)" />
                                </linearGradient>
                            </defs>

                            <path
                                id={routePathId}
                                d={`M ${sx} ${sy} Q ${cpx} ${cpy} ${ex} ${ey}`}
                                fill="none"
                                stroke="rgba(var(--accent-500-rgb), 0.08)"
                                strokeWidth={8}
                                filter={`url(#${lineGlowId})`}
                                className="settlement-path-halo"
                                style={{ animationDelay: `${index * 0.12}s` }}
                            />
                            <path
                                d={`M ${sx} ${sy} Q ${cpx} ${cpy} ${ex} ${ey}`}
                                fill="none"
                                stroke={`url(#${gradientId})`}
                                strokeWidth={2.8}
                                strokeDasharray="8 7"
                                markerEnd={`url(#${markerId})`}
                                strokeLinecap="round"
                                className="settlement-path-main"
                                style={{
                                    animationDelay: `${index * 0.16}s, ${1 + index * 0.12}s, ${index * 0.2}s`,
                                }}
                            />

                            <circle
                                r="3.6"
                                fill="rgba(var(--accent-500-rgb), 0.95)"
                                filter={`url(#${pillGlowId})`}
                                className="settlement-flow-spark"
                                style={{ animationDelay: `${0.45 + index * 0.18}s, ${index * 0.18}s` }}
                            >
                                <animateMotion
                                    dur={`${3.8 + index * 0.35}s`}
                                    begin={`${0.9 + index * 0.2}s`}
                                    repeatCount="indefinite"
                                    rotate="auto"
                                    path={`M ${sx} ${sy} Q ${cpx} ${cpy} ${ex} ${ey}`}
                                />
                            </circle>

                            <circle
                                r="2.2"
                                fill="rgba(255,255,255,0.9)"
                                className="settlement-flow-spark"
                                style={{ animationDelay: `${0.7 + index * 0.22}s, ${0.1 + index * 0.16}s` }}
                            >
                                <animateMotion
                                    dur={`${4.6 + index * 0.3}s`}
                                    begin={`${1.4 + index * 0.22}s`}
                                    repeatCount="indefinite"
                                    rotate="auto"
                                    path={`M ${sx} ${sy} Q ${cpx} ${cpy} ${ex} ${ey}`}
                                />
                            </circle>

                            <g
                                filter={`url(#${pillGlowId})`}
                                className="settlement-pill-group"
                                style={{ animationDelay: `${0.24 + index * 0.14}s, ${1.2 + index * 0.14}s` }}
                            >
                                <rect
                                    x={tx - 41}
                                    y={ty - 19}
                                    width={82}
                                    height={38}
                                    rx={19}
                                    fill="var(--bg-glass-strong)"
                                    stroke="rgba(var(--accent-500-rgb), 0.14)"
                                    strokeWidth={1}
                                />
                                <text
                                    x={tx}
                                    y={ty - 2}
                                    textAnchor="middle"
                                    fontSize="9.5"
                                    letterSpacing="0.1em"
                                    fontWeight="700"
                                    fill="var(--fg-tertiary)"
                                    style={{ textTransform: 'uppercase' }}
                                >
                                    Transfer
                                </text>
                                <text
                                    x={tx}
                                    y={ty + 12}
                                    textAnchor="middle"
                                    fontSize="12"
                                    fontWeight="800"
                                    fill="var(--accent-600)"
                                    style={{ fontFamily: 'var(--font-display)' }}
                                >
                                    {formatCurrency(settlement.amount)}
                                </text>
                            </g>
                        </g>
                    );
                })}
            </svg>

            {nodes.map((node, index) => {
                const color = getAvatarColor(node.name);
                const initials = node.name
                    .split(' ')
                    .map((word) => word[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2);
                const image = memberImages[node.name] || null;
                const firstName = node.name.split(' ')[0];
                const isDragging = dragIdx === index;
                const connectionCount = connectionCounts[node.name] ?? 0;

                return (
                    <div
                        key={`node-${node.name}`}
                        onPointerDown={(e) => handlePointerDown(index, e)}
                        onPointerMove={(e) => handlePointerMove(index, e)}
                        onPointerUp={(e) => handlePointerUp(index, e)}
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: 68,
                            height: 68,
                            transform: `translate(${node.x - 34}px, ${node.y - 34}px) scale(${isDragging ? 1.1 : 1})`,
                            transition: isDragging ? 'transform 0s' : 'transform 120ms var(--ease-out)',
                            cursor: isDragging ? 'grabbing' : 'grab',
                            zIndex: isDragging ? 40 : 12,
                            touchAction: 'none',
                            userSelect: 'none',
                        }}
                    >
                        <div
                            className="settlement-node-aura"
                            style={{
                                position: 'absolute',
                                inset: -12,
                                borderRadius: '50%',
                                background: `radial-gradient(circle, ${color}30 0%, ${color}0 74%)`,
                                opacity: isDragging ? 0.95 : 0.8,
                                pointerEvents: 'none',
                            }}
                        />

                        <div
                            className="settlement-node-shell"
                            style={{
                                position: 'absolute',
                                inset: -4,
                                borderRadius: '50%',
                                border: '1px solid rgba(var(--accent-500-rgb), 0.12)',
                                background: 'linear-gradient(180deg, rgba(255,255,255,0.28), transparent)',
                                pointerEvents: 'none',
                            }}
                        />

                        <div
                            style={{
                                position: 'relative',
                                width: 68,
                                height: 68,
                                borderRadius: '50%',
                                overflow: 'hidden',
                                border: '3px solid rgba(255,255,255,0.9)',
                                boxShadow: isDragging
                                    ? '0 20px 40px rgba(15, 23, 42, 0.22), 0 0 0 5px rgba(var(--accent-500-rgb), 0.16)'
                                    : '0 14px 30px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(var(--accent-500-rgb), 0.08)',
                                background: image ? 'var(--bg-secondary)' : color,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            {image ? (
                                <Image
                                    src={image}
                                    alt={node.name}
                                    width={68}
                                    height={68}
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                    draggable={false}
                                />
                            ) : (
                                <span
                                    style={{
                                        fontSize: 18,
                                        fontWeight: 800,
                                        color: 'white',
                                        letterSpacing: '0.04em',
                                        userSelect: 'none',
                                    }}
                                >
                                    {initials}
                                </span>
                            )}
                        </div>

                        {connectionCount > 0 && (
                            <div
                                className="settlement-node-badge"
                                style={{
                                    position: 'absolute',
                                    top: -2,
                                    right: -2,
                                    minWidth: 24,
                                    height: 24,
                                    borderRadius: 999,
                                    padding: '0 7px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                                    color: 'white',
                                    fontSize: 10,
                                    fontWeight: 800,
                                    border: '2px solid var(--bg-glass-strong)',
                                    boxShadow: '0 10px 18px rgba(var(--accent-500-rgb), 0.28)',
                                }}
                            >
                                {connectionCount}
                            </div>
                        )}

                        <div
                            style={{
                                position: 'absolute',
                                left: '50%',
                                bottom: -30,
                                transform: 'translateX(-50%)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                maxWidth: 120,
                                padding: '6px 12px',
                                whiteSpace: 'nowrap',
                                borderRadius: 999,
                                background: 'linear-gradient(180deg, var(--bg-glass-strong), var(--bg-glass))',
                                border: '1px solid rgba(var(--accent-500-rgb), 0.1)',
                                boxShadow: '0 14px 24px rgba(15, 23, 42, 0.09)',
                                pointerEvents: 'none',
                            }}
                        >
                            <span
                                style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: '50%',
                                    background: color,
                                    boxShadow: `0 0 10px ${color}66`,
                                    flexShrink: 0,
                                }}
                            />
                            <span
                                style={{
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: 'var(--fg-primary)',
                                }}
                            >
                                {firstName}
                            </span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
