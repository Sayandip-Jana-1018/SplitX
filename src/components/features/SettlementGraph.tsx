'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
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

/* ── Force simulation helpers ── */

interface NodeState {
    x: number;
    y: number;
    vx: number;
    vy: number;
    fx: number | null; // fixed x (when dragging)
    fy: number | null;
    name: string;
}

function initNodes(members: string[], w: number, h: number): NodeState[] {
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(cx, cy) * 0.72;
    return members.map((name, i) => {
        const angle = (2 * Math.PI * i) / members.length - Math.PI / 2;
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

function simulate(nodes: NodeState[], edges: { source: number; target: number }[], w: number, h: number) {
    const cx = w / 2;
    const cy = h / 2;
    const REPULSION = 8000;
    const SPRING_K = 0.012;
    const IDEAL_LEN = Math.min(w, h) * 0.52;
    const CENTER_PULL = 0.0015;
    const DAMPING = 0.72;
    const PADDING = 60;

    // Reset forces
    for (const n of nodes) {
        if (n.fx !== null) { n.x = n.fx; n.y = n.fy!; n.vx = 0; n.vy = 0; continue; }
    }

    // Repulsion between all pairs
    for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].fx !== null) continue;
        for (let j = i + 1; j < nodes.length; j++) {
            const dx = nodes[j].x - nodes[i].x;
            const dy = nodes[j].y - nodes[i].y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = REPULSION / (dist * dist);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            if (nodes[i].fx === null) { nodes[i].vx -= fx; nodes[i].vy -= fy; }
            if (nodes[j].fx === null) { nodes[j].vx += fx; nodes[j].vy += fy; }
        }
    }

    // Spring attraction along edges
    for (const e of edges) {
        const a = nodes[e.source];
        const b = nodes[e.target];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const displacement = dist - IDEAL_LEN;
        const force = SPRING_K * displacement;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        if (a.fx === null) { a.vx += fx; a.vy += fy; }
        if (b.fx === null) { b.vx -= fx; b.vy -= fy; }
    }

    // Gentle pull toward center
    for (const n of nodes) {
        if (n.fx !== null) continue;
        n.vx += (cx - n.x) * CENTER_PULL;
        n.vy += (cy - n.y) * CENTER_PULL;
    }

    // Integrate + boundary clamp
    for (const n of nodes) {
        if (n.fx !== null) continue;
        n.vx *= DAMPING;
        n.vy *= DAMPING;
        n.x += n.vx;
        n.y += n.vy;
        n.x = Math.max(PADDING, Math.min(w - PADDING, n.x));
        n.y = Math.max(PADDING, Math.min(h - PADDING, n.y));
    }
}

/* ── Component ── */

export default function SettlementGraph({
    members,
    settlements,
    memberImages = {},
    compact = false,
    instanceId = 'default',
}: SettlementGraphProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ w: 360, h: compact ? 340 : 480 });
    const [nodes, setNodes] = useState<NodeState[]>([]);
    const [dragIdx, setDragIdx] = useState<number | null>(null);
    const nodesRef = useRef<NodeState[]>([]);
    const animRef = useRef<number>(0);
    const dragIdxRef = useRef<number | null>(null);
    const iterRef = useRef(0);

    // Edges as index pairs
    const edges = useMemo(() =>
        settlements.map(s => ({
            source: members.indexOf(s.from),
            target: members.indexOf(s.to),
        })).filter(e => e.source !== -1 && e.target !== -1),
        [settlements, members]);

    // Stable key for member identity
    const membersKey = useMemo(() => members.join(','), [members]);

    // Resize
    useEffect(() => {
        function onResize() {
            if (containerRef.current) {
                const w = containerRef.current.offsetWidth;
                setSize({ w, h: compact ? Math.min(w, 360) : Math.min(w * 1.2, 480) });
            }
        }
        onResize();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [compact]);

    // Init nodes when members or size change (derive, don't effect)
    const initialNodes = useMemo(() => {
        if (members.length === 0) return [];
        return initNodes(members, size.w, size.h);
    }, [members, size.w, size.h]);

    // Sync ref and state from derived initial nodes
    useEffect(() => {
        if (initialNodes.length === 0) return;
        nodesRef.current = initialNodes.map(n => ({ ...n }));
        iterRef.current = 0;
    }, [initialNodes]);

    // Force simulation loop
    useEffect(() => {
        if (nodesRef.current.length === 0) return;

        let running = true;
        const maxIter = 300;

        function step() {
            if (!running) return;
            simulate(nodesRef.current, edges, size.w, size.h);
            iterRef.current++;
            setNodes([...nodesRef.current]);
            // Keep running if dragging or still settling
            if (dragIdxRef.current !== null || iterRef.current < maxIter) {
                animRef.current = requestAnimationFrame(step);
            }
        }
        animRef.current = requestAnimationFrame(step);

        return () => { running = false; cancelAnimationFrame(animRef.current); };
    }, [membersKey, size.w, size.h, edges]);

    // Pointer-based drag (raw events, no framer-motion drag — prevents carousel interference)
    const handlePointerDown = useCallback((idx: number, e: React.PointerEvent) => {
        e.stopPropagation();
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);

        dragIdxRef.current = idx;
        setDragIdx(idx);
        nodesRef.current[idx].fx = nodesRef.current[idx].x;
        nodesRef.current[idx].fy = nodesRef.current[idx].y;
        iterRef.current = 0;

        // Restart animation loop
        cancelAnimationFrame(animRef.current);
        const loop = () => {
            simulate(nodesRef.current, edges, size.w, size.h);
            setNodes([...nodesRef.current]);
            if (dragIdxRef.current !== null) {
                animRef.current = requestAnimationFrame(loop);
            }
        };
        animRef.current = requestAnimationFrame(loop);
    }, [edges, size]);

    const handlePointerMove = useCallback((idx: number, e: React.PointerEvent) => {
        if (dragIdxRef.current !== idx) return;
        e.stopPropagation();
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        nodesRef.current[idx].fx = Math.max(40, Math.min(size.w - 40, x));
        nodesRef.current[idx].fy = Math.max(40, Math.min(size.h - 40, y));
        nodesRef.current[idx].x = nodesRef.current[idx].fx!;
        nodesRef.current[idx].y = nodesRef.current[idx].fy!;
    }, [size]);

    const handlePointerUp = useCallback((idx: number, e: React.PointerEvent) => {
        if (dragIdxRef.current !== idx) return;
        e.stopPropagation();
        nodesRef.current[idx].fx = null;
        nodesRef.current[idx].fy = null;
        dragIdxRef.current = null;
        setDragIdx(null);
        iterRef.current = 0;
        // Let simulation settle
        const settle = () => {
            simulate(nodesRef.current, edges, size.w, size.h);
            iterRef.current++;
            setNodes([...nodesRef.current]);
            if (iterRef.current < 120) {
                animRef.current = requestAnimationFrame(settle);
            }
        };
        animRef.current = requestAnimationFrame(settle);
    }, [edges, size]);

    if (members.length === 0 || nodes.length === 0) {
        return (
            <div style={{
                textAlign: 'center', padding: 'var(--space-8)',
                color: 'var(--fg-tertiary)', fontSize: 'var(--text-sm)',
            }}>
                No transfers to display
            </div>
        );
    }

    const markerId = `arrow-${instanceId}`;

    return (
        <div
            ref={containerRef}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
                width: '100%',
                height: size.h,
                position: 'relative',
                overflow: 'hidden',
                borderRadius: 'var(--radius-xl)',
                touchAction: 'none',
            }}
        >
            {/* SVG layer for edges */}
            <svg
                width={size.w}
                height={size.h}
                style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
            >
                <defs>
                    <marker
                        id={markerId}
                        markerWidth="10"
                        markerHeight="8"
                        refX="9"
                        refY="4"
                        orient="auto"
                    >
                        <path d="M0,0 L10,4 L0,8 Z" fill="var(--accent-500)" opacity="0.75" />
                    </marker>
                    <filter id={`glow-${instanceId}`}>
                        <feGaussianBlur stdDeviation="2" result="blur" />
                        <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>

                {settlements.map((s, i) => {
                    const fromIdx = members.indexOf(s.from);
                    const toIdx = members.indexOf(s.to);
                    if (fromIdx === -1 || toIdx === -1) return null;
                    const a = nodes[fromIdx];
                    const b = nodes[toIdx];
                    if (!a || !b) return null;

                    const dx = b.x - a.x;
                    const dy = b.y - a.y;
                    const len = Math.sqrt(dx * dx + dy * dy) || 1;
                    const nr = 28;

                    const sx = a.x + (dx / len) * nr;
                    const sy = a.y + (dy / len) * nr;
                    const ex = b.x - (dx / len) * (nr + 6);
                    const ey = b.y - (dy / len) * (nr + 6);

                    const mx = (sx + ex) / 2;
                    const my = (sy + ey) / 2;
                    const nx = -(dy / len);
                    const ny = (dx / len);
                    const bow = 25 + (i * 8);
                    const dir = i % 2 === 0 ? 1 : -1;
                    const cpx = mx + nx * bow * dir;
                    const cpy = my + ny * bow * dir;

                    const tx = 0.25 * sx + 0.5 * cpx + 0.25 * ex;
                    const ty = 0.25 * sy + 0.5 * cpy + 0.25 * ey;

                    return (
                        <g key={`edge-${i}`}>
                            <path
                                d={`M ${sx} ${sy} Q ${cpx} ${cpy} ${ex} ${ey}`}
                                fill="none"
                                stroke="var(--accent-400)"
                                strokeWidth={4}
                                opacity={0.08}
                            />
                            <path
                                d={`M ${sx} ${sy} Q ${cpx} ${cpy} ${ex} ${ey}`}
                                fill="none"
                                stroke="var(--accent-400)"
                                strokeWidth={2}
                                strokeDasharray="6 4"
                                opacity={0.55}
                                markerEnd={`url(#${markerId})`}
                            />
                            <g filter={`url(#glow-${instanceId})`}>
                                <rect
                                    x={tx - 34}
                                    y={ty - 13}
                                    width={68}
                                    height={26}
                                    rx={13}
                                    fill="var(--bg-primary)"
                                    stroke="rgba(var(--accent-500-rgb), 0.25)"
                                    strokeWidth={1.5}
                                />
                                <text
                                    x={tx}
                                    y={ty + 5}
                                    textAnchor="middle"
                                    fontSize={11}
                                    fontWeight={700}
                                    fill="var(--accent-600)"
                                    style={{ fontFamily: 'var(--font-sans)' }}
                                >
                                    {formatCurrency(s.amount)}
                                </text>
                            </g>
                        </g>
                    );
                })}
            </svg>

            {/* HTML layer for draggable nodes — positioned directly via transform for smooth 60fps */}
            {nodes.map((node, i) => {
                const name = node.name;
                const color = getAvatarColor(name);
                const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
                const image = memberImages[name] || null;
                const firstName = name.split(' ')[0];
                const isDragging = dragIdx === i;

                return (
                    <div
                        key={`node-${name}`}
                        onPointerDown={(e) => handlePointerDown(i, e)}
                        onPointerMove={(e) => handlePointerMove(i, e)}
                        onPointerUp={(e) => handlePointerUp(i, e)}
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: 56,
                            height: 56,
                            transform: `translate(${node.x - 28}px, ${node.y - 28}px) scale(${isDragging ? 1.15 : 1})`,
                            transition: isDragging ? 'transform 0s' : 'transform 0.08s ease-out',
                            cursor: isDragging ? 'grabbing' : 'grab',
                            zIndex: isDragging ? 50 : 10,
                            touchAction: 'none',
                            userSelect: 'none',
                        }}
                    >
                        {/* Glow ring */}
                        <div style={{
                            position: 'absolute',
                            top: -6,
                            left: -6,
                            width: 68,
                            height: 68,
                            borderRadius: '50%',
                            background: `radial-gradient(circle, ${color}33 0%, transparent 70%)`,
                            pointerEvents: 'none',
                        }} />

                        {/* Avatar */}
                        <div style={{
                            width: 56,
                            height: 56,
                            borderRadius: '50%',
                            overflow: 'hidden',
                            border: '3px solid var(--bg-primary)',
                            boxShadow: isDragging
                                ? '0 8px 30px rgba(0,0,0,0.2), 0 0 0 2px rgba(var(--accent-500-rgb), 0.3)'
                                : '0 4px 20px rgba(0,0,0,0.12), 0 0 0 1px rgba(var(--accent-500-rgb), 0.1)',
                            background: image ? 'var(--bg-secondary)' : color,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            position: 'relative',
                            transition: 'box-shadow 0.2s ease',
                        }}>
                            {image ? (
                                <Image
                                    src={image}
                                    alt={name}
                                    width={56}
                                    height={56}
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                    draggable={false}
                                />
                            ) : (
                                <span style={{
                                    fontSize: 16,
                                    fontWeight: 700,
                                    color: 'white',
                                    letterSpacing: '0.02em',
                                    userSelect: 'none',
                                }}>
                                    {initials}
                                </span>
                            )}
                        </div>

                        {/* Name badge */}
                        <div style={{
                            position: 'absolute',
                            bottom: -20,
                            left: '50%',
                            transform: 'translateX(-50%)',
                            whiteSpace: 'nowrap',
                            fontSize: 11,
                            fontWeight: 600,
                            color: 'var(--fg-secondary)',
                            background: 'var(--bg-glass)',
                            backdropFilter: 'blur(8px)',
                            WebkitBackdropFilter: 'blur(8px)',
                            padding: '2px 10px',
                            borderRadius: 10,
                            border: '1px solid var(--border-glass)',
                            pointerEvents: 'none',
                            userSelect: 'none',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                        }}>
                            {firstName}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
