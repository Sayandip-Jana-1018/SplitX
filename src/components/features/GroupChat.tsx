'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Send, Bell, Loader2, Receipt, ArrowRightLeft,
    MessageCircle, AlertCircle, CreditCard, Sparkles,
    ChevronDown,
} from 'lucide-react';
import { formatCurrency, timeAgo } from '@/lib/utils';
import Avatar from '@/components/ui/Avatar';

interface MessageData {
    id: string;
    content: string;
    type: string;
    createdAt: string;
    sender: {
        id: string;
        name: string | null;
        image: string | null;
    };
    settlement?: {
        id: string;
        amount: number;
        status: string;
        from: { id: string; name: string | null };
        to: { id: string; name: string | null };
    } | null;
    transaction?: {
        id: string;
        title: string;
        amount: number;
        category: string;
    } | null;
}

interface MemberInfo {
    userId: string;
    role: string;
    user: {
        id: string;
        name: string | null;
        email: string | null;
        image: string | null;
    };
}

interface GroupChatProps {
    groupId: string;
    currentUserId: string;
    members: MemberInfo[];
    balances: Record<string, number>;
    onPayRequest?: (settlementId: string, amount: number, payeeName: string) => void;
}

/* ── Date separator helper ── */
function getDateLabel(dateStr: string): string {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const dayMs = 86400000;
    if (diff < dayMs && now.getDate() === d.getDate()) return 'Today';
    if (diff < 2 * dayMs) return 'Yesterday';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function shouldShowDateSep(msgs: MessageData[], i: number): boolean {
    if (i === 0) return true;
    const cur = new Date(msgs[i].createdAt).toDateString();
    const prev = new Date(msgs[i - 1].createdAt).toDateString();
    return cur !== prev;
}

export default function GroupChat({ groupId, currentUserId, members, balances, onPayRequest }: GroupChatProps) {
    const [messages, setMessages] = useState<MessageData[]>([]);
    const [loading, setLoading] = useState(true);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [showReminder, setShowReminder] = useState(false);
    const [sendingReminder, setSendingReminder] = useState<string | null>(null);
    const [inputFocused, setInputFocused] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const lastMessageId = useRef<string | null>(null);

    // Resolve current user's info from members for own-message avatars
    const currentUser = members.find(m => m.userId === currentUserId)?.user;

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    const fetchMessages = useCallback(async (initial = false) => {
        try {
            const url = `/api/groups/${groupId}/messages?limit=50`;
            const res = await fetch(url);
            if (!res.ok) return;
            const data = await res.json();

            if (data.messages && data.messages.length > 0) {
                const newLastId = data.messages[data.messages.length - 1]?.id;
                if (newLastId !== lastMessageId.current) {
                    setMessages(data.messages);
                    lastMessageId.current = newLastId;
                    if (initial) {
                        setTimeout(scrollToBottom, 100);
                    } else {
                        scrollToBottom();
                    }
                }
            } else if (initial) {
                setMessages([]);
            }
        } catch (err) {
            console.error('Failed to fetch messages:', err);
        } finally {
            if (initial) setLoading(false);
        }
    }, [groupId, scrollToBottom]);

    // Initial fetch + polling
    useEffect(() => {
        fetchMessages(true);
        const interval = setInterval(() => fetchMessages(false), 5000);
        return () => clearInterval(interval);
    }, [fetchMessages]);

    const sendMessage = async (content: string, type = 'text', extra: Record<string, string> = {}) => {
        if (!content.trim()) return;
        setSending(true);
        try {
            const res = await fetch(`/api/groups/${groupId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, type, ...extra }),
            });
            if (res.ok) {
                setInput('');
                await fetchMessages(false);
            }
        } catch (err) {
            console.error('Failed to send message:', err);
        } finally {
            setSending(false);
        }
    };

    const sendReminder = async (targetMember: MemberInfo) => {
        setSendingReminder(targetMember.userId);
        const owedAmount = -(balances[targetMember.userId] || 0);
        const content = `💸 Reminder: ${targetMember.user.name || 'You'} owe${owedAmount > 0 ? ` ${formatCurrency(owedAmount)}` : ''}. Please settle up!`;
        await sendMessage(content, 'payment_reminder', { targetUserId: targetMember.userId });
        setSendingReminder(null);
        setShowReminder(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(input);
        }
    };

    // Members who owe money (negative balance)
    const debtors = members.filter(m => (balances[m.userId] || 0) < 0 && m.userId !== currentUserId);

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: 'calc(100vh - 320px)',
            minHeight: 340,
            maxHeight: 560,
            borderRadius: 20,
            overflow: 'hidden',
            position: 'relative',
            background: 'var(--surface-primary)',
            border: '1px solid var(--border-glass, var(--border-primary))',
            boxShadow: '0 8px 32px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)',
        }}>

            {/* ── Messages Area ── */}
            <div
                ref={containerRef}
                style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '16px 16px 8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    scrollBehavior: 'smooth',
                }}
            >
                {loading ? (
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '100%',
                        gap: 12,
                    }}>
                        <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                        >
                            <Loader2 size={24} style={{ color: 'var(--accent-400)' }} />
                        </motion.div>
                        <span style={{ fontSize: 13, color: 'var(--fg-tertiary)', fontWeight: 500 }}>
                            Loading conversation…
                        </span>
                    </div>
                ) : messages.length === 0 ? (
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '100%',
                        gap: 12,
                        padding: '0 24px',
                    }}>
                        <div style={{
                            width: 64, height: 64, borderRadius: 20,
                            background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.1), rgba(var(--accent-500-rgb), 0.04))',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            border: '1px solid rgba(var(--accent-500-rgb), 0.1)',
                        }}>
                            <MessageCircle size={28} style={{ color: 'var(--accent-400)' }} />
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg-primary)', marginBottom: 4 }}>
                                Start the conversation
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--fg-tertiary)', lineHeight: 1.5 }}>
                                Say hello or send a payment reminder to get things going!
                            </div>
                        </div>
                    </div>
                ) : (
                    messages.map((msg, i) => {
                        const isOwn = msg.sender.id === currentUserId;
                        const showAvatar = !isOwn && (i === 0 || messages[i - 1]?.sender.id !== msg.sender.id);
                        const showOwnAvatar = isOwn && (i === 0 || messages[i - 1]?.sender.id !== msg.sender.id);
                        const isLastInGroup = i === messages.length - 1 || messages[i + 1]?.sender.id !== msg.sender.id;
                        const dateSep = shouldShowDateSep(messages, i);

                        return (
                            <div key={msg.id}>
                                {/* ── Date separator ── */}
                                {dateSep && (
                                    <div style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        margin: '14px 0 10px',
                                        gap: 12,
                                    }}>
                                        <div style={{ flex: 1, height: 1, background: 'var(--border-primary)', opacity: 0.5 }} />
                                        <span style={{
                                            fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                                            textTransform: 'uppercase',
                                            color: 'var(--fg-tertiary)',
                                            padding: '3px 10px',
                                            background: 'var(--surface-secondary)',
                                            borderRadius: 10,
                                            whiteSpace: 'nowrap',
                                        }}>
                                            {getDateLabel(msg.createdAt)}
                                        </span>
                                        <div style={{ flex: 1, height: 1, background: 'var(--border-primary)', opacity: 0.5 }} />
                                    </div>
                                )}

                                {/* ── System / Expense Messages ── */}
                                {(msg.type === 'system' || msg.type === 'expense_added') ? (
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'center',
                                            margin: '8px 0',
                                        }}
                                    >
                                        <div style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 6,
                                            background: msg.settlement
                                                ? 'rgba(16, 185, 129, 0.08)'
                                                : 'var(--surface-secondary)',
                                            borderRadius: 20,
                                            padding: '6px 14px',
                                            fontSize: 11,
                                            fontWeight: 500,
                                            color: msg.settlement
                                                ? 'var(--color-success)'
                                                : 'var(--fg-tertiary)',
                                            border: msg.settlement
                                                ? '1px solid rgba(16, 185, 129, 0.2)'
                                                : '1px solid var(--border-primary)',
                                        }}>
                                            {msg.type === 'expense_added' ? (
                                                <Receipt size={12} style={{ color: 'var(--accent-400)', flexShrink: 0 }} />
                                            ) : msg.settlement ? (
                                                <CreditCard size={12} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                                            ) : (
                                                <AlertCircle size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
                                            )}
                                            <span>{msg.content}</span>
                                        </div>
                                    </motion.div>

                                    /* ── Payment Reminder ── */
                                ) : msg.type === 'payment_reminder' ? (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        style={{
                                            margin: '8px 0',
                                            borderRadius: 16,
                                            overflow: 'hidden',
                                            border: '1px solid rgba(251,191,36,0.2)',
                                        }}
                                    >
                                        {/* Reminder header strip */}
                                        <div style={{
                                            background: 'linear-gradient(135deg, rgba(251,191,36,0.12), rgba(245,158,11,0.06))',
                                            padding: '10px 14px',
                                            display: 'flex', alignItems: 'center', gap: 8,
                                        }}>
                                            <div style={{
                                                width: 28, height: 28, borderRadius: 8,
                                                background: 'rgba(251,191,36,0.15)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                flexShrink: 0,
                                            }}>
                                                <Bell size={14} style={{ color: '#f59e0b' }} />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <div style={{
                                                    fontSize: 12, fontWeight: 700,
                                                    color: 'var(--fg-primary)',
                                                }}>
                                                    {msg.sender.name}
                                                </div>
                                                <div style={{ fontSize: 10, color: 'var(--fg-tertiary)' }}>
                                                    {timeAgo(msg.createdAt)}
                                                </div>
                                            </div>
                                        </div>
                                        {/* Reminder content */}
                                        <div style={{
                                            padding: '10px 14px',
                                            fontSize: 13, lineHeight: 1.5,
                                            color: 'var(--fg-primary)',
                                            background: 'var(--surface-primary)',
                                        }}>
                                            {msg.content}
                                        </div>
                                        {msg.settlement && msg.settlement.to.id === currentUserId && (
                                            <div style={{
                                                padding: '8px 14px 12px',
                                                background: 'var(--surface-primary)',
                                            }}>
                                                <motion.button
                                                    whileHover={{ scale: 1.02 }}
                                                    whileTap={{ scale: 0.97 }}
                                                    onClick={() => onPayRequest?.(msg.settlement!.id, msg.settlement!.amount, msg.settlement!.from.name || 'Someone')}
                                                    style={{
                                                        padding: '8px 18px',
                                                        background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                                                        color: '#fff',
                                                        border: 'none',
                                                        borderRadius: 10,
                                                        fontSize: 12,
                                                        fontWeight: 700,
                                                        cursor: 'pointer',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: 6,
                                                        boxShadow: '0 4px 12px rgba(var(--accent-500-rgb), 0.3)',
                                                    }}
                                                >
                                                    <CreditCard size={13} />
                                                    Pay Now
                                                </motion.button>
                                            </div>
                                        )}
                                    </motion.div>

                                    /* ── Normal Text Messages ── */
                                ) : (
                                    <motion.div
                                        initial={{ opacity: 0, y: 6, scale: 0.98 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        transition={{ duration: 0.2, ease: 'easeOut' }}
                                        style={{
                                            display: 'flex',
                                            flexDirection: isOwn ? 'row-reverse' : 'row',
                                            alignItems: 'flex-end',
                                            gap: 8,
                                            marginLeft: isOwn ? 'auto' : 0,
                                            marginRight: isOwn ? 0 : 'auto',
                                            maxWidth: '78%',
                                            marginTop: showAvatar ? 10 : 2,
                                            marginBottom: isLastInGroup ? 4 : 1,
                                        }}
                                    >
                                        {/* Avatar — left for others, right for own */}
                                        {!isOwn && showAvatar ? (
                                            <div style={{ flexShrink: 0, marginBottom: 2 }}>
                                                <Avatar name={msg.sender.name || '?'} image={msg.sender.image} size="xs" />
                                            </div>
                                        ) : !isOwn ? (
                                            <div style={{ width: 24, flexShrink: 0 }} />
                                        ) : isOwn && showOwnAvatar ? (
                                            <div style={{ flexShrink: 0, marginBottom: 2 }}>
                                                <Avatar name={currentUser?.name || msg.sender.name || '?'} image={currentUser?.image || msg.sender.image} size="xs" />
                                            </div>
                                        ) : isOwn ? (
                                            <div style={{ width: 24, flexShrink: 0 }} />
                                        ) : null}

                                        {/* Bubble */}
                                        <div style={{
                                            position: 'relative',
                                        }}>
                                            {/* Sender name for others */}
                                            {!isOwn && showAvatar && (
                                                <div style={{
                                                    fontSize: 11,
                                                    fontWeight: 700,
                                                    color: 'var(--accent-500)',
                                                    marginBottom: 3,
                                                    marginLeft: 4,
                                                }}>
                                                    {msg.sender.name}
                                                </div>
                                            )}
                                            <div style={{
                                                background: isOwn
                                                    ? 'linear-gradient(135deg, var(--accent-500), var(--accent-600))'
                                                    : 'var(--surface-secondary)',
                                                color: isOwn ? '#fff' : 'var(--fg-primary)',
                                                padding: '10px 14px',
                                                borderRadius: isOwn
                                                    ? (isLastInGroup ? '18px 18px 4px 18px' : '18px 4px 4px 18px')
                                                    : (isLastInGroup ? '18px 18px 18px 4px' : '18px 18px 4px 4px'),
                                                fontSize: 13.5,
                                                lineHeight: 1.45,
                                                wordBreak: 'break-word',
                                                boxShadow: isOwn
                                                    ? '0 2px 12px rgba(var(--accent-500-rgb), 0.25)'
                                                    : '0 1px 4px rgba(0,0,0,0.04)',
                                                border: isOwn ? 'none' : '1px solid var(--border-primary)',
                                            }}>
                                                {msg.content}
                                            </div>
                                            {/* Timestamp — shown for last message in group */}
                                            {isLastInGroup && (
                                                <div style={{
                                                    fontSize: 10,
                                                    color: 'var(--fg-tertiary)',
                                                    marginTop: 3,
                                                    textAlign: isOwn ? 'right' : 'left',
                                                    paddingLeft: isOwn ? 0 : 4,
                                                    paddingRight: isOwn ? 4 : 0,
                                                    opacity: 0.7,
                                                }}>
                                                    {timeAgo(msg.createdAt)}
                                                </div>
                                            )}
                                        </div>
                                    </motion.div>
                                )}
                            </div>
                        );
                    })
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* ── Reminder Panel ── */}
            <AnimatePresence>
                {showReminder && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        style={{
                            overflow: 'hidden',
                            borderTop: '1px solid var(--border-primary)',
                            background: 'var(--surface-secondary)',
                        }}
                    >
                        <div style={{ padding: '12px 16px' }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                marginBottom: 10,
                            }}>
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 6,
                                }}>
                                    <Bell size={13} style={{ color: '#f59e0b' }} />
                                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-primary)' }}>
                                        Send Reminder
                                    </span>
                                </div>
                                <button
                                    onClick={() => setShowReminder(false)}
                                    style={{
                                        background: 'none', border: 'none', cursor: 'pointer',
                                        color: 'var(--fg-tertiary)', padding: 2,
                                        display: 'flex', alignItems: 'center',
                                    }}
                                >
                                    <ChevronDown size={16} />
                                </button>
                            </div>
                            {debtors.length === 0 ? (
                                <div style={{
                                    fontSize: 12, color: 'var(--fg-tertiary)',
                                    padding: '12px 0', textAlign: 'center',
                                }}>
                                    Everyone is settled up 🎉
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {debtors.map(m => (
                                        <motion.button
                                            key={m.userId}
                                            whileHover={{ scale: 1.01 }}
                                            whileTap={{ scale: 0.98 }}
                                            onClick={() => sendReminder(m)}
                                            disabled={sendingReminder === m.userId}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 10,
                                                padding: '10px 12px',
                                                background: 'var(--surface-primary)',
                                                border: '1px solid var(--border-primary)',
                                                borderRadius: 12,
                                                cursor: 'pointer',
                                                fontSize: 13,
                                                color: 'var(--fg-primary)',
                                                width: '100%',
                                                textAlign: 'left',
                                                transition: 'border-color 0.15s',
                                            }}
                                        >
                                            <Avatar name={m.user.name || '?'} image={m.user.image} size="xs" />
                                            <span style={{ flex: 1, fontWeight: 600 }}>{m.user.name}</span>
                                            <span style={{
                                                color: 'var(--color-error, #ef4444)',
                                                fontWeight: 700, fontSize: 12,
                                                background: 'rgba(239,68,68,0.08)',
                                                padding: '3px 8px',
                                                borderRadius: 8,
                                            }}>
                                                {formatCurrency(Math.abs(balances[m.userId] || 0))}
                                            </span>
                                            {sendingReminder === m.userId ? (
                                                <Loader2 size={14} className="spin" style={{ color: 'var(--accent-400)', flexShrink: 0 }} />
                                            ) : (
                                                <div style={{
                                                    width: 28, height: 28, borderRadius: 8,
                                                    background: 'rgba(251,191,36,0.1)',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    flexShrink: 0,
                                                }}>
                                                    <Bell size={13} style={{ color: '#f59e0b' }} />
                                                </div>
                                            )}
                                        </motion.button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Input Bar ── */}
            <div style={{
                borderTop: '1px solid var(--border-primary)',
                padding: '10px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'var(--surface-primary)',
            }}>
                {/* Remind toggle */}
                <motion.button
                    whileTap={{ scale: 0.92 }}
                    onClick={() => setShowReminder(!showReminder)}
                    style={{
                        background: showReminder
                            ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                            : 'var(--surface-secondary)',
                        color: showReminder ? '#fff' : 'var(--fg-secondary)',
                        border: showReminder ? 'none' : '1px solid var(--border-primary)',
                        borderRadius: 12,
                        padding: '8px 12px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        fontSize: 11,
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        transition: 'all 0.2s ease',
                        boxShadow: showReminder ? '0 3px 10px rgba(245,158,11,0.3)' : 'none',
                    }}
                >
                    <Bell size={13} />
                    Remind
                </motion.button>

                {/* Message input */}
                <div style={{
                    flex: 1,
                    position: 'relative',
                    borderRadius: 14,
                    background: 'var(--surface-secondary)',
                    border: inputFocused
                        ? '1.5px solid var(--accent-400)'
                        : '1px solid var(--border-primary)',
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                    boxShadow: inputFocused ? '0 0 0 3px rgba(var(--accent-500-rgb), 0.08)' : 'none',
                    overflow: 'hidden',
                }}>
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Type a message…"
                        disabled={sending}
                        onFocus={() => setInputFocused(true)}
                        onBlur={() => setInputFocused(false)}
                        style={{
                            width: '100%',
                            background: 'transparent',
                            border: 'none',
                            padding: '10px 14px',
                            fontSize: 13.5,
                            color: 'var(--fg-primary)',
                            outline: 'none',
                        }}
                    />
                </div>

                {/* Send button */}
                <motion.button
                    onClick={() => sendMessage(input)}
                    disabled={!input.trim() || sending}
                    whileTap={{ scale: 0.88 }}
                    whileHover={input.trim() ? { scale: 1.05 } : {}}
                    style={{
                        background: input.trim()
                            ? 'linear-gradient(135deg, var(--accent-500), var(--accent-600))'
                            : 'var(--surface-secondary)',
                        color: input.trim() ? '#fff' : 'var(--fg-tertiary)',
                        border: input.trim() ? 'none' : '1px solid var(--border-primary)',
                        borderRadius: 12,
                        width: 40,
                        height: 40,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: input.trim() ? 'pointer' : 'default',
                        flexShrink: 0,
                        transition: 'all 0.2s ease',
                        boxShadow: input.trim()
                            ? '0 4px 14px rgba(var(--accent-500-rgb), 0.3)'
                            : 'none',
                    }}
                >
                    {sending ? (
                        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}>
                            <Loader2 size={16} />
                        </motion.div>
                    ) : (
                        <Send size={16} style={{ transform: 'translateX(1px)' }} />
                    )}
                </motion.button>
            </div>
        </div>
    );
}
