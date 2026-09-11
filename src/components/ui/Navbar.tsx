'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ThemeSelector from '@/components/features/ThemeSelector';
import BrandMark from '@/components/ui/BrandMark';
import { cn } from '@/lib/utils';
import styles from './Navbar.module.css';

function subscribeToScroll(callback: () => void) {
    window.addEventListener('scroll', callback, { passive: true });
    return () => window.removeEventListener('scroll', callback);
}

const isScrolled = () => window.scrollY > 8;

/** Public-page navbar. Calls to action adapt to where you are. */
export default function Navbar() {
    const pathname = usePathname();
    const scrolled = useSyncExternalStore(subscribeToScroll, isScrolled, () => false);

    const isLanding = pathname === '/';
    const onLogin = pathname === '/login';
    const onPasswordFlow = pathname === '/register' || pathname === '/forgot-password' || pathname === '/reset-password';

    return (
        <nav className={cn(styles.nav, scrolled && styles.scrolled)} aria-label="Main">
            <div className={styles.inner}>
                <Link href="/" className={styles.logo} aria-label="SplitX home">
                    <BrandMark size={32} />
                </Link>
                <div className={styles.actions}>
                    <ThemeSelector />
                    {isLanding && (
                        <>
                            <Link href="/login" className={cn(styles.cta, styles.ghost, styles.hideTiny)}>Log in</Link>
                            <Link href="/register" className={styles.cta}>Get started</Link>
                        </>
                    )}
                    {onLogin && <Link href="/register" className={styles.cta}>Sign up</Link>}
                    {onPasswordFlow && <Link href="/login" className={cn(styles.cta, styles.ghost)}>Log in</Link>}
                </div>
            </div>
        </nav>
    );
}
