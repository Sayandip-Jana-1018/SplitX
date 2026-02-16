'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
    LayoutDashboard,
    Users,
    Receipt,
    ArrowRightLeft,
    Settings,
    Plus,
    Menu,
    LogOut,
    ChevronRight,
    BarChart3,
} from 'lucide-react';
import ClipboardBanner from '@/components/features/ClipboardBanner';
import ThemeSelector from '@/components/features/ThemeSelector';
import Avatar from '@/components/ui/Avatar';
import OfflineIndicator from '@/components/ui/OfflineIndicator';
import OnboardingTour from '@/components/features/OnboardingTour';
import { useHaptics } from '@/hooks/useHaptics';
import GlobalSearch from '@/components/ui/GlobalSearch';
import styles from './app.module.css';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
    { href: '/dashboard', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
    { href: '/groups', icon: <Users size={20} />, label: 'Groups' },
    { href: '/transactions', icon: <Receipt size={20} />, label: 'Transactions' },
    { href: '/settlements', icon: <ArrowRightLeft size={20} />, label: 'Settlements' },
    { href: '/analytics', icon: <BarChart3 size={20} />, label: 'Analytics' },
];

const BOTTOM_NAV = [
    { href: '/dashboard', icon: <LayoutDashboard size={20} />, label: 'Home' },
    { href: '/groups', icon: <Users size={20} />, label: 'Groups' },
    { href: '/transactions', icon: <Receipt size={20} />, label: 'Activity' },
    { href: '/settlements', icon: <ArrowRightLeft size={20} />, label: 'Settle' },
];

// Placeholder user for now (will come from session)
const MOCK_USER = {
    name: 'Sayan Das',
    email: 'sayan@example.com',
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const haptics = useHaptics();

    const pageTitle = NAV_ITEMS.find((item) => pathname.startsWith(item.href))?.label || 'Dashboard';

    return (
        <div className={styles.appShell}>
            <OfflineIndicator />
            <OnboardingTour />
            {/* ── Mobile Sidebar Overlay ── */}
            <AnimatePresence>
                {sidebarOpen && (
                    <motion.div
                        className={styles.sidebarOverlay}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setSidebarOpen(false)}
                    />
                )}
            </AnimatePresence>

            {/* ── Sidebar ── */}
            <aside className={cn(styles.sidebar, sidebarOpen && styles.sidebarOpen)}>
                <div className={styles.sidebarLogo}>
                    <div className={styles.sidebarLogoIcon}>⚡</div>
                    AutoSplit
                </div>

                <nav className={styles.sidebarNav}>
                    <span className={styles.sidebarSection}>Menu</span>
                    {NAV_ITEMS.map((item) => (
                        <button
                            key={item.href}
                            className={cn(
                                styles.navItem,
                                pathname.startsWith(item.href) && styles.navItemActive
                            )}
                            onClick={() => {
                                router.push(item.href);
                                setSidebarOpen(false);
                            }}
                        >
                            <span className={styles.navItemIcon}>{item.icon}</span>
                            {item.label}
                            {pathname.startsWith(item.href) && (
                                <ChevronRight size={14} style={{ marginLeft: 'auto', opacity: 0.5 }} />
                            )}
                        </button>
                    ))}

                    <span className={styles.sidebarSection}>Settings</span>
                    <button
                        className={cn(
                            styles.navItem,
                            pathname === '/settings' && styles.navItemActive
                        )}
                        onClick={() => {
                            router.push('/settings');
                            setSidebarOpen(false);
                        }}
                    >
                        <span className={styles.navItemIcon}><Settings size={20} /></span>
                        Settings
                    </button>
                </nav>

                <div className={styles.sidebarFooter}>
                    <div className={styles.userCard}>
                        <Avatar name={MOCK_USER.name} size="sm" />
                        <div>
                            <div className={styles.userName}>{MOCK_USER.name}</div>
                            <div className={styles.userEmail}>{MOCK_USER.email}</div>
                        </div>
                    </div>
                    <button
                        className={styles.navItem}
                        onClick={() => router.push('/login')}
                        style={{ color: 'var(--color-error)' }}
                    >
                        <span className={styles.navItemIcon}><LogOut size={18} /></span>
                        Sign Out
                    </button>
                </div>
            </aside>

            {/* ── Main Area ── */}
            <main className={styles.main}>
                {/* Header */}
                <header className={styles.header}>
                    <div className={styles.headerLeft}>
                        <button
                            className={styles.menuBtn}
                            onClick={() => setSidebarOpen(true)}
                            aria-label="Open menu"
                        >
                            <Menu size={22} />
                        </button>
                        <h1 className={styles.headerTitle}>{pageTitle}</h1>
                    </div>
                    <div className={styles.headerRight}>
                        <GlobalSearch />
                        <ThemeSelector />
                    </div>
                </header>

                {/* Page content with transition */}
                <motion.div
                    className={styles.pageContent}
                    key={pathname}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                >
                    <ClipboardBanner />
                    {children}
                </motion.div>
            </main>

            {/* ── FAB (mobile) ── */}
            <motion.button
                className={styles.fab}
                whileTap={{ scale: 0.9 }}
                whileHover={{ scale: 1.05 }}
                onClick={() => router.push('/transactions/new')}
                aria-label="Add expense"
            >
                <Plus size={24} />
            </motion.button>

            {/* ── Bottom Nav (mobile) ── */}
            <nav className={styles.bottomNav}>
                <div className={styles.bottomNavInner}>
                    {BOTTOM_NAV.map((item) => (
                        <button
                            key={item.href}
                            className={cn(
                                styles.bottomNavItem,
                                pathname.startsWith(item.href) && styles.bottomNavItemActive
                            )}
                            onClick={() => {
                                haptics.light();
                                router.push(item.href);
                            }}
                        >
                            {item.icon}
                            <span>{item.label}</span>
                        </button>
                    ))}
                </div>
            </nav>
        </div>
    );
}
