'use client';

import { useState, type ReactNode } from 'react';
import useSWR from 'swr';
import { signIn } from 'next-auth/react';
import { motion } from 'framer-motion';
import { Eye, EyeOff } from 'lucide-react';
import BrandMark from '@/components/ui/BrandMark';
import Navbar from '@/components/ui/Navbar';
import { Spinner } from '@/components/ui/kit';
import { cn } from '@/lib/utils';
import styles from './auth.module.css';

/* ── Helpers ─────────────────────────────────────────────── */

/** Only allow same-origin redirect targets (prevents open redirects). */
export function safeCallbackUrl(value: string | null, fallback = '/dashboard') {
    if (!value) return fallback;
    if (value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')) return value;
    if (typeof window !== 'undefined') {
        try {
            const url = new URL(value);
            if (url.origin === window.location.origin) return `${url.pathname}${url.search}${url.hash}` || fallback;
        } catch { /* not an absolute URL */ }
    }
    return fallback;
}

const AUTH_ERRORS: Record<string, string> = {
    CredentialsSignin: 'That email and password don’t match.',
    OAuthAccountNotLinked: 'This email already signs in another way. Use that method instead.',
    AccessDenied: 'Access was denied. Please try again.',
    Verification: 'That sign-in link has expired. Request a new one.',
    Configuration: 'Sign-in is temporarily unavailable. Please try again shortly.',
};

/** Friendly copy for next-auth `?error=` codes. */
export function authErrorMessage(code: string | null) {
    if (!code) return '';
    return AUTH_ERRORS[code] ?? 'We couldn’t sign you in. Please try again.';
}

export function apiErrorMessage(data: unknown, fallback: string) {
    const error = (data as { error?: unknown } | null)?.error;
    return typeof error === 'string' && error ? error : fallback;
}

/* ── Layout ──────────────────────────────────────────────── */

/** Ambient backdrop + public navbar + centered content. */
export function PublicShell({ children }: { children: ReactNode }) {
    return (
        <div className={styles.shell}>
            <div className={styles.backdrop} aria-hidden="true">
                <span className={styles.glowA} />
                <span className={styles.glowB} />
                <span className={styles.gridLines} />
            </div>
            <Navbar />
            <main className={styles.main}>{children}</main>
        </div>
    );
}

export function AuthCard({
    icon,
    title,
    subtitle,
    children,
    footer,
}: {
    icon?: ReactNode;
    title: ReactNode;
    subtitle?: ReactNode;
    children?: ReactNode;
    footer?: ReactNode;
}) {
    return (
        <motion.section
            className={styles.card}
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        >
            <header className={styles.cardHead}>
                <div className={styles.cardIcon}>{icon ?? <BrandMark size={46} wordmark={false} />}</div>
                <h1 className={styles.title}>{title}</h1>
                {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
            </header>
            {children}
            {footer && <p className={styles.footer}>{footer}</p>}
        </motion.section>
    );
}

/* ── Inputs ──────────────────────────────────────────────── */

export function PasswordToggle({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            className={styles.eye}
            onClick={onToggle}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
        >
            {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
    );
}

function passwordScore(value: string) {
    if (value.length < 6) return 1;
    let score = 1;
    if (value.length >= 10) score += 1;
    if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
    if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;
    return Math.min(score, 4);
}

export function PasswordStrength({ value }: { value: string }) {
    if (!value) return null;
    const score = passwordScore(value);
    const label = value.length < 6 ? 'Too short — use at least 6 characters' : ['Weak', 'Fair', 'Good', 'Strong'][score - 1];
    return (
        <div className={cn(styles.strength, styles[`level${score}`])} aria-live="polite">
            <div className={styles.strengthBars} aria-hidden="true">
                {[0, 1, 2, 3].map((index) => <span key={index} className={styles.strengthBar} />)}
            </div>
            <span className={styles.strengthLabel}>{label}</span>
        </div>
    );
}

/* ── Social sign-in ──────────────────────────────────────── */

interface ProviderInfo {
    id: string;
    name: string;
    type: string;
}

const PROVIDER_ICONS: Record<string, ReactNode> = {
    google: (
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
    ),
    github: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
        </svg>
    ),
};

async function providersFetcher(url: string): Promise<Record<string, ProviderInfo>> {
    const response = await fetch(url);
    return response.ok ? response.json() : {};
}

/** OAuth buttons for whichever providers the server actually has configured. */
export function SocialSignIn({ callbackUrl }: { callbackUrl: string }) {
    const { data } = useSWR('/api/auth/providers', providersFetcher, { revalidateOnFocus: false });
    const [pending, setPending] = useState<string | null>(null);
    const providers = Object.values(data ?? {}).filter((provider) => provider.type === 'oauth' || provider.type === 'oidc');

    if (providers.length === 0) return null;

    return (
        <motion.div
            className={styles.socialWrap}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            transition={{ duration: 0.25 }}
        >
            <div className={styles.social}>
                {providers.map((provider) => (
                    <button
                        key={provider.id}
                        type="button"
                        className={styles.socialButton}
                        disabled={pending !== null}
                        onClick={() => {
                            setPending(provider.id);
                            void signIn(provider.id, { callbackUrl });
                        }}
                    >
                        {pending === provider.id ? <Spinner size={16} /> : PROVIDER_ICONS[provider.id]}
                        {provider.name}
                    </button>
                ))}
            </div>
            <div className={styles.divider}>or use email</div>
        </motion.div>
    );
}
