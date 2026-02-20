'use client';

import { useState, useEffect, Suspense } from 'react';
import { motion } from 'framer-motion';
import { Lock, ShieldCheck, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { useSearchParams, useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import Navbar from '@/components/ui/Navbar';
import styles from '../auth.module.css';

function ResetPasswordForm() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const token = searchParams.get('token');

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    useEffect(() => {
        if (!token) {
            setError('Invalid reset link. Please request a new one.');
        }
    }, [token]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (password.length < 6) {
            setError('Password must be at least 6 characters');
            return;
        }

        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        setLoading(true);

        try {
            const res = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, password }),
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error || 'Something went wrong');
                return;
            }

            setSuccess(true);

            // Redirect to login after 3 seconds
            setTimeout(() => router.push('/login'), 3000);
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
                        SplitX
                    </div>

                    {success ? (
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
                                ✅
                            </div>
                            <h1 className={styles.title}>Password Reset!</h1>
                            <p className={styles.subtitle}>
                                Your password has been updated successfully. Redirecting you to sign in...
                            </p>
                            <div style={{
                                marginTop: 'var(--space-4)',
                                position: 'relative', zIndex: 2,
                            }}>
                                <a href="/login" className={styles.link} style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                    fontSize: 'var(--text-sm)',
                                }}>
                                    <ArrowLeft size={14} /> Go to Sign In
                                </a>
                            </div>
                        </motion.div>
                    ) : (
                        /* ── Reset Form ── */
                        <>
                            <h1 className={styles.title}>Set new password</h1>
                            <p className={styles.subtitle}>
                                Choose a strong password for your account.
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

                            {token ? (
                                <form className={styles.form} onSubmit={handleSubmit}>
                                    <div style={{ position: 'relative' }}>
                                        <Input
                                            label="New Password"
                                            type={showPassword ? 'text' : 'password'}
                                            placeholder="At least 6 characters"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            leftIcon={<Lock size={18} />}
                                            minLength={6}
                                            required
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            style={{
                                                position: 'absolute', right: 12, top: 34,
                                                background: 'none', border: 'none',
                                                color: 'var(--fg-tertiary)', cursor: 'pointer',
                                                padding: 4, display: 'flex',
                                            }}
                                        >
                                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>

                                    <Input
                                        label="Confirm Password"
                                        type="password"
                                        placeholder="Re-enter your password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        leftIcon={<ShieldCheck size={18} />}
                                        minLength={6}
                                        required
                                    />

                                    {/* Password strength indicator */}
                                    {password.length > 0 && (
                                        <div style={{ position: 'relative', zIndex: 2 }}>
                                            <div style={{
                                                height: 4, borderRadius: 2,
                                                background: 'var(--bg-tertiary)',
                                                overflow: 'hidden',
                                            }}>
                                                <motion.div
                                                    initial={{ width: 0 }}
                                                    animate={{
                                                        width: password.length < 6 ? '25%'
                                                            : password.length < 8 ? '50%'
                                                                : password.length < 12 ? '75%' : '100%',
                                                    }}
                                                    style={{
                                                        height: '100%',
                                                        borderRadius: 2,
                                                        background: password.length < 6 ? '#ef4444'
                                                            : password.length < 8 ? '#f59e0b'
                                                                : password.length < 12 ? '#10b981' : '#06b6d4',
                                                        transition: 'all 0.3s',
                                                    }}
                                                />
                                            </div>
                                            <span style={{
                                                fontSize: 'var(--text-2xs)',
                                                color: 'var(--fg-tertiary)',
                                                marginTop: 4, display: 'block',
                                            }}>
                                                {password.length < 6 ? 'Too short'
                                                    : password.length < 8 ? 'Fair'
                                                        : password.length < 12 ? 'Good' : 'Strong'} password
                                            </span>
                                        </div>
                                    )}

                                    <Button
                                        type="submit"
                                        size="lg"
                                        fullWidth
                                        loading={loading}
                                        leftIcon={<ShieldCheck size={18} />}
                                    >
                                        Reset Password
                                    </Button>
                                </form>
                            ) : (
                                <div style={{
                                    textAlign: 'center',
                                    position: 'relative', zIndex: 2,
                                    marginTop: 'var(--space-4)',
                                }}>
                                    <a href="/forgot-password" className={styles.link} style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 6,
                                        fontSize: 'var(--text-sm)',
                                    }}>
                                        Request a new reset link
                                    </a>
                                </div>
                            )}

                            <p className={styles.footerText}>
                                Remember your password?{' '}
                                <a href="/login" className={styles.link}>Sign in</a>
                            </p>
                        </>
                    )}
                </motion.div>
            </div>
        </>
    );
}

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={
            <div style={{
                minHeight: '100vh', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                background: 'var(--bg-primary)',
                color: 'var(--fg-tertiary)',
                fontSize: 'var(--text-sm)',
            }}>
                Loading...
            </div>
        }>
            <ResetPasswordForm />
        </Suspense>
    );
}
