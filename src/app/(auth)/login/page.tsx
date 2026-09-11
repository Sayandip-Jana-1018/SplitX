'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { AnimatePresence, motion } from 'framer-motion';
import { Lock, LogIn, Mail } from 'lucide-react';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/kit';
import { AuthCard, PasswordToggle, SocialSignIn, authErrorMessage, safeCallbackUrl } from '@/components/auth/AuthKit';
import styles from '@/components/auth/auth.module.css';

export default function LoginPage() {
    return (
        <Suspense>
            <LoginForm />
        </Suspense>
    );
}

function LoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const callbackUrl = safeCallbackUrl(searchParams.get('callbackUrl'));
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(() => authErrorMessage(searchParams.get('error')));

    const registerHref = callbackUrl === '/dashboard'
        ? '/register'
        : `/register?callbackUrl=${encodeURIComponent(callbackUrl)}`;

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setLoading(true);
        setError('');
        try {
            const result = await signIn('credentials', { email: email.trim(), password, redirect: false });
            if (!result || result.error) {
                setError('That email and password don’t match. Try again, or reset your password.');
                setLoading(false);
                return;
            }
            router.replace(callbackUrl);
        } catch {
            setError('Something went wrong. Please try again.');
            setLoading(false);
        }
    };

    return (
        <AuthCard
            title="Welcome back"
            subtitle="Sign in to see who owes what and settle up in seconds."
            footer={<>New to SplitX? <Link href={registerHref}>Create an account</Link></>}
        >
            <SocialSignIn callbackUrl={callbackUrl} />

            <AnimatePresence initial={false}>
                {error && (
                    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                        <Notice tone="danger">{error}</Notice>
                    </motion.div>
                )}
            </AnimatePresence>

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
                    required
                />
                <Input
                    label="Password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Your password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    leftIcon={<Lock size={17} />}
                    rightSlot={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((value) => !value)} />}
                    required
                />
                <div className={styles.row}>
                    <Link href="/forgot-password" className={styles.textLink}>Forgot password?</Link>
                </div>
                <Button type="submit" size="lg" fullWidth loading={loading} leftIcon={<LogIn size={18} />}>
                    Sign in
                </Button>
            </form>
        </AuthCard>
    );
}
