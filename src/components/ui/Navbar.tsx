'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { LogIn, UserPlus } from 'lucide-react';
import ThemeSelector from '@/components/features/ThemeSelector';
import Button from '@/components/ui/Button';
import styles from './Navbar.module.css';

/* Shared glass-circle style — identical to ThemeSelector toggle buttons */
const glassBtn: React.CSSProperties = {
    width: 36,
    height: 36,
    borderRadius: 'var(--radius-lg, 12px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(var(--accent-500-rgb), 0.08)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid rgba(var(--accent-500-rgb), 0.12)',
    color: 'var(--accent-500)',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    textDecoration: 'none',
};

export default function Navbar() {
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const check = () => setIsMobile(window.innerWidth <= 640);
        check();
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);

    return (
        <nav className={styles.nav}>
            <div className={styles.navInner}>
                <Link href="/" className={styles.logo}>
                    <div className={styles.logoIcon}>⚡</div>
                    {!isMobile && <span className={styles.logoText}>SplitX</span>}
                </Link>
                <div className={styles.navActions}>
                    <ThemeSelector />
                    {isMobile ? (
                        <>
                            <Link href="/login" aria-label="Log in" style={{ textDecoration: 'none' }}>
                                <motion.div
                                    whileTap={{ scale: 0.9 }}
                                    whileHover={{ scale: 1.05 }}
                                    style={glassBtn}
                                >
                                    <LogIn size={18} />
                                </motion.div>
                            </Link>
                            <Link href="/register" aria-label="Sign up" style={{ textDecoration: 'none' }}>
                                <motion.div
                                    whileTap={{ scale: 0.9 }}
                                    whileHover={{ scale: 1.05 }}
                                    style={glassBtn}
                                >
                                    <UserPlus size={18} />
                                </motion.div>
                            </Link>
                        </>
                    ) : (
                        <>
                            <Link href="/login">
                                <Button variant="ghost" size="sm">Log in</Button>
                            </Link>
                            <Link href="/register">
                                <Button variant="primary" size="sm">Get Started</Button>
                            </Link>
                        </>
                    )}
                </div>
            </div>
        </nav>
    );
}
