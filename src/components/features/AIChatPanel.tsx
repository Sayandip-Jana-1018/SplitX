'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useDragControls, type PanInfo } from 'framer-motion';
import {
    ArrowUp,
    Bot,
    HelpCircle,
    Receipt,
    RotateCcw,
    Sparkles,
    TrendingUp,
    Users,
    Wallet,
    X,
    Zap,
} from 'lucide-react';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { useIsClient, useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';
import styles from './assistant.module.css';

interface ChatMsg {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

const SUGGESTIONS = [
    { icon: <Wallet size={16} />, label: 'Who owes me?', query: 'Who owes me?' },
    { icon: <TrendingUp size={16} />, label: 'My spending', query: 'My spending breakdown' },
    { icon: <Receipt size={16} />, label: 'Balance summary', query: 'Show my balance summary' },
    { icon: <Users size={16} />, label: 'My groups', query: 'My groups' },
    { icon: <Zap size={16} />, label: 'Recent activity', query: 'Recent transactions' },
    { icon: <HelpCircle size={16} />, label: 'How to settle', query: 'How to settle up?' },
];

const FOLLOW_UPS = [
    { label: 'Who owes me?', query: 'Who owes me?' },
    { label: 'My balance', query: 'Show my balance' },
    { label: 'Settle up', query: 'How to settle up?' },
    { label: 'Recent', query: 'Recent transactions' },
];

function renderBold(text: string) {
    return text.split(/(\*\*.*?\*\*)/g).map((part, index) =>
        part.startsWith('**') && part.endsWith('**')
            ? <strong key={index} className={styles.fmtStrong}>{part.slice(2, -2)}</strong>
            : <span key={index}>{part}</span>
    );
}

/** Lightweight markdown-ish renderer for assistant replies. */
function FormattedMessage({ content }: { content: string }) {
    return (
        <div>
            {content.split('\n').map((line, index) => {
                const trimmed = line.trimStart();
                if (trimmed.startsWith('•') || trimmed.startsWith('- ')) {
                    return (
                        <div key={index} className={cn(styles.fmtLine, styles.fmtBullet)}>
                            <span className={styles.fmtDot} />
                            <span>{renderBold(line.replace(/^\s*[•-]\s*/, ''))}</span>
                        </div>
                    );
                }
                if (!line.trim()) return <div key={index} className={styles.fmtSpacer} />;
                return <div key={index} className={styles.fmtLine}>{renderBold(line)}</div>;
            })}
        </div>
    );
}

let messageCounter = 0;
const nextMessageId = () => {
    messageCounter += 1;
    return `msg-${messageCounter}`;
};

export default function AIChatPanel({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const [messages, setMessages] = useState<ChatMsg[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const mounted = useIsClient();
    const isSheet = useMediaQuery('(max-width: 639px)');
    const endRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const dragControls = useDragControls();

    const close = useCallback(() => onOpenChange(false), [onOpenChange]);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [messages, loading]);

    useEffect(() => {
        if (!open) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const focusTimer = isSheet ? 0 : window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 240);
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') close();
        };
        window.addEventListener('keydown', onKey);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.clearTimeout(focusTimer);
            window.removeEventListener('keydown', onKey);
        };
    }, [open, close, isSheet]);

    const sendMessage = useCallback(async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed || loading) return;

        setMessages((previous) => [...previous, { id: nextMessageId(), role: 'user', content: trimmed }]);
        setInput('');
        setLoading(true);

        try {
            const response = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: trimmed }),
            });
            const data = await response.json();
            setMessages((previous) => [...previous, {
                id: nextMessageId(),
                role: 'assistant',
                content: data.reply || data.error || 'Something went wrong.',
            }]);
        } catch {
            setMessages((previous) => [...previous, {
                id: nextMessageId(),
                role: 'assistant',
                content: 'I could not reach the network. Please try again.',
            }]);
        } finally {
            setLoading(false);
        }
    }, [loading]);

    const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        if (info.offset.y > 120 || info.velocity.y > 650) close();
    };

    const startDrag = (event: React.PointerEvent) => {
        if (isSheet) dragControls.start(event);
    };

    if (!isFeatureEnabled('aiChat') || !mounted) return null;

    const hasMessages = messages.length > 0;

    return createPortal(
        <AnimatePresence>
            {open && (
                <motion.div
                    key="assistant-overlay"
                    className={cn(styles.overlay, !isSheet && styles.overlayDesktop)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    onClick={close}
                >
                    <motion.section
                        role="dialog"
                        aria-modal="true"
                        aria-label="SplitX AI assistant"
                        className={cn(styles.panel, isSheet ? styles.panelSheet : styles.panelFloating)}
                        initial={isSheet ? { y: '100%' } : { opacity: 0, y: 24, scale: 0.97 }}
                        animate={isSheet ? { y: 0 } : { opacity: 1, y: 0, scale: 1 }}
                        exit={isSheet ? { y: '100%' } : { opacity: 0, y: 16, scale: 0.98 }}
                        transition={{ type: 'spring', damping: 36, stiffness: 380 }}
                        drag={isSheet ? 'y' : false}
                        dragListener={false}
                        dragControls={dragControls}
                        dragConstraints={{ top: 0, bottom: 0 }}
                        dragElastic={{ top: 0, bottom: 0.7 }}
                        onDragEnd={handleDragEnd}
                        onClick={(event) => event.stopPropagation()}
                    >
                        {isSheet && (
                            <div className={styles.handleZone} onPointerDown={startDrag}>
                                <span className={styles.handle} />
                            </div>
                        )}

                        <header className={styles.header} onPointerDown={startDrag}>
                            <span className={styles.botMark}><Sparkles size={18} /></span>
                            <div className={styles.headerText}>
                                <h2 className={styles.title}>SplitX AI</h2>
                                <p className={styles.status}>
                                    <span className={styles.statusDot} />
                                    {loading ? 'Thinking…' : 'Knows your groups & balances'}
                                </p>
                            </div>
                            {hasMessages && (
                                <button type="button" className={styles.headerBtn} onClick={() => setMessages([])} aria-label="Start a new chat">
                                    <RotateCcw size={15} />
                                </button>
                            )}
                            <button type="button" className={styles.headerBtn} onClick={close} aria-label="Close assistant">
                                <X size={17} />
                            </button>
                        </header>

                        <div className={styles.body}>
                            {!hasMessages ? (
                                <div className={styles.welcome}>
                                    <motion.div
                                        className={styles.welcomeOrb}
                                        initial={{ scale: 0.7, opacity: 0 }}
                                        animate={{ scale: 1, opacity: 1 }}
                                        transition={{ type: 'spring', stiffness: 380, damping: 20, delay: 0.05 }}
                                    >
                                        <Sparkles size={26} />
                                    </motion.div>
                                    <h3 className={styles.welcomeTitle}>How can I help?</h3>
                                    <p className={styles.welcomeText}>
                                        Ask about balances, spending or settling up — answers come from your live SplitX data.
                                    </p>
                                    <div className={styles.suggestions}>
                                        {SUGGESTIONS.map((suggestion, index) => (
                                            <motion.button
                                                key={suggestion.label}
                                                type="button"
                                                className={styles.suggestion}
                                                onClick={() => sendMessage(suggestion.query)}
                                                initial={{ opacity: 0, y: 8 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: 0.08 + index * 0.035 }}
                                                whileTap={{ scale: 0.97 }}
                                            >
                                                <span className={styles.suggestionIcon}>{suggestion.icon}</span>
                                                <span>{suggestion.label}</span>
                                            </motion.button>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className={styles.thread}>
                                    {messages.map((message) => (
                                        <motion.div
                                            key={message.id}
                                            className={cn(styles.message, message.role === 'user' ? styles.messageUser : styles.messageBot)}
                                            initial={{ opacity: 0, y: 8 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.2 }}
                                        >
                                            {message.role === 'assistant' && (
                                                <span className={styles.msgAvatar}><Bot size={14} /></span>
                                            )}
                                            <div className={styles.bubble}>
                                                {message.role === 'assistant'
                                                    ? <FormattedMessage content={message.content} />
                                                    : message.content}
                                            </div>
                                        </motion.div>
                                    ))}
                                    {loading && (
                                        <div className={cn(styles.message, styles.messageBot)}>
                                            <span className={styles.msgAvatar}><Bot size={14} /></span>
                                            <div className={styles.bubble}>
                                                <span className={styles.typing} aria-label="Assistant is typing">
                                                    {[0, 1, 2].map((dot) => (
                                                        <motion.span
                                                            key={dot}
                                                            className={styles.typingDot}
                                                            animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
                                                            transition={{ duration: 1.1, repeat: Infinity, delay: dot * 0.16 }}
                                                        />
                                                    ))}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                            <div ref={endRef} />
                        </div>

                        {hasMessages && !loading && (
                            <div className={styles.followUps}>
                                {FOLLOW_UPS.map((followUp) => (
                                    <button
                                        key={followUp.label}
                                        type="button"
                                        className={styles.followUp}
                                        onClick={() => sendMessage(followUp.query)}
                                    >
                                        {followUp.label}
                                    </button>
                                ))}
                            </div>
                        )}

                        <form
                            className={styles.composer}
                            onSubmit={(event) => {
                                event.preventDefault();
                                sendMessage(input);
                            }}
                        >
                            <input
                                ref={inputRef}
                                className={styles.input}
                                value={input}
                                onChange={(event) => setInput(event.target.value)}
                                placeholder="Ask anything about your money…"
                                enterKeyHint="send"
                                aria-label="Message SplitX AI"
                            />
                            <button type="submit" className={styles.send} disabled={!input.trim() || loading} aria-label="Send message">
                                <ArrowUp size={19} strokeWidth={2.6} />
                            </button>
                        </form>
                    </motion.section>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body
    );
}
