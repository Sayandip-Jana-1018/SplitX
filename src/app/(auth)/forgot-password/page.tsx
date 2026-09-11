'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { KeyRound, Mail, MailCheck, RotateCcw, Send } from 'lucide-react';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/kit';
import { AuthCard, apiErrorMessage } from '@/components/auth/AuthKit';
import { cn } from '@/lib/utils';
import styles from '@/components/auth/auth.module.css';

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [sentTo, setSentTo] = useState<string | null>(null);
    const [resent, setResent] = useState(false);
    const [error, setError] = useState('');

    const requestLink = async (address: string) => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: address }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                setError(apiErrorMessage(data, 'We couldn’t send the link. Please try again.'));
                return false;
            }
            return true;
        } catch {
            setError('Network error. Please try again.');
            return false;
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        const address = email.trim();
        if (await requestLink(address)) setSentTo(address);
    };

    const resend = async () => {
        if (sentTo && await requestLink(sentTo)) setResent(true);
    };

    const errorNotice = (
        <AnimatePresence initial={false}>
            {error && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                    <Notice tone="danger">{error}</Notice>
                </motion.div>
            )}
        </AnimatePresence>
    );

    if (sentTo) {
        return (
            <AuthCard
                key="sent"
                icon={<span className={cn(styles.stateIcon, styles.stateAccent)}><MailCheck size={30} /></span>}
                title="Check your inbox"
                subtitle={<>We’ve sent a reset link to <strong>{sentTo}</strong>. Open it to choose a new password.</>}
                footer={<Link href="/login">Back to sign in</Link>}
            >
                {errorNotice}
                {resent && <Notice tone="success">Sent again — give it a minute and check spam too.</Notice>}
                <Button fullWidth variant="secondary" leftIcon={<RotateCcw size={16} />} loading={loading} onClick={resend}>
                    Resend link
                </Button>
            </AuthCard>
        );
    }

    return (
        <AuthCard
            key="form"
            icon={<span className={cn(styles.stateIcon, styles.stateAccent)}><KeyRound size={30} /></span>}
            title="Forgot your password?"
            subtitle="Enter your email and we’ll send you a link to set a new one."
            footer={<>Remembered it? <Link href="/login">Sign in</Link></>}
        >
            {errorNotice}
            <form className={styles.form} onSubmit={handleSubmit}>
                <Input
                    label="Email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    leftIcon={<Mail size={17} />}
                    autoFocus
                    required
                />
                <Button type="submit" size="lg" fullWidth loading={loading} leftIcon={<Send size={18} />}>
                    Send reset link
                </Button>
            </form>
        </AuthCard>
    );
}
