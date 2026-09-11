'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, KeyRound, Link2Off, Lock, ShieldCheck } from 'lucide-react';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/kit';
import { AuthCard, PasswordStrength, PasswordToggle, apiErrorMessage } from '@/components/auth/AuthKit';
import { cn } from '@/lib/utils';
import styles from '@/components/auth/auth.module.css';

export default function ResetPasswordPage() {
    return (
        <Suspense>
            <ResetPasswordForm />
        </Suspense>
    );
}

function ResetPasswordForm() {
    const router = useRouter();
    const token = useSearchParams().get('token');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const mismatch = confirm.length > 0 && confirm !== password;

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        if (password.length < 6) {
            setError('Use at least 6 characters for your password.');
            return;
        }
        if (password !== confirm) {
            setError('The two passwords don’t match.');
            return;
        }

        setLoading(true);
        try {
            const res = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, password }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                setError(apiErrorMessage(data, 'We couldn’t reset your password. The link may have expired.'));
                return;
            }
            setSuccess(true);
            window.setTimeout(() => router.push('/login'), 3000);
        } catch {
            setError('Network error. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    if (!token) {
        return (
            <AuthCard
                icon={<span className={cn(styles.stateIcon, styles.stateDanger)}><Link2Off size={30} /></span>}
                title="This link doesn’t work"
                subtitle="Reset links can only be used once and expire after a while. Request a fresh one."
                footer={<Link href="/login">Back to sign in</Link>}
            >
                <Button fullWidth size="lg" onClick={() => router.push('/forgot-password')}>Request a new link</Button>
            </AuthCard>
        );
    }

    if (success) {
        return (
            <AuthCard
                icon={(
                    <motion.span
                        className={cn(styles.stateIcon, styles.stateSuccess)}
                        initial={{ scale: 0.5, rotate: -12 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ type: 'spring', stiffness: 420, damping: 16 }}
                    >
                        <CheckCircle2 size={32} />
                    </motion.span>
                )}
                title="Password updated"
                subtitle="You’re all set. Taking you to sign in…"
            >
                <Button fullWidth size="lg" onClick={() => router.push('/login')}>Sign in now</Button>
            </AuthCard>
        );
    }

    return (
        <AuthCard
            icon={<span className={cn(styles.stateIcon, styles.stateAccent)}><KeyRound size={30} /></span>}
            title="Choose a new password"
            subtitle="Make it something you haven’t used on SplitX before."
            footer={<>Remembered it? <Link href="/login">Sign in</Link></>}
        >
            <AnimatePresence initial={false}>
                {error && (
                    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                        <Notice tone="danger">{error}</Notice>
                    </motion.div>
                )}
            </AnimatePresence>
            <form className={styles.form} onSubmit={handleSubmit}>
                <Input
                    label="New password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    leftIcon={<Lock size={17} />}
                    rightSlot={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((value) => !value)} />}
                    minLength={6}
                    autoFocus
                    required
                />
                <PasswordStrength value={password} />
                <Input
                    label="Confirm password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="Type it again"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                    leftIcon={<ShieldCheck size={17} />}
                    error={mismatch ? 'Passwords don’t match yet' : undefined}
                    minLength={6}
                    required
                />
                <Button type="submit" size="lg" fullWidth loading={loading} leftIcon={<ShieldCheck size={18} />}>
                    Update password
                </Button>
            </form>
        </AuthCard>
    );
}
