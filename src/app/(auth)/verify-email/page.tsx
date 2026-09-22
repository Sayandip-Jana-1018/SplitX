'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Loader2, MailCheck } from 'lucide-react';
import Button from '@/components/ui/Button';
import { AuthCard, apiErrorMessage } from '@/components/auth/AuthKit';
import { cn } from '@/lib/utils';
import styles from '@/components/auth/auth.module.css';

export default function VerifyEmailPage() {
    return (
        <Suspense>
            <VerifyEmail />
        </Suspense>
    );
}

/** Opened from the confirmation email: confirms the address once, then points to sign-in. */
function VerifyEmail() {
    const router = useRouter();
    const token = useSearchParams().get('token') ?? '';
    const [state, setState] = useState<'checking' | 'confirmed' | 'failed'>(token ? 'checking' : 'failed');
    const [message, setMessage] = useState(token ? '' : 'This link is missing its code. Open the link from the email again.');
    // A link works once; React may run an effect twice in development.
    const sent = useRef(false);

    useEffect(() => {
        if (!token || sent.current) return;
        sent.current = true;
        fetch('/api/auth/verify-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
        })
            .then(async (res) => {
                if (res.ok) {
                    setState('confirmed');
                } else {
                    setMessage(apiErrorMessage(await res.json().catch(() => null), 'We couldn’t confirm this link. Please try again.'));
                    setState('failed');
                }
            })
            .catch(() => {
                setMessage('Network error. Check your connection and open the link again.');
                setState('failed');
            });
    }, [token]);

    if (state === 'checking') {
        return (
            <AuthCard
                icon={<span className={cn(styles.stateIcon, styles.stateAccent)}><Loader2 size={30} className={styles.spin} /></span>}
                title="Confirming your email…"
                subtitle="This takes a moment."
            />
        );
    }

    if (state === 'confirmed') {
        return (
            <AuthCard
                icon={<span className={cn(styles.stateIcon, styles.stateSuccess)}><MailCheck size={30} /></span>}
                title="Email confirmed"
                subtitle="Your account is ready. Sign in to start splitting."
            >
                <Button fullWidth size="lg" onClick={() => router.push('/login')}>Sign in</Button>
            </AuthCard>
        );
    }

    return (
        <AuthCard
            icon={<span className={cn(styles.stateIcon, styles.stateDanger)}><AlertTriangle size={30} /></span>}
            title="This link didn’t work"
            subtitle={message}
            footer={<Link href="/login">Go to sign in</Link>}
        />
    );
}
