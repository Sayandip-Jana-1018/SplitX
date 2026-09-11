'use client';

import { useState, useEffect, useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Plus, Split } from 'lucide-react';
import { useDialogFocus } from '@/hooks/useDialogFocus';
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
    { href: '/dashboard', icon: LayoutDashboard, label: 'Home' },
    { href: '/groups', icon: Users, label: 'Groups' },
    { href: '/transactions/new', icon: Plus, label: 'Add' },
    { href: '/transactions', icon: Receipt, label: 'Activity' },
    { href: '/settlements', icon: ArrowRightLeft, label: 'Settle' },
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

function subscribeDesktop(callback: () => void) {
    const mq = window.matchMedia('(min-width: 1024px)');
    mq.addEventListener('change', callback);
    return () => mq.removeEventListener('change', callback);
}

function getDesktopSnapshot() {
    return window.matchMedia('(min-width: 1024px)').matches;
}

function getServerDesktopSnapshot() {
    return false;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [deferredReady, setDeferredReady] = useState(false);
    const [chatReady, setChatReady] = useState(false);
    const [tourReady, setTourReady] = useState(false);
    const isDesktop = useSyncExternalStore(subscribeDesktop, getDesktopSnapshot, getServerDesktopSnapshot);
    const drawerRef = useDialogFocus(sidebarOpen && !isDesktop, () => setSidebarOpen(false));
    const haptics = useHaptics();
    const { user } = useCurrentUser();
    const { mode } = usePerformanceMode();

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
        <div className={cn(styles.appShell, isPrintRoute && styles.printShell)}>
            {showAppChrome && <a className={styles.skipLink} href="#workspace">Skip to content</a>}
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
                        ref={drawerRef}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Navigation menu"
                        tabIndex={-1}
                        data-focus-dialog
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
                            <div className={styles.sidebarLogoIcon}><Split size={22} /></div>
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
                        <div className={styles.sidebarLogoIcon}><Split size={22} /></div>
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
                        <div><span className={styles.headerEyebrow}>Your shared money</span><span className={styles.headerTitle}>{pathname === '/transactions/new' ? 'New expense' : pathname === '/transactions/scan' ? 'Receipt scanner' : pageTitle}</span></div>
                    </div>
                    <div className={styles.headerRight}>
                        {deferredReady ? <GlobalSearch /> : <ActionPlaceholder />}
                        {deferredReady ? <NotificationPanel /> : <ActionPlaceholder />}
                        <ThemeSelector />
                        <Link href="/settings" className={styles.profileButton} aria-label="Your profile and settings">
                            <Avatar name={user?.name || 'User'} image={user?.image} size="sm" />
                        </Link>
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
                        const isAdd = item.href === '/transactions/new';
                        const isActive = item.href === '/transactions'
                            ? pathname === item.href || pathname.startsWith('/transactions/receipts')
                            : pathname.startsWith(item.href);
                        const Icon = item.icon;
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                data-tour={item.href}
                                aria-label={isAdd ? 'Add an expense' : item.label}
                                aria-current={isActive ? 'page' : undefined}
                                className={cn(styles.bottomNavItem, isActive && styles.bottomNavItemActive, isAdd && styles.dockAdd)}
                                onClick={() => haptics.light()}
                            >
                                <span className={styles.bottomNavIconWrap}><Icon size={isAdd ? 26 : 21} strokeWidth={isActive ? 2.2 : 1.7} /></span>
                                <span className={styles.bottomNavLabel}>{item.label}</span>
                                {isActive && !isAdd && <motion.span className={styles.bottomNavActivePill} layoutId="bottomNavActive" />}
                            </Link>
                        );
                    })}
                </div>
            </nav>}
        </div>
    );
}
