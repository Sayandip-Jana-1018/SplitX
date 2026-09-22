'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { AnimatePresence, motion } from 'framer-motion';
import { Lock, Mail, User, UserPlus } from 'lucide-react';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Notice } from '@/components/ui/kit';
import {
    AuthCard,
    PasswordStrength,
    PasswordToggle,
    SocialSignIn,
    apiErrorMessage,
    safeCallbackUrl,
} from '@/components/auth/AuthKit';
import styles from '@/components/auth/auth.module.css';
import { PASSWORD_MIN_CHARS, passwordProblem } from '@/lib/password';

export default function RegisterPage() {
    return (
        <Suspense>
            <RegisterForm />
        </Suspense>
    );
}

function RegisterForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const callbackUrl = safeCallbackUrl(searchParams.get('callbackUrl'));
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const loginHref = callbackUrl === '/dashboard'
        ? '/login'
        : `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        const problem = passwordProblem(password);
        if (problem) {
            setError(problem);
            return;
        }
        setLoading(true);
        setError('');
        try {
            const res = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                setError(apiErrorMessage(data, 'We couldn’t create your account. Please try again.'));
                setLoading(false);
                return;
            }

            const result = await signIn('credentials', { email: email.trim(), password, redirect: false });
            router.replace(!result || result.error ? loginHref : callbackUrl);
        } catch {
            setError('Something went wrong. Please try again.');
            setLoading(false);
        }
    };

    return (
        <AuthCard
            title="Create your account"
            subtitle="Split bills with friends, track who owes what, and settle up by UPI."
            footer={<>Already on SplitX? <Link href={loginHref}>Sign in</Link></>}
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
                    label="Full name"
                    autoComplete="name"
                    placeholder="e.g. Priya Sharma"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    leftIcon={<User size={17} />}
                    required
                />
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
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    leftIcon={<Lock size={17} />}
                    rightSlot={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((value) => !value)} />}
                    minLength={PASSWORD_MIN_CHARS}
                    required
                />
                <PasswordStrength value={password} />
                <Button type="submit" size="lg" fullWidth loading={loading} leftIcon={<UserPlus size={18} />}>
                    Create account
                </Button>
            </form>
        </AuthCard>
    );
}
