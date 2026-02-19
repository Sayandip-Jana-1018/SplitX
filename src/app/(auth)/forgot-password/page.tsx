'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Mail, ArrowLeft, Send } from 'lucide-react';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import Navbar from '@/components/ui/Navbar';
import styles from '../auth.module.css';

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const res = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error || 'Something went wrong');
                return;
            }

            setSent(true);
        } catch {
            setError('Network error. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <Navbar />
            <div className={styles.authPage}>
                <div className={styles.bgOrbs}>
                    <motion.div
                        className={`${styles.orb} ${styles.orb1}`}
                        animate={{ x: [0, 20, 0], y: [0, -15, 0] }}
                        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
                    />
                    <motion.div
                        className={`${styles.orb} ${styles.orb2}`}
                        animate={{ x: [0, -15, 0], y: [0, 20, 0] }}
                        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
                    />
                    <div className={`${styles.orb} ${styles.orb3}`} />
                </div>

                <motion.div
                    className={styles.authCard}
                    initial={{ opacity: 0, y: 20, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                >
                    <div className={styles.logo}>
                        <div className={styles.logoIcon}>⚡</div>
                        AutoSplit
                    </div>

                    {sent ? (
                        /* ── Success State ── */
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.3 }}
                            style={{ textAlign: 'center' }}
                        >
                            <div style={{
                                width: 64, height: 64,
                                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(5, 150, 105, 0.15))',
                                borderRadius: '50%',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                margin: '0 auto var(--space-4)',
                                fontSize: 28,
                            }}>
                                ✉️
                            </div>
                            <h1 className={styles.title}>Check your email</h1>
                            <p className={styles.subtitle} style={{ marginBottom: 'var(--space-4)' }}>
                                We sent a reset link to <strong style={{ color: 'var(--accent-400)' }}>{email}</strong>.
                                Click the link in the email to reset your password.
                            </p>
                            <p style={{
                                fontSize: 'var(--text-xs)',
                                color: 'var(--fg-tertiary)',
                                position: 'relative', zIndex: 2,
                                lineHeight: 1.6,
                            }}>
                                Didn&apos;t receive it? Check your spam folder, or{' '}
                                <button
                                    onClick={() => { setSent(false); setEmail(''); }}
                                    style={{
                                        background: 'none', border: 'none',
                                        color: 'var(--accent-400)', fontWeight: 600,
                                        cursor: 'pointer', fontSize: 'inherit',
                                        textDecoration: 'underline',
                                    }}
                                >
                                    try again
                                </button>
                            </p>

                            <div style={{ marginTop: 'var(--space-6)', position: 'relative', zIndex: 2 }}>
                                <a href="/login" className={styles.link} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-sm)' }}>
                                    <ArrowLeft size={14} /> Back to Sign In
                                </a>
                            </div>
                        </motion.div>
                    ) : (
                        /* ── Form State ── */
                        <>
                            <h1 className={styles.title}>Forgot password?</h1>
                            <p className={styles.subtitle}>
                                Enter your email and we&apos;ll send you a link to reset your password.
                            </p>

                            {error && (
                                <motion.div
                                    className={styles.error}
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                >
                                    {error}
                                </motion.div>
                            )}

                            <form className={styles.form} onSubmit={handleSubmit}>
                                <Input
                                    label="Email"
                                    type="email"
                                    placeholder="you@example.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    leftIcon={<Mail size={18} />}
                                    required
                                />

                                <Button
                                    type="submit"
                                    size="lg"
                                    fullWidth
                                    loading={loading}
                                    leftIcon={<Send size={18} />}
                                >
                                    Send Reset Link
                                </Button>
                            </form>

                            <p className={styles.footerText}>
                                Remember your password?{' '}
                                <a href="/login" className={styles.link}>
                                    Sign in
                                </a>
                            </p>
                        </>
                    )}
                </motion.div>
            </div>
        </>
    );
}
