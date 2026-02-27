'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowLeft, X, Send, Sparkles, Bot, User,
    TrendingUp, Users, Wallet, Receipt, HelpCircle, Zap,
} from 'lucide-react';
import { isFeatureEnabled } from '@/lib/featureFlags';

interface ChatMsg {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

const QUICK_ACTIONS = [
    { icon: <Wallet size={16} />, label: 'Who owes me?', query: 'Who owes me?', gradient: 'linear-gradient(135deg, #10b981, #059669)' },
    { icon: <TrendingUp size={16} />, label: 'My spending', query: 'My spending breakdown', gradient: 'linear-gradient(135deg, #8b5cf6, #7c3aed)' },
    { icon: <Receipt size={16} />, label: 'My balance', query: 'Show my balance summary', gradient: 'linear-gradient(135deg, #3b82f6, #2563eb)' },
    { icon: <Users size={16} />, label: 'My groups', query: 'My groups', gradient: 'linear-gradient(135deg, #f59e0b, #d97706)' },
    { icon: <Zap size={16} />, label: 'Recent activity', query: 'Recent transactions', gradient: 'linear-gradient(135deg, #ec4899, #db2777)' },
    { icon: <HelpCircle size={16} />, label: 'Settle up', query: 'How to settle up?', gradient: 'linear-gradient(135deg, #06b6d4, #0891b2)' },
];

const FOLLOW_UPS = [
    { label: '💰 Who owes me?', query: 'Who owes me?' },
    { label: '📊 My balance', query: 'Show my balance' },
    { label: '💱 Settle up', query: 'How to settle up?' },
    { label: '🧾 Recent', query: 'Recent transactions' },
];

/** Render markdown-like formatting for AI responses */
function FormattedMessage({ content }: { content: string }) {
    const lines = content.split('\n');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {lines.map((line, i) => {
                // Bold text: **text**
                const renderBold = (text: string) => {
                    return text.split(/(\*\*.*?\*\*)/g).map((part, j) => {
                        if (part.startsWith('**') && part.endsWith('**')) {
                            return (
                                <span key={j} style={{
                                    fontWeight: 700,
                                    color: 'var(--fg-primary)',
                                }}>{part.slice(2, -2)}</span>
                            );
                        }
                        return <span key={j}>{part}</span>;
                    });
                };

                // Bullet points
                if (line.trimStart().startsWith('•') || line.trimStart().startsWith('- ')) {
                    const text = line.replace(/^\s*[•\-]\s*/, '');
                    return (
                        <div key={i} style={{
                            display: 'flex',
                            gap: 6,
                            paddingLeft: 2,
                            marginTop: 1,
                        }}>
                            <span style={{
                                color: 'var(--accent-400)',
                                flexShrink: 0,
                                fontSize: 10,
                                marginTop: 2,
                            }}>●</span>
                            <span style={{ flex: 1 }}>{renderBold(text)}</span>
                        </div>
                    );
                }

                // Empty line → spacer
                if (line.trim() === '') {
                    return <div key={i} style={{ height: 5 }} />;
                }

                return <div key={i}>{renderBold(line)}</div>;
            })}
        </div>
    );
}

export default function AIChatPanel() {
    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMsg[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [mounted, setMounted] = useState(false);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => { setMounted(true); }, []);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        if (open && inputRef.current) {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [open]);

    const sendMessage = useCallback(async (text: string) => {
        if (!text.trim() || loading) return;

        const userMsg: ChatMsg = {
            id: Date.now().toString(),
            role: 'user',
            content: text.trim(),
        };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setLoading(true);

        try {
            const res = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text.trim() }),
            });
            const data = await res.json();
            setMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: data.reply || data.error || 'Something went wrong.',
            }]);
        } catch {
            setMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: 'Network error. Please try again.',
            }]);
        } finally {
            setLoading(false);
        }
    }, [loading]);

    const clearChat = useCallback(() => {
        setMessages([]);
    }, []);

    if (!isFeatureEnabled('aiChat') || !mounted) return null;

    const hasMessages = messages.length > 0;

    return (
        <>
            {/* ── Floating Action Button ── */}
            <AnimatePresence>
                {!open && (
                    <motion.button
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                        onClick={() => setOpen(true)}
                        whileTap={{ scale: 0.9 }}
                        whileHover={{ scale: 1.08 }}
                        aria-label="AI Assistant"
                        style={{
                            position: 'fixed',
                            bottom: 88,
                            right: 20,
                            width: 52,
                            height: 52,
                            borderRadius: '50%',
                            background: 'linear-gradient(135deg, #10b981 0%, #059669 50%, #047857 100%)',
                            border: 'none',
                            color: '#fff',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 4px 24px rgba(16, 185, 129, 0.45), 0 0 0 4px rgba(16, 185, 129, 0.1)',
                            zIndex: 90,
                        }}
                    >
                        <Sparkles size={22} />
                    </motion.button>
                )}
            </AnimatePresence>

            {/* ── Chat Panel ── */}
            <AnimatePresence>
                {open && (
                    <motion.div
                        ref={panelRef}
                        initial={{ opacity: 0, y: 50, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 50, scale: 0.9 }}
                        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                        style={{
                            position: 'fixed',
                            bottom: 88,
                            left: 0,
                            right: 0,
                            margin: '0 auto',
                            width: 380,
                            maxWidth: 'calc(100vw - 20px)',
                            height: 540,
                            maxHeight: 'calc(100vh - 140px)',
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-glass)',
                            borderRadius: 24,
                            boxShadow: '0 24px 64px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255,255,255,0.05)',
                            zIndex: 95,
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden',
                        }}
                    >
                        {/* ── Premium Header with Gradient ── */}
                        <div style={{
                            position: 'relative',
                            padding: '16px 16px 14px',
                            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(5, 150, 105, 0.04) 100%)',
                            borderBottom: '1px solid rgba(16, 185, 129, 0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                        }}>
                            {/* Back button when in chat */}
                            {hasMessages && (
                                <motion.button
                                    initial={{ opacity: 0, x: -8 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    onClick={clearChat}
                                    whileTap={{ scale: 0.9 }}
                                    title="Back to home"
                                    style={{
                                        width: 30,
                                        height: 30,
                                        borderRadius: 10,
                                        background: 'rgba(16, 185, 129, 0.1)',
                                        border: '1px solid rgba(16, 185, 129, 0.15)',
                                        color: '#10b981',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0,
                                    }}
                                >
                                    <ArrowLeft size={15} />
                                </motion.button>
                            )}

                            {/* AI Icon */}
                            <div style={{
                                width: 36,
                                height: 36,
                                borderRadius: 12,
                                background: 'linear-gradient(135deg, #10b981, #059669)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#fff',
                                flexShrink: 0,
                                boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)',
                            }}>
                                <Sparkles size={18} />
                            </div>

                            <div style={{ flex: 1, minWidth: 0 }}>
                                <h3 style={{
                                    fontSize: 15,
                                    fontWeight: 800,
                                    color: 'var(--fg-primary)',
                                    letterSpacing: '-0.02em',
                                }}>
                                    SplitX AI
                                </h3>
                                <p style={{
                                    fontSize: 11,
                                    color: '#10b981',
                                    fontWeight: 500,
                                    marginTop: 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 4,
                                }}>
                                    <span style={{
                                        width: 6,
                                        height: 6,
                                        borderRadius: '50%',
                                        background: '#10b981',
                                        display: 'inline-block',
                                        boxShadow: '0 0 6px rgba(16, 185, 129, 0.5)',
                                    }} />
                                    {hasMessages ? 'Analyzing your data' : 'Online — ready to help'}
                                </p>
                            </div>

                            <button
                                onClick={() => setOpen(false)}
                                style={{
                                    width: 30,
                                    height: 30,
                                    borderRadius: 10,
                                    background: 'rgba(var(--fg-primary-rgb, 0,0,0), 0.05)',
                                    border: 'none',
                                    color: 'var(--fg-tertiary)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* ── Chat Body ── */}
                        <div style={{
                            flex: 1,
                            overflowY: 'auto',
                            padding: '10px 12px 6px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 10,
                        }}>
                            {/* ── Empty State: Welcome + Action Grid ── */}
                            {!hasMessages && (
                                <div style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    flex: 1,
                                    gap: 12,
                                    justifyContent: 'center',
                                }}>
                                    {/* Welcome text */}
                                    <div style={{
                                        textAlign: 'center',
                                        padding: '0 12px',
                                    }}>
                                        <div style={{
                                            fontSize: 24,
                                            marginBottom: 4,
                                        }}>✨</div>
                                        <h2 style={{
                                            fontSize: 15,
                                            fontWeight: 800,
                                            color: 'var(--fg-primary)',
                                            marginBottom: 3,
                                            letterSpacing: '-0.02em',
                                        }}>
                                            How can I help?
                                        </h2>
                                        <p style={{
                                            fontSize: 11,
                                            color: 'var(--fg-tertiary)',
                                            lineHeight: 1.4,
                                            maxWidth: 240,
                                            margin: '0 auto',
                                        }}>
                                            I know your balances, spending, debts, and groups in real-time.
                                        </p>
                                    </div>

                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: '1fr 1fr',
                                        gap: 6,
                                        padding: '0 4px',
                                    }}>
                                        {QUICK_ACTIONS.map((action) => (
                                            <motion.button
                                                key={action.label}
                                                onClick={() => sendMessage(action.query)}
                                                whileTap={{ scale: 0.96 }}
                                                whileHover={{ scale: 1.02 }}
                                                style={{
                                                    padding: '10px 8px 8px',
                                                    borderRadius: 12,
                                                    background: 'var(--bg-secondary)',
                                                    border: '1px solid var(--border-subtle)',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    alignItems: 'center',
                                                    gap: 5,
                                                    textAlign: 'center',
                                                    transition: 'all 0.2s ease',
                                                }}
                                            >
                                                <div style={{
                                                    width: 30,
                                                    height: 30,
                                                    borderRadius: 10,
                                                    background: action.gradient,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    color: '#fff',
                                                }}>
                                                    {action.icon}
                                                </div>
                                                <span style={{
                                                    fontSize: 11,
                                                    fontWeight: 600,
                                                    color: 'var(--fg-secondary)',
                                                    lineHeight: 1.2,
                                                }}>
                                                    {action.label}
                                                </span>
                                            </motion.button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* ── Messages ── */}
                            {messages.map((msg) => (
                                <motion.div
                                    key={msg.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.2 }}
                                    style={{
                                        display: 'flex',
                                        gap: 8,
                                        alignItems: 'flex-start',
                                        flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                                    }}
                                >
                                    {/* Avatar */}
                                    <div style={{
                                        width: 28,
                                        height: 28,
                                        borderRadius: msg.role === 'user' ? 10 : 10,
                                        background: msg.role === 'user'
                                            ? 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.15), rgba(var(--accent-500-rgb), 0.08))'
                                            : 'linear-gradient(135deg, #10b981, #059669)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0,
                                        color: msg.role === 'user' ? 'var(--accent-400)' : '#fff',
                                        marginTop: 2,
                                    }}>
                                        {msg.role === 'user' ? <User size={13} /> : <Bot size={13} />}
                                    </div>

                                    {/* Bubble */}
                                    <div style={{
                                        maxWidth: '82%',
                                        padding: msg.role === 'assistant' ? '10px 13px' : '9px 14px',
                                        borderRadius: msg.role === 'user'
                                            ? '16px 4px 16px 16px'
                                            : '4px 16px 16px 16px',
                                        background: msg.role === 'user'
                                            ? 'linear-gradient(135deg, var(--accent-500), var(--accent-600, var(--accent-500)))'
                                            : 'var(--bg-secondary)',
                                        border: msg.role === 'user'
                                            ? 'none'
                                            : '1px solid var(--border-subtle)',
                                        fontSize: 12.5,
                                        color: msg.role === 'user' ? '#fff' : 'var(--fg-secondary)',
                                        lineHeight: 1.55,
                                        boxShadow: msg.role === 'user'
                                            ? '0 2px 8px rgba(var(--accent-500-rgb), 0.2)'
                                            : 'none',
                                    }}>
                                        {msg.role === 'assistant'
                                            ? <FormattedMessage content={msg.content} />
                                            : msg.content
                                        }
                                    </div>
                                </motion.div>
                            ))}

                            {/* Loading indicator */}
                            {loading && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    style={{
                                        display: 'flex',
                                        gap: 8,
                                        alignItems: 'flex-start',
                                    }}
                                >
                                    <div style={{
                                        width: 28,
                                        height: 28,
                                        borderRadius: 10,
                                        background: 'linear-gradient(135deg, #10b981, #059669)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: '#fff',
                                        flexShrink: 0,
                                    }}>
                                        <Bot size={13} />
                                    </div>
                                    <div style={{
                                        padding: '10px 14px',
                                        borderRadius: '4px 16px 16px 16px',
                                        background: 'var(--bg-secondary)',
                                        border: '1px solid var(--border-subtle)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                    }}>
                                        {/* Animated dots */}
                                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                            {[0, 1, 2].map(i => (
                                                <motion.div
                                                    key={i}
                                                    animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1, 0.8] }}
                                                    transition={{
                                                        duration: 1.2,
                                                        repeat: Infinity,
                                                        delay: i * 0.2,
                                                    }}
                                                    style={{
                                                        width: 6,
                                                        height: 6,
                                                        borderRadius: '50%',
                                                        background: '#10b981',
                                                    }}
                                                />
                                            ))}
                                        </div>
                                        <span style={{
                                            fontSize: 11,
                                            color: 'var(--fg-muted)',
                                            fontWeight: 500,
                                        }}>
                                            Thinking...
                                        </span>
                                    </div>
                                </motion.div>
                            )}

                            <div ref={chatEndRef} />
                        </div>

                        {/* ── Follow-up Chips (during chat) ── */}
                        {hasMessages && !loading && (
                            <motion.div
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                style={{
                                    padding: '4px 12px 2px',
                                    display: 'flex',
                                    gap: 6,
                                    overflowX: 'auto',
                                    flexShrink: 0,
                                    msOverflowStyle: 'none',
                                    scrollbarWidth: 'none',
                                }}
                            >
                                {FOLLOW_UPS.map(q => (
                                    <motion.button
                                        key={q.label}
                                        onClick={() => sendMessage(q.query)}
                                        whileTap={{ scale: 0.95 }}
                                        style={{
                                            padding: '5px 10px',
                                            borderRadius: 20,
                                            background: 'rgba(16, 185, 129, 0.06)',
                                            border: '1px solid rgba(16, 185, 129, 0.12)',
                                            color: '#10b981',
                                            fontSize: 11,
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            whiteSpace: 'nowrap',
                                            flexShrink: 0,
                                            transition: 'all 0.15s',
                                        }}
                                    >
                                        {q.label}
                                    </motion.button>
                                ))}
                            </motion.div>
                        )}

                        {/* ── Input Area ── */}
                        <div style={{
                            padding: '8px 12px 12px',
                            borderTop: '1px solid var(--border-subtle)',
                            display: 'flex',
                            gap: 8,
                            alignItems: 'center',
                            background: 'var(--bg-primary)',
                        }}>
                            <input
                                ref={inputRef}
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        sendMessage(input);
                                    }
                                }}
                                placeholder="Ask anything about your finances..."
                                style={{
                                    flex: 1,
                                    padding: '10px 16px',
                                    borderRadius: 14,
                                    background: 'var(--bg-secondary)',
                                    border: '1.5px solid var(--border-subtle)',
                                    color: 'var(--fg-primary)',
                                    fontSize: 13,
                                    fontWeight: 500,
                                    outline: 'none',
                                    transition: 'border-color 0.2s, box-shadow 0.2s',
                                }}
                                onFocus={(e) => {
                                    e.currentTarget.style.borderColor = '#10b981';
                                    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.1)';
                                }}
                                onBlur={(e) => {
                                    e.currentTarget.style.borderColor = 'var(--border-subtle)';
                                    e.currentTarget.style.boxShadow = 'none';
                                }}
                            />
                            <motion.button
                                onClick={() => sendMessage(input)}
                                disabled={!input.trim() || loading}
                                whileTap={{ scale: 0.9 }}
                                style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: 12,
                                    background: input.trim()
                                        ? 'linear-gradient(135deg, #10b981, #059669)'
                                        : 'var(--bg-secondary)',
                                    border: input.trim()
                                        ? 'none'
                                        : '1px solid var(--border-subtle)',
                                    color: input.trim() ? '#fff' : 'var(--fg-muted)',
                                    cursor: input.trim() ? 'pointer' : 'default',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                    transition: 'all 0.2s',
                                    boxShadow: input.trim()
                                        ? '0 2px 8px rgba(16, 185, 129, 0.3)'
                                        : 'none',
                                }}
                            >
                                <Send size={17} />
                            </motion.button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
