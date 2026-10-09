'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import {
    ArrowRightLeft,
    ChevronDown,
    Contact,
    History as HistoryIcon,
    House,
    LogOut,
    PieChart,
    Plus,
    ReceiptText,
    Search,
    Settings,
    Sparkles,
    Users,
    type LucideIcon,
} from 'lucide-react';
import ThemeSelector from '@/components/features/ThemeSelector';
import Avatar from '@/components/ui/Avatar';
import BrandMark from '@/components/ui/BrandMark';
import { IconButton } from '@/components/ui/kit';
import type { useCurrentUser } from '@/hooks/useCurrentUser';
import { isNavActive } from '@/lib/navigation';
import { signOutAndForget } from '@/lib/signOut';
import { cn } from '@/lib/utils';
import styles from './appTopBar.module.css';

interface NavEntry {
    href: string;
    icon: LucideIcon;
    label: string;
}

/** The destinations on the bar itself; the rest live in the account menu. */
const TOP_NAV: NavEntry[] = [
    { href: '/dashboard', icon: House, label: 'Home' },
    { href: '/groups', icon: Users, label: 'Groups' },
    { href: '/transactions', icon: ReceiptText, label: 'Activity' },
    { href: '/settlements', icon: ArrowRightLeft, label: 'Settle up' },
    { href: '/analytics', icon: PieChart, label: 'Insights' },
];

const ACCOUNT_NAV: NavEntry[] = [
    { href: '/settings', icon: Settings, label: 'Profile & settings' },
    { href: '/contacts', icon: Contact, label: 'Contacts' },
    { href: '/history', icon: HistoryIcon, label: 'Balance history' },
];

type CurrentUser = ReturnType<typeof useCurrentUser>['user'];

const subscribeNever = () => () => undefined;

/** "⌘K" on a Mac, "Ctrl K" everywhere else (the search palette answers both). */
function useSearchShortcut() {
    return useSyncExternalStore(
        subscribeNever,
        () => (/Macintosh|Mac OS X/.test(navigator.userAgent) ? '⌘K' : 'Ctrl K'),
        () => 'Ctrl K',
    );
}

/**
 * The desktop top bar (≥1024px): the brand, the main destinations, then search, the
 * assistant, a primary "Add expense", theme, notifications and the account menu.
 * Phones and tablets keep their own header and floating dock; this renders hidden there.
 */
export default function AppTopBar({
    pathname,
    user,
    scrolled,
    notifications,
    onSearch,
    onAssistant,
}: {
    pathname: string;
    user: CurrentUser;
    scrolled: boolean;
    notifications: ReactNode;
    onSearch: () => void;
    onAssistant: () => void;
}) {
    const shortcut = useSearchShortcut();

    return (
        <header className={cn(styles.bar, scrolled && styles.barScrolled)}>
            <div className={styles.inner}>
                <Link href="/dashboard" className={styles.brand} aria-label="SplitX home">
                    <BrandMark size={30} />
                </Link>

                <nav className={styles.nav} aria-label="Main navigation">
                    {TOP_NAV.map((item) => {
                        const Icon = item.icon;
                        const active = isNavActive(item.href, pathname);
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={cn(styles.link, active && styles.linkActive)}
                                aria-current={active ? 'page' : undefined}
                                data-tour={item.href}
                            >
                                {active && (
                                    <motion.span
                                        layoutId="topbar-active"
                                        className={styles.linkPill}
                                        transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                                    />
                                )}
                                <Icon size={17} strokeWidth={active ? 2.3 : 1.9} className={styles.linkIcon} aria-hidden="true" />
                                {item.label}
                            </Link>
                        );
                    })}
                </nav>

                <div className={styles.actions}>
                    <button
                        type="button"
                        className={styles.search}
                        onClick={onSearch}
                        aria-label="Search groups and expenses"
                        aria-keyshortcuts="Control+K Meta+K"
                        title={`Search (${shortcut})`}
                    >
                        <Search size={16} />
                        <span className={styles.searchLabel}>Search</span>
                        <kbd className={styles.kbd}>{shortcut}</kbd>
                    </button>
                    <IconButton
                        icon={(
                            <motion.span
                                className={styles.sparkle}
                                animate={{ scale: [1, 1.16, 1], rotate: [0, 8, -6, 0] }}
                                transition={{ duration: 3.2, repeat: Infinity, repeatDelay: 2.4, ease: 'easeInOut' }}
                            >
                                <Sparkles size={18} />
                            </motion.span>
                        )}
                        label="Ask SplitX AI"
                        onClick={onAssistant}
                        tour="ai"
                    />
                    <Link href="/transactions/new" className={styles.add} data-tour="/transactions/new">
                        <Plus size={18} strokeWidth={2.6} aria-hidden="true" />
                        <span className={styles.addLong}>Add expense</span>
                        <span className={styles.addShort}>Add</span>
                    </Link>
                    <span className={styles.divider} aria-hidden="true" />
                    <ThemeSelector size={40} />
                    {notifications}
                    <AccountMenu user={user} pathname={pathname} />
                </div>
            </div>
        </header>
    );
}

function AccountMenu({ user, pathname }: { user: CurrentUser; pathname: string }) {
    // Tied to the path it was opened on, so any navigation closes it (as the drawer does).
    const [openPath, setOpenPath] = useState<string | null>(null);
    const open = openPath === pathname;
    const rootRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const close = useCallback((restoreFocus = false) => {
        setOpenPath(null);
        if (restoreFocus) buttonRef.current?.focus();
    }, []);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) close();
        };
        const onKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close(true);
            }
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open, close]);

    const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
        const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
        if (items.length === 0) return;
        const current = items.indexOf(document.activeElement as HTMLElement);
        let next = 0;
        if (event.key === 'End') next = items.length - 1;
        else if (event.key === 'ArrowDown') next = (current + 1) % items.length;
        else if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
        items[next].focus();
    };

    return (
        <div className={styles.account} ref={rootRef}>
            <button
                ref={buttonRef}
                type="button"
                className={cn(styles.accountButton, open && styles.accountButtonOpen)}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="Your account"
                onClick={() => setOpenPath(open ? null : pathname)}
            >
                <Avatar name={user?.name || 'You'} image={user?.image} size="sm" />
                <ChevronDown size={15} className={styles.accountChevron} aria-hidden="true" />
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        ref={menuRef}
                        role="menu"
                        aria-label="Your account"
                        className={styles.menu}
                        onKeyDown={moveFocus}
                        initial={{ opacity: 0, y: -6, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.98 }}
                        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                    >
                        <div className={styles.menuHead}>
                            <Avatar name={user?.name || 'You'} image={user?.image} size="md" />
                            <span className={styles.menuWho}>
                                <span className={styles.menuName}>{user?.name || 'Your profile'}</span>
                                {user?.email && <span className={styles.menuEmail}>{user.email}</span>}
                            </span>
                        </div>
                        {ACCOUNT_NAV.map((item) => {
                            const Icon = item.icon;
                            const active = isNavActive(item.href, pathname);
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    role="menuitem"
                                    className={cn(styles.menuItem, active && styles.menuItemActive)}
                                    aria-current={active ? 'page' : undefined}
                                    onClick={() => close()}
                                >
                                    <span className={styles.menuIcon}><Icon size={16} /></span>
                                    {item.label}
                                </Link>
                            );
                        })}
                        <span className={styles.menuSeparator} role="separator" />
                        <button
                            type="button"
                            role="menuitem"
                            className={cn(styles.menuItem, styles.menuDanger)}
                            onClick={() => signOutAndForget('/login')}
                        >
                            <span className={styles.menuIcon}><LogOut size={16} /></span>
                            Sign out
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
