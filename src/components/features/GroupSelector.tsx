'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Loader2 } from 'lucide-react';

interface GroupItem {
    id: string;
    name: string;
    emoji: string;
}

interface GroupSelectorProps {
    selectedGroupId: string;
    onGroupChange: (groupId: string) => void;
    className?: string;
}

export default function GroupSelector({ selectedGroupId, onGroupChange, className }: GroupSelectorProps) {
    const [groups, setGroups] = useState<GroupItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        async function load() {
            try {
                const res = await fetch('/api/groups');
                if (res.ok) {
                    const data = await res.json();
                    setGroups(Array.isArray(data) ? data : []);
                    // Auto-select first if none selected
                    if (!selectedGroupId && data.length > 0) {
                        onGroupChange(data[0].id);
                    }
                }
            } catch {
                // silent
            } finally {
                setLoading(false);
            }
        }
        load();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const selected = groups.find(g => g.id === selectedGroupId);

    if (loading) {
        return (
            <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 14px', borderRadius: 'var(--radius-lg)',
                background: 'var(--bg-tertiary)', opacity: 0.6,
            }}>
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>Loading groups…</span>
            </div>
        );
    }

    if (groups.length === 0) return null;

    return (
        <div style={{ position: 'relative' }} className={className}>
            <button
                onClick={() => setOpen(!open)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 14px',
                    borderRadius: 'var(--radius-lg)',
                    background: 'var(--surface-card)',
                    border: '1px solid var(--border-default)',
                    cursor: 'pointer',
                    fontSize: 'var(--text-sm)',
                    fontWeight: 500,
                    color: 'var(--fg-primary)',
                    transition: 'all 0.2s',
                    width: '100%',
                    justifyContent: 'space-between',
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18 }}>{selected?.emoji || '📋'}</span>
                    {selected?.name || 'Select group'}
                </span>
                <motion.span
                    animate={{ rotate: open ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                >
                    <ChevronDown size={16} />
                </motion.span>
            </button>

            <AnimatePresence>
                {open && (
                    <>
                        {/* Backdrop */}
                        <div
                            onClick={() => setOpen(false)}
                            style={{
                                position: 'fixed', inset: 0, zIndex: 10,
                            }}
                        />
                        <motion.div
                            initial={{ opacity: 0, y: -8, scale: 0.95 }}
                            animate={{ opacity: 1, y: 4, scale: 1 }}
                            exit={{ opacity: 0, y: -8, scale: 0.95 }}
                            transition={{ duration: 0.15 }}
                            style={{
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                right: 0,
                                zIndex: 20,
                                background: 'var(--surface-card)',
                                border: '1px solid var(--border-default)',
                                borderRadius: 'var(--radius-lg)',
                                boxShadow: 'var(--shadow-lg)',
                                overflow: 'hidden',
                                maxHeight: 240,
                                overflowY: 'auto',
                            }}
                        >
                            {groups.map(g => (
                                <button
                                    key={g.id}
                                    onClick={() => { onGroupChange(g.id); setOpen(false); }}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 10,
                                        width: '100%',
                                        padding: '10px 14px',
                                        border: 'none',
                                        background: g.id === selectedGroupId
                                            ? 'rgba(var(--accent-500-rgb), 0.08)'
                                            : 'transparent',
                                        cursor: 'pointer',
                                        fontSize: 'var(--text-sm)',
                                        color: 'var(--fg-primary)',
                                        textAlign: 'left',
                                        transition: 'background 0.15s',
                                    }}
                                    onMouseEnter={(e) => {
                                        (e.target as HTMLElement).style.background = 'rgba(var(--accent-500-rgb), 0.06)';
                                    }}
                                    onMouseLeave={(e) => {
                                        (e.target as HTMLElement).style.background = g.id === selectedGroupId
                                            ? 'rgba(var(--accent-500-rgb), 0.08)'
                                            : 'transparent';
                                    }}
                                >
                                    <span style={{ fontSize: 18 }}>{g.emoji}</span>
                                    <span style={{ fontWeight: g.id === selectedGroupId ? 600 : 400 }}>{g.name}</span>
                                </button>
                            ))}
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
