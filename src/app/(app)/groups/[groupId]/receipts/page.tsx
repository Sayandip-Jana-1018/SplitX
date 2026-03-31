'use client';

import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Calendar,
    ChevronLeft,
    Image as ImageIcon,
    Loader2,
    Receipt,
    Tag,
    User,
    X,
    ZoomIn,
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import Avatar from '@/components/ui/Avatar';
import { formatCurrency, timeAgo } from '@/lib/utils';

interface ReceiptEntry {
    id: string;
    title: string;
    amount: number;
    category: string;
    receiptUrl: string;
    date: string;
    payer: {
        id: string;
        name: string | null;
        image: string | null;
    };
}

const CAT_EMOJI: Record<string, string> = {
    food: 'Burger',
    transport: 'Cab',
    shopping: 'Shop',
    entertainment: 'Fun',
    bills: 'Bills',
    health: 'Health',
    education: 'Study',
    general: 'General',
};

export default function ReceiptGalleryPage() {
    const params = useParams();
    const router = useRouter();
    const groupId = params?.groupId as string;

    const [receipts, setReceipts] = useState<ReceiptEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedReceipt, setSelectedReceipt] = useState<ReceiptEntry | null>(null);
    const [filterMember, setFilterMember] = useState<string>('all');
    const [members, setMembers] = useState<{ id: string; name: string; image: string | null }[]>([]);

    const fetchReceipts = useCallback(async () => {
        try {
            const response = await fetch(`/api/groups/${groupId}/receipts`);
            if (response.ok) {
                const data = await response.json();
                setReceipts(data.receipts || []);
                setMembers(data.members || []);
            }
        } catch (error) {
            console.error('Failed to fetch receipts:', error);
        } finally {
            setLoading(false);
        }
    }, [groupId]);

    useEffect(() => {
        fetchReceipts();
    }, [fetchReceipts]);

    const filteredReceipts = useMemo(() => {
        return filterMember === 'all'
            ? receipts
            : receipts.filter((receipt) => receipt.payer.id === filterMember);
    }, [filterMember, receipts]);

    const groupedByDate = useMemo(() => {
        return filteredReceipts.reduce<Record<string, ReceiptEntry[]>>((acc, receipt) => {
            const dateKey = new Date(receipt.date).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
            });
            if (!acc[dateKey]) acc[dateKey] = [];
            acc[dateKey].push(receipt);
            return acc;
        }, {});
    }, [filteredReceipts]);

    const totalAmount = filteredReceipts.reduce((sum, receipt) => sum + receipt.amount, 0);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', paddingBottom: 'var(--space-8)' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <button
                    onClick={() => router.back()}
                    style={{
                        width: 42,
                        height: 42,
                        borderRadius: 'var(--radius-xl)',
                        background: 'var(--bg-glass)',
                        border: '1px solid var(--border-glass)',
                        color: 'var(--fg-secondary)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                    }}
                >
                    <ChevronLeft size={18} />
                </button>
            </div>

            <div className="page-hero" style={{ paddingTop: 0 }}>
                <div className="page-kicker">
                    <Receipt size={14} />
                    Receipt Gallery
                </div>
                <h1 className="page-hero-title" style={{ fontSize: 'clamp(2rem, 6vw, 2.9rem)' }}>
                    Every receipt, beautifully organized
                </h1>
                <p className="page-hero-subtitle">
                    Review captured bills, filter by member, and open any receipt in a clean full-screen preview tied to your group data.
                </p>
            </div>

            <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
            >
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: 'var(--space-3)',
                }}>
                    <MetricPanel label="Captured receipts" value={String(filteredReceipts.length)} />
                    <MetricPanel label="Visible total" value={formatCurrency(totalAmount)} accent="var(--accent-500)" />
                </div>
            </motion.div>

            <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.04 }}
            >
                <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'center',
                    gap: 'var(--space-2)',
                    padding: 'var(--space-3)',
                    borderRadius: 'var(--radius-2xl)',
                    background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.05), var(--bg-glass))',
                    border: '1px solid rgba(var(--accent-500-rgb), 0.08)',
                }}>
                    <FilterChip
                        active={filterMember === 'all'}
                        onClick={() => setFilterMember('all')}
                        label="All"
                    />
                    {members.map((member) => (
                        <FilterChip
                            key={member.id}
                            active={filterMember === member.id}
                            onClick={() => setFilterMember(member.id)}
                            label={member.name?.split(' ')[0] || 'Unknown'}
                            image={member.image}
                        />
                    ))}
                </div>
            </motion.div>

            {loading ? (
                <div style={{
                    minHeight: 280,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 'var(--space-3)',
                    textAlign: 'center',
                }}>
                    <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent-500)' }} />
                    <div className="font-display" style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>
                        Loading your receipts...
                    </div>
                </div>
            ) : filteredReceipts.length === 0 ? (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{
                        minHeight: 360,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textAlign: 'center',
                        gap: 'var(--space-3)',
                        padding: 'var(--space-8)',
                        borderRadius: 'var(--radius-3xl)',
                        background: 'linear-gradient(180deg, rgba(var(--accent-500-rgb), 0.05), transparent)',
                        border: '1px solid rgba(var(--accent-500-rgb), 0.08)',
                    }}
                >
                    <div style={{
                        width: 88,
                        height: 88,
                        borderRadius: 'var(--radius-3xl)',
                        background: 'rgba(var(--accent-500-rgb), 0.08)',
                        border: '1px solid rgba(var(--accent-500-rgb), 0.12)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}>
                        <ImageIcon size={38} style={{ color: 'var(--accent-500)' }} />
                    </div>
                    <div className="font-display" style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--fg-primary)' }}>
                        No receipts yet
                    </div>
                    <p className="page-hero-subtitle" style={{ maxWidth: 340 }}>
                        Scan receipts while adding expenses and SplitX will turn this page into a polished gallery for your group.
                    </p>
                </motion.div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                    {Object.entries(groupedByDate).map(([dateLabel, dateReceipts], groupIndex) => (
                        <motion.section
                            key={dateLabel}
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.3, delay: groupIndex * 0.04 }}
                            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                                <div style={{ flex: 1, height: 1, background: 'rgba(var(--accent-500-rgb), 0.08)' }} />
                                <div style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    padding: '8px 14px',
                                    borderRadius: 'var(--radius-full)',
                                    background: 'rgba(var(--accent-500-rgb), 0.06)',
                                    border: '1px solid rgba(var(--accent-500-rgb), 0.08)',
                                    color: 'var(--fg-secondary)',
                                    fontSize: 'var(--text-xs)',
                                    fontWeight: 700,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.06em',
                                }}>
                                    <Calendar size={12} />
                                    {dateLabel}
                                </div>
                                <div style={{ flex: 1, height: 1, background: 'rgba(var(--accent-500-rgb), 0.08)' }} />
                            </div>

                            <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
                                {dateReceipts.map((receipt, index) => (
                                    <motion.button
                                        key={receipt.id}
                                        initial={{ opacity: 0, y: 12 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.25, delay: index * 0.03 }}
                                        onClick={() => setSelectedReceipt(receipt)}
                                        whileTap={{ scale: 0.985 }}
                                        style={{
                                            width: '100%',
                                            display: 'grid',
                                            gridTemplateColumns: '92px 1fr auto',
                                            gap: 'var(--space-3)',
                                            alignItems: 'center',
                                            padding: 'var(--space-3)',
                                            borderRadius: 'var(--radius-3xl)',
                                            background: 'var(--bg-glass)',
                                            border: '1px solid var(--border-glass)',
                                            boxShadow: 'var(--shadow-card)',
                                            textAlign: 'left',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        <div style={{
                                            height: 116,
                                            borderRadius: 'var(--radius-2xl)',
                                            overflow: 'hidden',
                                            background: 'var(--bg-secondary)',
                                            border: '1px solid rgba(var(--accent-500-rgb), 0.08)',
                                            position: 'relative',
                                        }}>
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={receipt.receiptUrl}
                                                alt={receipt.title}
                                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                loading="lazy"
                                            />
                                            <div style={{
                                                position: 'absolute',
                                                right: 8,
                                                bottom: 8,
                                                width: 30,
                                                height: 30,
                                                borderRadius: '50%',
                                                background: 'rgba(255,255,255,0.85)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                color: 'var(--accent-500)',
                                            }}>
                                                <ZoomIn size={14} />
                                            </div>
                                        </div>

                                        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                            <div className="font-display" style={{
                                                fontSize: 'var(--text-xl)',
                                                fontWeight: 800,
                                                color: 'var(--fg-primary)',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                            }}>
                                                {receipt.title}
                                            </div>

                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                                <InfoPill label={CAT_EMOJI[receipt.category] || 'General'} />
                                                <InfoPill label={timeAgo(receipt.date)} />
                                            </div>

                                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--fg-secondary)', fontSize: 'var(--text-sm)' }}>
                                                <Avatar name={receipt.payer.name || 'U'} image={receipt.payer.image} size="xs" />
                                                <span>Paid by {receipt.payer.name?.split(' ')[0] || 'Unknown'}</span>
                                            </div>
                                        </div>

                                        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
                                            <div className="font-display" style={{
                                                fontSize: 'var(--text-2xl)',
                                                fontWeight: 800,
                                                color: 'var(--accent-500)',
                                                lineHeight: 1,
                                            }}>
                                                {formatCurrency(receipt.amount)}
                                            </div>
                                            <div style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: 6,
                                                fontSize: 'var(--text-xs)',
                                                color: 'var(--fg-tertiary)',
                                                fontWeight: 700,
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.06em',
                                            }}>
                                                Open
                                            </div>
                                        </div>
                                    </motion.button>
                                ))}
                            </div>
                        </motion.section>
                    ))}
                </div>
            )}

            {typeof document !== 'undefined' && createPortal(
                <AnimatePresence>
                    {selectedReceipt && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setSelectedReceipt(null)}
                            style={{
                                position: 'fixed',
                                inset: 0,
                                zIndex: 9999,
                                background: 'rgba(10, 10, 18, 0.88)',
                                backdropFilter: 'blur(16px)',
                                WebkitBackdropFilter: 'blur(16px)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: 20,
                            }}
                        >
                            <motion.div
                                initial={{ opacity: 0, scale: 0.92, y: 20 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.92, y: 20 }}
                                transition={{ type: 'spring', damping: 24, stiffness: 260 }}
                                onClick={(event) => event.stopPropagation()}
                                style={{
                                    width: 'min(92vw, 760px)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 'var(--space-3)',
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                    <button
                                        onClick={() => setSelectedReceipt(null)}
                                        style={{
                                            width: 42,
                                            height: 42,
                                            borderRadius: '50%',
                                            background: 'rgba(255,255,255,0.12)',
                                            border: '1px solid rgba(255,255,255,0.14)',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: '#fff',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        <X size={18} />
                                    </button>
                                </div>

                                <div style={{
                                    borderRadius: 'var(--radius-3xl)',
                                    overflow: 'hidden',
                                    background: '#fff',
                                    boxShadow: '0 30px 80px rgba(0,0,0,0.4)',
                                }}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={selectedReceipt.receiptUrl}
                                        alt={selectedReceipt.title}
                                        style={{
                                            width: '100%',
                                            maxHeight: '62vh',
                                            objectFit: 'contain',
                                            background: '#fff',
                                        }}
                                    />
                                </div>

                                <div style={{
                                    padding: '18px 22px',
                                    borderRadius: 'var(--radius-3xl)',
                                    background: 'rgba(255,255,255,0.1)',
                                    border: '1px solid rgba(255,255,255,0.14)',
                                    color: '#fff',
                                    backdropFilter: 'blur(22px)',
                                    WebkitBackdropFilter: 'blur(22px)',
                                    display: 'grid',
                                    gap: 'var(--space-2)',
                                }}>
                                    <div className="font-display" style={{ fontSize: 'var(--text-2xl)', fontWeight: 800 }}>
                                        {selectedReceipt.title}
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10, fontSize: 'var(--text-sm)' }}>
                                        <OverlayMeta icon={<Calendar size={13} />} text={new Date(selectedReceipt.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} />
                                        <OverlayMeta icon={<User size={13} />} text={selectedReceipt.payer.name || 'Unknown'} />
                                        <OverlayMeta icon={<Tag size={13} />} text={selectedReceipt.category} />
                                    </div>
                                    <div className="font-display" style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: '#fda4af', textAlign: 'center' }}>
                                        {formatCurrency(selectedReceipt.amount)}
                                    </div>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>,
                document.body,
            )}
        </div>
    );
}

function MetricPanel({
    label,
    value,
    accent,
}: {
    label: string;
    value: string;
    accent?: string;
}) {
    return (
        <div style={{
            padding: '18px 16px',
            borderRadius: 'var(--radius-2xl)',
            background: 'var(--bg-glass)',
            border: '1px solid var(--border-glass)',
            textAlign: 'center',
        }}>
            <div style={{ fontSize: '11px', color: 'var(--fg-tertiary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                {label}
            </div>
            <div className="font-display" style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: accent || 'var(--fg-primary)' }}>
                {value}
            </div>
        </div>
    );
}

function FilterChip({
    active,
    onClick,
    label,
    image,
}: {
    active: boolean;
    onClick: () => void;
    label: string;
    image?: string | null;
}) {
    return (
        <button
            onClick={onClick}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: image ? '6px 14px 6px 6px' : '8px 14px',
                borderRadius: 'var(--radius-full)',
                border: `1px solid ${active ? 'rgba(var(--accent-500-rgb), 0.24)' : 'var(--border-glass)'}`,
                background: active ? 'rgba(var(--accent-500-rgb), 0.12)' : 'var(--bg-glass)',
                color: active ? 'var(--accent-500)' : 'var(--fg-secondary)',
                fontSize: 'var(--text-sm)',
                fontWeight: 700,
                cursor: 'pointer',
            }}
        >
            {image && <Avatar name={label} image={image} size="xs" />}
            <span>{label}</span>
        </button>
    );
}

function InfoPill({ label }: { label: string }) {
    return (
        <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '6px 10px',
            borderRadius: 'var(--radius-full)',
            background: 'rgba(var(--accent-500-rgb), 0.06)',
            border: '1px solid rgba(var(--accent-500-rgb), 0.08)',
            fontSize: 'var(--text-xs)',
            color: 'var(--fg-tertiary)',
            fontWeight: 700,
        }}>
            {label}
        </span>
    );
}

function OverlayMeta({
    icon,
    text,
}: {
    icon: ReactNode;
    text: string;
}) {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: 0.85 }}>
            {icon}
            {text}
        </span>
    );
}
