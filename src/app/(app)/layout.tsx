'use client';

import { useState, useEffect, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';
import {
    LayoutDashboard,
    History as HistoryIcon,
    Users,
    Receipt,
    ArrowRightLeft,
    Settings,

    Menu,
    LogOut,
    X,
    BarChart3,
    Sparkles,
    Contact,
} from 'lucide-react';
import ClipboardBanner from '@/components/features/ClipboardBanner';
import NotificationBanner from '@/components/features/NotificationBanner';
import ThemeSelector from '@/components/features/ThemeSelector';
import Avatar from '@/components/ui/Avatar';
import OfflineIndicator from '@/components/ui/OfflineIndicator';
import { useHaptics } from '@/hooks/useHaptics';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { signOut } from 'next-auth/react';
import DbKeepAlive from '@/components/providers/DbKeepAlive';
import styles from './app.module.css';
import { cn } from '@/lib/utils';
import { usePerformanceMode } from '@/hooks/usePerformanceMode';

const NotificationPanel = dynamic(() => import('@/components/features/NotificationPanel'), { ssr: false });
const AIChatPanel = dynamic(() => import('@/components/features/AIChatPanel'), { ssr: false });
const OnboardingTour = dynamic(() => import('@/components/features/OnboardingTour'), { ssr: false });
const GlobalSearch = dynamic(() => import('@/components/ui/GlobalSearch'), { ssr: false });

const NAV_ITEMS = [
    { href: '/history', icon: HistoryIcon, label: 'History', emoji: 'History' },
    { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', emoji: '🏠' },
    { href: '/groups', icon: Users, label: 'Groups', emoji: '👥' },
    { href: '/contacts', icon: Contact, label: 'Contacts', emoji: '📇' },
    { href: '/transactions', icon: Receipt, label: 'Transactions', emoji: '💸' },
    { href: '/settlements', icon: ArrowRightLeft, label: 'Settlements', emoji: '🤝' },
    { href: '/analytics', icon: BarChart3, label: 'Analytics', emoji: '📊' },
    { href: '/settings', icon: Settings, label: 'Settings', emoji: '⚙️' },
];

const BOTTOM_NAV = [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Home', color: '#3b82f6' },
    { href: '/groups', icon: Users, label: 'Groups', color: '#8b5cf6' },
    { href: '/history', icon: HistoryIcon, label: 'History', color: '#14b8a6' },
    { href: '/analytics', icon: BarChart3, label: 'Analytics', color: '#f59e0b' },
    { href: '/transactions', icon: Receipt, label: 'Activity', color: '#10b981' },
    { href: '/settlements', icon: ArrowRightLeft, label: 'Settle', color: '#f43f5e' },
];

/* ── Animation variants ── */
const sidebarVariants = {
    closed: { x: '-100%', transition: { type: 'spring' as const, damping: 34, stiffness: 360 } },
    open: { x: 0, transition: { type: 'spring' as const, damping: 30, stiffness: 260, when: 'beforeChildren' as const, staggerChildren: 0.03 } },
};

const overlayVariants = {
    closed: { opacity: 0 },
    open: { opacity: 1 },
};

const navItemVariants = {
    closed: { x: -20, opacity: 0 },
    open: { x: 0, opacity: 1, transition: { type: 'spring' as const, damping: 24, stiffness: 260 } },
};

const footerVariants = {
    closed: { y: 20, opacity: 0 },
    open: { y: 0, opacity: 1, transition: { type: 'spring' as const, damping: 24, stiffness: 240, delay: 0.16 } },
};

function ActionPlaceholder() {
    return (
        <div
            className="surface-transition"
            style={{
                width: 34,
                height: 34,
                borderRadius: 'var(--radius-lg)',
                background: 'rgba(var(--accent-500-rgb), 0.05)',
                border: '1px solid rgba(var(--accent-500-rgb), 0.08)',
            }}
        />
    );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [deferredReady, setDeferredReady] = useState(false);
    const [chatReady, setChatReady] = useState(false);
    const [tourReady, setTourReady] = useState(false);
    const [isDesktop, setIsDesktop] = useState(() => {
        if (typeof window !== 'undefined') {
            return window.matchMedia('(min-width: 1024px)').matches;
        }
        return false;
    });
    const haptics = useHaptics();
    const { user } = useCurrentUser();
    const { mode } = usePerformanceMode();

    // Detect desktop breakpoint to conditionally render desktop sidebar
    useEffect(() => {
        const mq = window.matchMedia('(min-width: 1024px)');
        const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    const pageTitle = useMemo(
        () => NAV_ITEMS.find((item) => pathname.startsWith(item.href))?.label || 'Dashboard',
        [pathname]
    );
    const isPrintRoute = pathname.endsWith('/journey/print');
    const showAppChrome = !isPrintRoute;

    const navigateTo = (href: string) => {
        haptics.light();
        router.push(href);
        setSidebarOpen(false);
    };

    useEffect(() => {
        document.documentElement.dataset.motion = mode;
    }, [mode]);

    useEffect(() => {
        const routes = new Set([
            ...NAV_ITEMS.map((item) => item.href),
            ...BOTTOM_NAV.map((item) => item.href),
            '/transactions/new',
        ]);

        routes.forEach((href) => {
            router.prefetch(href);
        });
    }, [router]);

    useEffect(() => {
        if (!showAppChrome) return;

        const idleCallback = window.requestIdleCallback?.(
            () => setDeferredReady(true),
            { timeout: mode === 'premium' ? 400 : 700 }
        );
        const idleFallback = window.setTimeout(() => setDeferredReady(true), mode === 'premium' ? 220 : 360);
        const chatTimer = window.setTimeout(() => setChatReady(true), mode === 'premium' ? 900 : 1300);
        const tourTimer = window.setTimeout(() => setTourReady(true), mode === 'premium' ? 1600 : 2200);

        return () => {
            if (idleCallback) window.cancelIdleCallback?.(idleCallback);
            window.clearTimeout(idleFallback);
            window.clearTimeout(chatTimer);
            window.clearTimeout(tourTimer);
        };
    }, [mode, showAppChrome]);

    return (
        <div className={styles.appShell}>
            {showAppChrome && <OfflineIndicator />}
            <DbKeepAlive />
            {showAppChrome && tourReady && <OnboardingTour />}

            {/* ── Animated Sidebar Overlay ── */}
            <AnimatePresence>
                {showAppChrome && sidebarOpen && (
                    <motion.div
                        className={styles.sidebarOverlay}
                        variants={overlayVariants}
                        initial="closed"
                        animate="open"
                        exit="closed"
                        onClick={() => setSidebarOpen(false)}
                    />
                )}
            </AnimatePresence>

            {/* ── Premium Sidebar ── */}
            <AnimatePresence>
                {showAppChrome && sidebarOpen && (
                    <motion.aside
                        className={styles.sidebar}
                        variants={sidebarVariants}
                        initial="closed"
                        animate="open"
                        exit="closed"
                        style={{ transform: 'none' }} // let framer handle it
                    >
                        {/* Gradient mesh background */}
                        <div className={styles.sidebarMesh} />

                        {/* Header */}
                        <motion.div className={styles.sidebarLogo} variants={navItemVariants}>
                            <div className={styles.sidebarLogoIcon}>⚡</div>
                            <span className="gradient-text-animated" style={{ fontWeight: 800, fontSize: 20 }}>SplitX</span>
                            <motion.button
                                className={styles.sidebarClose}
                                onClick={() => setSidebarOpen(false)}
                                whileTap={{ scale: 0.85, rotate: -90 }}
                                whileHover={{ scale: 1.1 }}
                            >
                                <X size={18} />
                            </motion.button>
                        </motion.div>

                        {/* Navigation */}
                        <nav className={styles.sidebarNav}>
                            <motion.span className={styles.sidebarSection} variants={navItemVariants}>
                                <Sparkles size={12} style={{ opacity: 0.5 }} /> Navigation
                            </motion.span>
                            {NAV_ITEMS.map((item) => {
                                const isActive = pathname.startsWith(item.href);
                                const Icon = item.icon;
                                return (
                                    <motion.button
                                        key={item.href}
                                        className={cn(styles.navItem, isActive && styles.navItemActive)}
                                        onClick={() => navigateTo(item.href)}
                                        variants={navItemVariants}
                                        whileTap={{ scale: 0.97 }}
                                        whileHover={{ x: 4 }}
                                    >
                                        <motion.span
                                            className={styles.navItemIcon}
                                            animate={isActive ? { scale: [1, 1.2, 0.95, 1.05, 1] } : { scale: 1 }}
                                            transition={isActive ? { duration: 0.5, ease: [0.34, 1.56, 0.64, 1] } : {}}
                                        >
                                            <Icon size={20} strokeWidth={isActive ? 2.5 : 1.8} />
                                        </motion.span>
                                        <span className={styles.navItemLabel}>{item.label}</span>
                                        {isActive && (
                                            <motion.div
                                                className={styles.navItemActiveGlow}
                                                layoutId="sidebarActiveGlow"
                                                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                                            />
                                        )}
                                    </motion.button>
                                );
                            })}
                        </nav>

                        {/* Footer with user card */}
                        <motion.div className={styles.sidebarFooter} variants={footerVariants}>
                            <div className={styles.userCard}>
                                <div className={styles.userAvatarWrap}>
                                    <Avatar name={user?.name || 'User'} image={user?.image} size="sm" />
                                    <span className={styles.userOnlineDot} />
                                </div>
                                <div className={styles.userInfo}>
                                    <div className={styles.userName}>{user?.name || 'User'}</div>
                                    <div className={styles.userEmail}>{user?.email || ''}</div>
                                </div>
                            </div>
                            <motion.button
                                className={styles.signOutBtn}
                                onClick={() => signOut({ callbackUrl: '/login' })}
                                whileTap={{ scale: 0.96 }}
                                whileHover={{ x: 2 }}
                            >
                                <LogOut size={16} />
                                Sign Out
                            </motion.button>
                        </motion.div>
                    </motion.aside>
                )}
            </AnimatePresence>

            {/* ── Desktop Sidebar (only rendered on 1024px+) ── */}
            {showAppChrome && isDesktop && (
                <aside className={cn(styles.sidebar, styles.desktopSidebar)}>
                    <div className={styles.sidebarMesh} />
                    <div className={styles.sidebarLogo}>
                        <div className={styles.sidebarLogoIcon}>⚡</div>
                        <span className="gradient-text-animated" style={{ fontWeight: 800, fontSize: 20 }}>SplitX</span>
                    </div>
                    <nav className={styles.sidebarNav}>
                        <span className={styles.sidebarSection}>
                            <Sparkles size={12} style={{ opacity: 0.5 }} /> Navigation
                        </span>
                        {NAV_ITEMS.map((item) => {
                            const isActive = pathname.startsWith(item.href);
                            const Icon = item.icon;
                            return (
                                <motion.button
                                    key={item.href}
                                    className={cn(styles.navItem, isActive && styles.navItemActive)}
                                    onClick={() => router.push(item.href)}
                                    whileTap={{ scale: 0.97 }}
                                    whileHover={{ x: 4 }}
                                >
                                    <motion.span
                                        className={styles.navItemIcon}
                                        animate={isActive ? { scale: [1, 1.2, 0.95, 1.05, 1] } : { scale: 1 }}
                                        transition={isActive ? { duration: 0.5, ease: [0.34, 1.56, 0.64, 1] } : {}}
                                    >
                                        <Icon size={20} strokeWidth={isActive ? 2.5 : 1.8} />
                                    </motion.span>
                                    <span className={styles.navItemLabel}>{item.label}</span>
                                    {isActive && (
                                        <motion.div
                                            className={styles.navItemActiveGlow}
                                            layoutId="desktopActiveGlow"
                                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                                        />
                                    )}
                                </motion.button>
                            );
                        })}
                    </nav>
                    <div className={styles.sidebarFooter}>
                        <div className={styles.userCard}>
                            <div className={styles.userAvatarWrap}>
                                <Avatar name={user?.name || 'User'} image={user?.image} size="sm" />
                                <span className={styles.userOnlineDot} />
                            </div>
                            <div className={styles.userInfo}>
                                <div className={styles.userName}>{user?.name || 'User'}</div>
                                <div className={styles.userEmail}>{user?.email || ''}</div>
                            </div>
                        </div>
                        <motion.button
                            className={styles.signOutBtn}
                            onClick={() => signOut({ callbackUrl: '/login' })}
                            whileTap={{ scale: 0.96 }}
                        >
                            <LogOut size={16} />
                            Sign Out
                        </motion.button>
                    </div>
                </aside>
            )}

            {/* ── Main Area ── */}
            <main className={styles.main}>
                {/* Header */}
                {showAppChrome && <header className={styles.header} suppressHydrationWarning>
                    <div className={styles.headerLeft}>
                        <motion.button
                            className={styles.menuBtn}
                            onClick={() => setSidebarOpen(true)}
                            aria-label="Open menu"
                            whileTap={{ scale: 0.9 }}
                        >
                            <Menu size={22} />
                        </motion.button>
                        <h1 className={styles.headerTitle}>{pageTitle}</h1>
                    </div>
                    <div className={styles.headerRight}>
                        {deferredReady ? <GlobalSearch /> : <ActionPlaceholder />}
                        {deferredReady ? <NotificationPanel /> : <ActionPlaceholder />}
                        <ThemeSelector />
                        <div
                            onClick={() => router.push('/settings')}
                            tabIndex={0}
                            style={{
                                cursor: 'pointer',
                                transition: 'transform 0.15s ease',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                            onMouseDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.9)'; }}
                            onMouseUp={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
                            suppressHydrationWarning
                        >
                            <Avatar name={user?.name || 'User'} image={user?.image} size="sm" />
                        </div>
                    </div>
                </header>}

                {/* Page content */}
                <div className={isPrintRoute ? styles.printPageContent : styles.pageContent} suppressHydrationWarning>
                    {showAppChrome && <NotificationBanner />}
                    {showAppChrome && <ClipboardBanner />}
                    {children}
                </div>
            </main>


            {/* ── AI Chat Panel (hidden on add-transaction page) ── */}
            {showAppChrome && chatReady && !pathname.startsWith('/transactions/new') && <AIChatPanel />}

            {/* ── Floating Bottom Nav (mobile) ── */}
            {showAppChrome && <nav className={styles.bottomNav}>
                <div className={styles.bottomNavInner}>
                    {BOTTOM_NAV.map((item) => {
                        const isActive = pathname.startsWith(item.href);
                        const Icon = item.icon;
                        return (
                            <div key={item.href} style={{ display: 'contents' }}>
                                <motion.button
                                    suppressHydrationWarning
                                    data-tour={item.href}
                                    className={cn(
                                        styles.bottomNavItem,
                                        isActive && styles.bottomNavItemActive
                                    )}
                                    onClick={() => {
                                        haptics.light();
                                        router.push(item.href);
                                    }}
                                    whileTap={{ scale: 0.85 }}
                                    style={{
                                        color: isActive ? item.color : undefined,
                                    }}
                                >
                                    <motion.div
                                        className={styles.bottomNavIconWrap}
                                        animate={isActive ? { y: -2, scale: 1.1 } : { y: 0, scale: 1 }}
                                        transition={{ type: 'spring', damping: 18, stiffness: 350 }}
                                    >
                                        <Icon
                                            size={20}
                                            strokeWidth={isActive ? 2.5 : 1.8}
                                            style={{
                                                color: isActive ? item.color : `${item.color}80`,
                                                transition: 'color 0.25s ease',
                                            }}
                                        />
                                        {isActive && (
                                            <motion.div
                                                className={styles.bottomNavDot}
                                                layoutId="bottomNavDot"
                                                transition={{ type: 'spring', damping: 25, stiffness: 400 }}
                                                style={{
                                                    background: item.color,
                                                    boxShadow: `0 0 8px ${item.color}80`,
                                                }}
                                            />
                                        )}
                                    </motion.div>
                                    <span className={styles.bottomNavLabel}>{item.label}</span>
                                    {isActive && (
                                        <motion.div
                                            className={styles.bottomNavActivePill}
                                            layoutId="bottomNavActive"
                                            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
                                            style={{
                                                background: `${item.color}12`,
                                                borderColor: `${item.color}18`,
                                            }}
                                        />
                                    )}
                                </motion.button>
                            </div>
                        );
                    })}
                </div>
            </nav>}
        </div>
    );
}
