'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion, type PanInfo } from 'framer-motion';
import { signOutAndForget } from '@/lib/signOut';
import {
    ArrowLeft,
    ArrowRightLeft,
    ChevronRight,
    Contact,
    History as HistoryIcon,
    House,
    LogOut,
    Menu,
    PieChart,
    Plus,
    ReceiptText,
    Search,
    Settings,
    Sparkles,
    Users,
    X,
    type LucideIcon,
} from 'lucide-react';
import ClipboardBanner from '@/components/features/ClipboardBanner';
import ThemeSelector from '@/components/features/ThemeSelector';
import Avatar from '@/components/ui/Avatar';
import BrandMark from '@/components/ui/BrandMark';
import OfflineIndicator from '@/components/ui/OfflineIndicator';
import Ambient from '@/components/ui/Ambient';
import { IconButton } from '@/components/ui/kit';
import DbKeepAlive from '@/components/providers/DbKeepAlive';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import { useHaptics } from '@/hooks/useHaptics';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { usePerformanceMode } from '@/hooks/usePerformanceMode';
import { UI_EVENTS } from '@/lib/uiEvents';
import { cn } from '@/lib/utils';
import styles from './app.module.css';

const NotificationPanel = dynamic(() => import('@/components/features/NotificationPanel'), { ssr: false });
const AIChatPanel = dynamic(() => import('@/components/features/AIChatPanel'), { ssr: false });
const OnboardingTour = dynamic(() => import('@/components/features/OnboardingTour'), { ssr: false });
const GlobalSearch = dynamic(() => import('@/components/ui/GlobalSearch'), { ssr: false });

interface NavEntry {
    href: string;
    icon: LucideIcon;
    label: string;
    primary?: boolean;
}

const PRIMARY_NAV: NavEntry[] = [
    { href: '/dashboard', icon: House, label: 'Home' },
    { href: '/groups', icon: Users, label: 'Groups' },
    { href: '/transactions', icon: ReceiptText, label: 'Activity' },
    { href: '/settlements', icon: ArrowRightLeft, label: 'Settle up' },
];

const MORE_NAV: NavEntry[] = [
    { href: '/analytics', icon: PieChart, label: 'Insights' },
    { href: '/history', icon: HistoryIcon, label: 'History' },
    { href: '/contacts', icon: Contact, label: 'Contacts' },
    { href: '/settings', icon: Settings, label: 'Settings' },
];

const DOCK_ITEMS: NavEntry[] = [
    { href: '/dashboard', icon: House, label: 'Home' },
    { href: '/groups', icon: Users, label: 'Groups' },
    { href: '/transactions/new', icon: Plus, label: 'Add', primary: true },
    { href: '/transactions', icon: ReceiptText, label: 'Activity' },
    { href: '/settlements', icon: ArrowRightLeft, label: 'Settle' },
];

interface RouteMeta {
    title: string;
    back?: string;
    brand?: boolean;
    composer?: boolean;
}

/** Header title + back behaviour for every route. `back: 'history'` = browser back. */
function getRouteMeta(pathname: string): RouteMeta {
    if (pathname === '/dashboard') return { title: 'Home', brand: true };
    if (pathname === '/transactions/new') return { title: 'New expense', back: 'history', composer: true };
    if (pathname === '/transactions/scan') return { title: 'Scan receipt', back: 'history', composer: true };
    if (pathname === '/transactions/receipts') return { title: 'Receipts', back: '/transactions' };
    if (pathname.startsWith('/transactions')) return { title: 'Activity' };

    const groupMatch = pathname.match(/^\/groups\/([^/]+)(?:\/(journey|receipts))?/);
    if (groupMatch) {
        const [, groupId, section] = groupMatch;
        if (section === 'journey') return { title: 'Balance journey', back: `/groups/${groupId}` };
        if (section === 'receipts') return { title: 'Receipts', back: `/groups/${groupId}` };
        return { title: 'Group', back: '/groups' };
    }

    if (pathname.startsWith('/groups')) return { title: 'Groups' };
    if (pathname.startsWith('/settlements')) return { title: 'Settle up' };
    if (pathname.startsWith('/analytics')) return { title: 'Insights' };
    if (pathname.startsWith('/history')) return { title: 'History' };
    if (pathname.startsWith('/contacts')) return { title: 'Contacts' };
    if (pathname.startsWith('/settings')) return { title: 'Settings' };
    if (pathname.startsWith('/admin')) return { title: 'System health', back: '/settings' };
    return { title: 'SplitX' };
}

function isNavActive(href: string, pathname: string) {
    if (href === '/transactions') return pathname === '/transactions' || pathname.startsWith('/transactions/receipts');
    return pathname === href || pathname.startsWith(`${href}/`);
}

/** Header gains a frosted backdrop once content scrolls beneath it. */
function useScrolled(threshold = 6) {
    const [scrolled, setScrolled] = useState(false);
    useEffect(() => {
        let frame = 0;
        const onScroll = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => setScrolled(window.scrollY > threshold));
        };
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('scroll', onScroll);
        };
    }, [threshold]);
    return scrolled;
}

/** Hide the floating dock while the on-screen keyboard is up. */
function useSoftKeyboardOpen() {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        const nonText = ['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file', 'reset'];
        const isTextField = (target: EventTarget | null) =>
            target instanceof HTMLElement && (
                target.tagName === 'TEXTAREA'
                || (target.tagName === 'INPUT' && !nonText.includes((target as HTMLInputElement).type))
                || target.isContentEditable
            );
        let timer = 0;
        const onFocusIn = (event: FocusEvent) => {
            if (isTextField(event.target)) setOpen(true);
        };
        const onFocusOut = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => setOpen(isTextField(document.activeElement)), 80);
        };
        document.addEventListener('focusin', onFocusIn);
        document.addEventListener('focusout', onFocusOut);
        return () => {
            window.clearTimeout(timer);
            document.removeEventListener('focusin', onFocusIn);
            document.removeEventListener('focusout', onFocusOut);
        };
    }, []);
    return open;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const haptics = useHaptics();
    const { user } = useCurrentUser();
    const { mode } = usePerformanceMode();
    const isDesktop = useMediaQuery('(min-width: 1024px)');
    const coarsePointer = useMediaQuery('(pointer: coarse)');
    const scrolled = useScrolled();
    const keyboardOpen = useSoftKeyboardOpen();

    // Drawer state is tied to the path it was opened on, so any navigation closes it.
    const [drawerPath, setDrawerPath] = useState<string | null>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [assistantOpen, setAssistantOpen] = useState(false);
    const [deferredReady, setDeferredReady] = useState(false);
    const [tourReady, setTourReady] = useState(false);

    const drawerOpen = drawerPath === pathname && !isDesktop;
    const closeDrawer = useCallback(() => setDrawerPath(null), []);
    const drawerRef = useDialogFocus(drawerOpen, closeDrawer);

    const meta = useMemo(() => getRouteMeta(pathname), [pathname]);
    const isPrintRoute = pathname.endsWith('/journey/print');
    const showChrome = !isPrintRoute;
    const showDock = showChrome && !meta.composer;
    const dockHidden = keyboardOpen && coarsePointer;

    useEffect(() => {
        document.documentElement.dataset.motion = mode;
    }, [mode]);

    useEffect(() => {
        [...PRIMARY_NAV, ...MORE_NAV].forEach((item) => router.prefetch(item.href));
        router.prefetch('/transactions/new');
    }, [router]);

    useEffect(() => {
        if (!showChrome) return;
        const idle = window.requestIdleCallback?.(() => setDeferredReady(true), { timeout: 600 });
        const fallback = window.setTimeout(() => setDeferredReady(true), mode === 'premium' ? 250 : 400);
        const tour = window.setTimeout(() => setTourReady(true), 1800);
        return () => {
            if (idle) window.cancelIdleCallback?.(idle);
            window.clearTimeout(fallback);
            window.clearTimeout(tour);
        };
    }, [mode, showChrome]);

    useEffect(() => {
        const onAssistant = () => setAssistantOpen(true);
        window.addEventListener(UI_EVENTS.openAssistant, onAssistant);
        return () => {
            window.removeEventListener(UI_EVENTS.openAssistant, onAssistant);
        };
    }, []);

    const goBack = useCallback(() => {
        haptics.light();
        if (meta.back && meta.back !== 'history') {
            router.push(meta.back);
            return;
        }
        if (window.history.length > 1) router.back();
        else router.push('/dashboard');
    }, [haptics, meta.back, router]);

    const openDrawer = () => {
        haptics.light();
        setDrawerPath(pathname);
    };

    const openSearchPalette = () => {
        closeDrawer();
        setSearchOpen(true);
    };

    const handleDrawerDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        if (info.offset.x < -80 || info.velocity.x < -500) closeDrawer();
    };

    return (
        <div className={cn(styles.shell, isPrintRoute && styles.printShell)}>
            {showChrome && <Ambient variant="subtle" glyphs={false} />}
            {showChrome && <a className={styles.skipLink} href="#workspace">Skip to content</a>}
            {showChrome && <OfflineIndicator />}
            <DbKeepAlive />
            {showChrome && tourReady && <OnboardingTour />}

            {/* ── Desktop sidebar ── */}
            {showChrome && (
                <aside className={styles.sidebar} aria-label="Sidebar">
                    <NavPanel pathname={pathname} user={user} variant="sidebar" onSearch={openSearchPalette} />
                </aside>
            )}

            {/* ── Mobile drawer ── */}
            <AnimatePresence>
                {showChrome && drawerOpen && (
                    <motion.div
                        key="drawer-scrim"
                        className={styles.scrim}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.22 }}
                        onClick={closeDrawer}
                    />
                )}
                {showChrome && drawerOpen && (
                    <motion.aside
                        key="drawer"
                        ref={drawerRef}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Navigation menu"
                        tabIndex={-1}
                        data-focus-dialog
                        className={styles.drawer}
                        initial={{ x: '-104%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '-104%' }}
                        transition={{ type: 'spring', stiffness: 420, damping: 42 }}
                        drag="x"
                        dragConstraints={{ left: 0, right: 0 }}
                        dragElastic={{ left: 0.6, right: 0 }}
                        onDragEnd={handleDrawerDragEnd}
                        style={{ touchAction: 'pan-y' }}
                    >
                        <NavPanel
                            pathname={pathname}
                            user={user}
                            variant="drawer"
                            onSearch={openSearchPalette}
                            onClose={closeDrawer}
                        />
                    </motion.aside>
                )}
            </AnimatePresence>

            <div className={styles.main}>
                {showChrome && (
                    <header className={cn(styles.header, scrolled && styles.headerScrolled)}>
                        <div className={styles.headerInner}>
                            <div className={styles.headerStart}>
                                {meta.back ? (
                                    <IconButton icon={<ArrowLeft size={19} />} label="Go back" onClick={goBack} />
                                ) : (
                                    <IconButton
                                        icon={<Menu size={19} />}
                                        label="Open menu"
                                        onClick={openDrawer}
                                        className={styles.mobileOnly}
                                    />
                                )}
                                {!meta.composer && (
                                    <IconButton
                                        icon={(
                                            <motion.span
                                                className={styles.liveIcon}
                                                animate={{ scale: [1, 1.16, 1], rotate: [0, 8, -6, 0] }}
                                                transition={{ duration: 3.2, repeat: Infinity, repeatDelay: 2.4, ease: 'easeInOut' }}
                                            >
                                                <Sparkles size={18} />
                                            </motion.span>
                                        )}
                                        label="Ask SplitX AI"
                                        onClick={() => setAssistantOpen(true)}
                                        tour="ai"
                                    />
                                )}
                            </div>

                            <div className={styles.headerCenter}>
                                <motion.div
                                    key={meta.brand ? 'brand' : meta.title}
                                    className={styles.headerTitleWrap}
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                                >
                                    {meta.brand ? (
                                        <BrandMark size={28} />
                                    ) : (
                                        <h1 className={styles.headerTitle}>{meta.title}</h1>
                                    )}
                                </motion.div>
                            </div>

                            <div className={styles.headerEnd}>
                                <ThemeSelector size={38} />
                                {deferredReady ? <NotificationPanel /> : <span className={styles.headerPlaceholder} />}
                            </div>
                        </div>
                    </header>
                )}

                <main
                    id="workspace"
                    className={cn(
                        styles.content,
                        meta.composer && styles.contentComposer,
                        isPrintRoute && styles.printContent,
                    )}
                >
                    {showChrome && <ClipboardBanner />}
                    {children}
                </main>
            </div>

            {showChrome && (deferredReady || searchOpen) && (
                <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
            )}

            {showChrome && !meta.composer && (deferredReady || assistantOpen) && (
                <AIChatPanel open={assistantOpen} onOpenChange={setAssistantOpen} />
            )}

            {/* ── Floating dock (phones & tablets) ── */}
            {showDock && (
                <nav className={cn(styles.dock, dockHidden && styles.dockHidden)} aria-label="Primary">
                    <div className={styles.dockInner}>
                        {DOCK_ITEMS.map((item) => {
                            const Icon = item.icon;
                            if (item.primary) {
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={styles.dockAdd}
                                        aria-label="Add an expense"
                                        data-tour={item.href}
                                        onClick={() => haptics.medium()}
                                    >
                                        <motion.span
                                            className={styles.dockAddGlyph}
                                            animate={{ y: [0, -3, 0], scale: [1, 1.08, 1] }}
                                            transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
                                        >
                                            <Icon size={24} strokeWidth={2.6} />
                                        </motion.span>
                                    </Link>
                                );
                            }
                            const active = isNavActive(item.href, pathname);
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={cn(styles.dockItem, active && styles.dockItemActive)}
                                    aria-current={active ? 'page' : undefined}
                                    data-tour={item.href}
                                    onClick={() => haptics.light()}
                                >
                                    {active && (
                                        <motion.span
                                            layoutId="dock-active-pill"
                                            className={styles.dockPill}
                                            transition={{ type: 'spring', stiffness: 520, damping: 38 }}
                                        />
                                    )}
                                    <motion.span
                                        className={styles.dockIcon}
                                        animate={active ? { y: -1, scale: 1.06 } : { y: 0, scale: 1 }}
                                        transition={{ type: 'spring', stiffness: 520, damping: 26 }}
                                    >
                                        <Icon size={21} strokeWidth={active ? 2.3 : 1.8} />
                                    </motion.span>
                                    <span className={styles.dockLabel}>{item.label}</span>
                                </Link>
                            );
                        })}
                    </div>
                </nav>
            )}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Navigation panel — shared by the mobile drawer & desktop sidebar
   ═══════════════════════════════════════════════════════════════ */

function NavPanel({
    pathname,
    user,
    variant,
    onSearch,
    onClose,
}: {
    pathname: string;
    user: ReturnType<typeof useCurrentUser>['user'];
    variant: 'drawer' | 'sidebar';
    onSearch: () => void;
    onClose?: () => void;
}) {
    return (
        <div className={styles.nav}>
            <div className={styles.navTop}>
                <Link href="/dashboard" className={styles.navBrand} aria-label="SplitX home" onClick={onClose}>
                    <BrandMark size={32} />
                </Link>
                {variant === 'drawer' && (
                    <IconButton icon={<X size={18} />} label="Close menu" onClick={onClose} variant="ghost" />
                )}
            </div>

            <Link href="/settings" className={styles.profileCard} onClick={onClose}>
                <Avatar name={user?.name || 'You'} image={user?.image} size="lg" />
                <span className={styles.profileText}>
                    <span className={styles.profileName}>{user?.name || 'Your profile'}</span>
                    <span className={styles.profileEmail}>{user?.email || 'Manage your account'}</span>
                </span>
                <ChevronRight size={18} className={styles.profileChevron} />
            </Link>

            <button type="button" className={styles.searchField} onClick={onSearch}>
                <Search size={17} />
                <span>Search groups & expenses</span>
                <kbd className={styles.kbd}>⌘K</kbd>
            </button>

            <nav className={styles.navList} aria-label="Main navigation">
                <span className={styles.navLabel}>Menu</span>
                {PRIMARY_NAV.map((item) => (
                    <NavItem
                        key={item.href}
                        item={item}
                        active={isNavActive(item.href, pathname)}
                        layoutId={`${variant}-nav-active`}
                        onNavigate={onClose}
                    />
                ))}
                <span className={styles.navLabel}>More</span>
                {MORE_NAV.map((item) => (
                    <NavItem
                        key={item.href}
                        item={item}
                        active={isNavActive(item.href, pathname)}
                        layoutId={`${variant}-nav-active`}
                        onNavigate={onClose}
                    />
                ))}
            </nav>

            <div className={styles.navFooter}>
                <button type="button" className={styles.signOut} onClick={() => signOutAndForget('/login')}>
                    <LogOut size={17} />
                    Sign out
                </button>
            </div>
        </div>
    );
}

function NavItem({
    item,
    active,
    layoutId,
    onNavigate,
}: {
    item: NavEntry;
    active: boolean;
    layoutId: string;
    onNavigate?: () => void;
}) {
    const Icon = item.icon;
    return (
        <Link
            href={item.href}
            className={cn(styles.navItem, active && styles.navItemActive)}
            aria-current={active ? 'page' : undefined}
            onClick={onNavigate}
        >
            {active && (
                <motion.span
                    layoutId={layoutId}
                    className={styles.navItemBg}
                    transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                />
            )}
            <span className={styles.navIcon}>
                <Icon size={18} strokeWidth={active ? 2.3 : 1.9} />
            </span>
            <span className={styles.navText}>{item.label}</span>
            {active && <ChevronRight size={16} className={styles.navChevron} />}
        </Link>
    );
}
