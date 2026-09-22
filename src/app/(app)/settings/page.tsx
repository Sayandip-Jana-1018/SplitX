'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { signOutAndForget } from '@/lib/signOut';
import {
    AlertTriangle,
    AtSign,
    Camera,
    Compass,
    Download,
    Info,
    LogOut,
    MonitorSmartphone,
    PencilLine,
    Smartphone,
    Sparkles,
    Trash2,
    User,
    Wallet,
} from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import { IconTile, ListGroup, ListRow, Section, Spinner, Stagger, StaggerItem, Tag } from '@/components/ui/kit';
import { useToast } from '@/components/ui/Toast';
import { PalettePicker, ThemeModeSwitch } from '@/components/features/ThemeSelector';
import { useThemeContext } from '@/components/providers/ThemeProvider';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { openAssistant, startTour } from '@/lib/uiEvents';
import styles from './settings.module.css';

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const APP_VERSION = '1.0.0';
const UPI_PATTERN = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/;
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function errorMessage(data: unknown, fallback: string) {
    const error = (data as { error?: unknown } | null)?.error;
    return typeof error === 'string' && error ? error : fallback;
}

export default function SettingsPage() {
    const router = useRouter();
    const { palette, setPalette } = useThemeContext();
    const { user, loading, refresh } = useCurrentUser();
    const { toast } = useToast();
    const standalone = useMediaQuery('(display-mode: standalone)', false);
    const fileRef = useRef<HTMLInputElement>(null);

    const [sheet, setSheet] = useState<'profile' | 'delete' | 'sessions' | null>(null);
    const [form, setForm] = useState({ name: '', phone: '', upiId: '' });
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [endingSessions, setEndingSessions] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [installedNow, setInstalledNow] = useState(false);
    const isInstalled = standalone || installedNow;

    useEffect(() => {
        const handlePrompt = (event: Event) => {
            event.preventDefault();
            setInstallPrompt(event as BeforeInstallPromptEvent);
        };
        const handleInstalled = () => {
            setInstallPrompt(null);
            setInstalledNow(true);
            toast('SplitX is installed on this device', 'success');
        };
        window.addEventListener('beforeinstallprompt', handlePrompt);
        window.addEventListener('appinstalled', handleInstalled);
        return () => {
            window.removeEventListener('beforeinstallprompt', handlePrompt);
            window.removeEventListener('appinstalled', handleInstalled);
        };
    }, [toast]);

    const upiValue = form.upiId.trim();
    const upiInvalid = upiValue.length > 0 && !UPI_PATTERN.test(upiValue);
    const memberSince = user?.createdAt
        ? new Date(user.createdAt).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
        : null;

    const openProfile = () => {
        setForm({ name: user?.name || '', phone: user?.phone || '', upiId: user?.upiId || '' });
        setSheet('profile');
    };

    const saveProfile = async () => {
        setSaving(true);
        try {
            const res = await fetch('/api/me', {
                method: 'PATCH',
                headers: JSON_HEADERS,
                body: JSON.stringify({ name: form.name.trim(), phone: form.phone.trim(), upiId: upiValue }),
            });
            if (res.ok) {
                toast('Profile updated', 'success');
                setSheet(null);
                await refresh();
            } else {
                toast(errorMessage(await res.json().catch(() => null), 'Could not update your profile'), 'error');
            }
        } catch {
            toast('Network error — try again', 'error');
        } finally {
            setSaving(false);
        }
    };

    const uploadAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (!AVATAR_TYPES.includes(file.type)) {
            toast('Use a JPEG, PNG, WebP or GIF image', 'error');
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            toast('Images must be under 2 MB', 'error');
            return;
        }

        setUploading(true);
        try {
            const body = new FormData();
            body.append('file', file);
            const res = await fetch('/api/me/avatar', { method: 'POST', body });
            if (res.ok) {
                toast('Photo updated', 'success');
                await refresh();
            } else {
                toast(errorMessage(await res.json().catch(() => null), 'Upload failed'), 'error');
            }
        } catch {
            toast('Network error — try again', 'error');
        } finally {
            setUploading(false);
        }
    };

    const exportData = async () => {
        setExporting(true);
        try {
            const res = await fetch('/api/me/export');
            if (!res.ok) {
                toast('Could not export your data', 'error');
                return;
            }
            const data = await res.json();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `splitx-export-${new Date().toISOString().split('T')[0]}.json`;
            link.click();
            URL.revokeObjectURL(url);
            toast('Your data is downloading', 'success');
        } catch {
            toast('Network error — try again', 'error');
        } finally {
            setExporting(false);
        }
    };

    const installApp = async () => {
        if (!installPrompt) {
            toast('Open your browser menu and choose “Add to Home screen”.', 'info');
            return;
        }
        try {
            await installPrompt.prompt();
            const choice = await installPrompt.userChoice;
            if (choice.outcome === 'accepted') toast('Installing SplitX…', 'success');
        } catch {
            toast('The install prompt isn’t available right now', 'error');
        } finally {
            setInstallPrompt(null);
        }
    };

    const deleteAccount = async () => {
        setDeleting(true);
        try {
            const res = await fetch('/api/me', { method: 'DELETE' });
            if (res.ok) {
                toast('Your account was deleted', 'success');
                await signOutAndForget('/login');
            } else {
                toast(errorMessage(await res.json().catch(() => null), 'Could not delete your account'), 'error');
                setDeleting(false);
            }
        } catch {
            toast('Network error — try again', 'error');
            setDeleting(false);
        }
    };

    const signOutEverywhere = async () => {
        setEndingSessions(true);
        try {
            const res = await fetch('/api/me/sessions', { method: 'DELETE' });
            if (res.ok) {
                toast('Signed out of every device', 'success');
                await signOutAndForget('/login');
            } else {
                toast(errorMessage(await res.json().catch(() => null), 'Could not sign out of your other devices'), 'error');
                setEndingSessions(false);
            }
        } catch {
            toast('Network error — try again', 'error');
            setEndingSessions(false);
        }
    };

    const handleSignOut = async () => {
        try {
            await signOutAndForget('/login');
        } catch {
            window.location.href = '/login';
        }
    };

    const replayTour = () => {
        startTour();
        router.push('/dashboard');
    };

    return (
        <>
            <Stagger className={styles.page}>
                {/* ── Profile ── */}
                <StaggerItem>
                    <section className={styles.profile}>
                        {loading && !user ? (
                            <div className={styles.profileSkeleton} aria-hidden="true">
                                <span className={styles.skeletonCircle} />
                                <span className={styles.skeletonLine} style={{ width: 150, height: 20 }} />
                                <span className={styles.skeletonLine} style={{ width: 200 }} />
                            </div>
                        ) : (
                            <>
                                <div className={styles.avatarWrap}>
                                    <span className={styles.avatarRing}>
                                        <span className={styles.avatarInner}>
                                            <Avatar name={user?.name || 'You'} image={user?.image} size="xl" />
                                        </span>
                                    </span>
                                    <button
                                        type="button"
                                        className={styles.cameraButton}
                                        onClick={() => fileRef.current?.click()}
                                        disabled={uploading}
                                        aria-label="Change profile photo"
                                    >
                                        {uploading ? <Spinner size={13} /> : <Camera size={14} />}
                                    </button>
                                    <input
                                        ref={fileRef}
                                        type="file"
                                        accept={AVATAR_TYPES.join(',')}
                                        hidden
                                        onChange={uploadAvatar}
                                    />
                                </div>
                                <h1 className={styles.name}>{user?.name || 'Your profile'}</h1>
                                {user?.email && <p className={styles.email}>{user.email}</p>}
                                <div className={styles.profileMeta}>
                                    {memberSince && <Tag>Since {memberSince}</Tag>}
                                    {user?.upiId
                                        ? <Tag tone="success" icon={<Wallet size={11} />}>UPI ready</Tag>
                                        : <Tag tone="warning" icon={<Wallet size={11} />}>No UPI ID</Tag>}
                                </div>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className={styles.editButton}
                                    leftIcon={<PencilLine size={15} />}
                                    onClick={openProfile}
                                >
                                    Edit profile
                                </Button>
                            </>
                        )}
                    </section>
                </StaggerItem>

                {/* ── Getting paid ── */}
                <StaggerItem>
                    <Section title="Getting paid" subtitle="Friends use these to pay you back">
                        <ListGroup>
                            <ListRow
                                onClick={openProfile}
                                leading={<IconTile tone={user?.upiId ? 'success' : 'warning'}><Wallet size={18} /></IconTile>}
                                title="UPI ID"
                                subtitle={user?.upiId || 'Add yours to get paid in one tap'}
                                trailing={user?.upiId ? undefined : <Tag tone="warning">Add</Tag>}
                                chevron
                            />
                            <ListRow
                                onClick={openProfile}
                                leading={<IconTile tone="neutral"><Smartphone size={18} /></IconTile>}
                                title="Phone"
                                subtitle={user?.phone || 'Not added'}
                                chevron
                            />
                        </ListGroup>
                    </Section>
                </StaggerItem>

                {/* ── Appearance ── */}
                <StaggerItem>
                    <Section title="Appearance">
                        <div className={styles.panel}>
                            <div className={styles.panelBlock}>
                                <span className={styles.panelLabel}>Mode</span>
                                <ThemeModeSwitch />
                            </div>
                            <div className={styles.panelDivider} />
                            <div className={styles.panelBlock}>
                                <span className={styles.panelLabel}>Accent colour</span>
                                <PalettePicker value={palette} onChange={setPalette} />
                            </div>
                        </div>
                    </Section>
                </StaggerItem>

                {/* ── Help ── */}
                <StaggerItem>
                    <Section title="Help">
                        <ListGroup>
                            <ListRow
                                onClick={openAssistant}
                                leading={<IconTile><Sparkles size={18} /></IconTile>}
                                title="Ask SplitX AI"
                                subtitle="Balances, groups, spending — just ask"
                                chevron
                            />
                            <ListRow
                                onClick={replayTour}
                                leading={<IconTile tone="neutral"><Compass size={18} /></IconTile>}
                                title="Replay the tour"
                                subtitle="A quick walkthrough of the app"
                                chevron
                            />
                        </ListGroup>
                    </Section>
                </StaggerItem>

                {/* ── Data ── */}
                <StaggerItem>
                    <Section title="Your data">
                        <ListGroup>
                            <ListRow
                                onClick={exporting ? undefined : exportData}
                                leading={<IconTile tone="neutral"><Download size={18} /></IconTile>}
                                title="Export my data"
                                subtitle="Download everything as a JSON file"
                                trailing={exporting ? <Spinner size={16} /> : undefined}
                                chevron={!exporting}
                            />
                            <ListRow
                                onClick={() => setSheet('sessions')}
                                leading={<IconTile tone="neutral"><LogOut size={18} /></IconTile>}
                                title="Sign out of all devices"
                                subtitle="Ends every session, on this device too"
                                chevron
                            />
                            <ListRow
                                onClick={() => {
                                    setConfirmText('');
                                    setSheet('delete');
                                }}
                                leading={<IconTile tone="danger"><Trash2 size={18} /></IconTile>}
                                title="Delete account"
                                subtitle="Erase your details and leave every group"
                                tone="danger"
                                chevron
                            />
                        </ListGroup>
                    </Section>
                </StaggerItem>

                {/* ── App ── */}
                <StaggerItem>
                    <Section title="App">
                        <ListGroup>
                            <ListRow
                                onClick={isInstalled ? undefined : installApp}
                                leading={<IconTile tone="neutral"><MonitorSmartphone size={18} /></IconTile>}
                                title={isInstalled ? 'Installed' : 'Install SplitX'}
                                subtitle={isInstalled
                                    ? 'Running as an app on this device'
                                    : installPrompt ? 'Add it to your home screen in one tap' : 'Works offline, opens instantly'}
                                trailing={isInstalled ? <Tag tone="success">Installed</Tag> : undefined}
                                chevron={!isInstalled}
                            />
                            <ListRow
                                leading={<IconTile tone="neutral"><Info size={18} /></IconTile>}
                                title="Version"
                                trailing={<span className={styles.version}>{APP_VERSION}</span>}
                            />
                        </ListGroup>
                    </Section>
                </StaggerItem>

                <StaggerItem>
                    <motion.button type="button" whileTap={{ scale: 0.98 }} className={styles.signOut} onClick={handleSignOut}>
                        <LogOut size={17} />
                        Sign out
                    </motion.button>
                </StaggerItem>
                <StaggerItem>
                    <p className={styles.footer}>SplitX {APP_VERSION} · Split fairly, settle instantly</p>
                </StaggerItem>
            </Stagger>

            {/* ── Edit profile ── */}
            <Modal isOpen={sheet === 'profile'} onClose={() => !saving && setSheet(null)} title="Edit profile" size="small">
                <div className={styles.sheet}>
                    <Input
                        label="Name"
                        value={form.name}
                        onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                        leftIcon={<User size={16} />}
                        autoComplete="name"
                    />
                    <Input
                        label="Phone"
                        value={form.phone}
                        onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                        leftIcon={<Smartphone size={16} />}
                        placeholder="+91 98765 43210"
                        inputMode="tel"
                        autoComplete="tel"
                    />
                    <Input
                        label="UPI ID"
                        value={form.upiId}
                        onChange={(event) => setForm((prev) => ({ ...prev, upiId: event.target.value }))}
                        leftIcon={<AtSign size={16} />}
                        placeholder="name@okaxis"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        error={upiInvalid ? 'That doesn’t look like a UPI ID (e.g. name@okaxis)' : undefined}
                        hint="Shown to friends when they settle up with you"
                    />
                    <Button fullWidth size="lg" loading={saving} disabled={!form.name.trim() || upiInvalid} onClick={saveProfile}>
                        Save changes
                    </Button>
                </div>
            </Modal>

            {/* ── Sign out of all devices ── */}
            <Modal isOpen={sheet === 'sessions'} onClose={() => !endingSessions && setSheet(null)} title="Sign out of all devices" size="small">
                <div className={styles.confirm}>
                    <span className={styles.confirmIcon}><LogOut size={26} /></span>
                    <p className={styles.confirmTitle}>Sign out everywhere?</p>
                    <p className={styles.confirmText}>
                        Every phone and browser signed in to your account is signed out within a minute, this one
                        included. Use it if you lost a device or signed in on one that isn&apos;t yours.
                    </p>
                    <div className={styles.twoUp}>
                        <Button variant="secondary" onClick={() => setSheet(null)} disabled={endingSessions}>Cancel</Button>
                        <Button variant="danger" leftIcon={<LogOut size={16} />} loading={endingSessions} onClick={signOutEverywhere}>
                            Sign out all
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* ── Delete account ── */}
            <Modal isOpen={sheet === 'delete'} onClose={() => !deleting && setSheet(null)} title="Delete account" size="small">
                <div className={styles.confirm}>
                    <span className={styles.confirmIcon}><AlertTriangle size={26} /></span>
                    <p className={styles.confirmTitle}>This can&apos;t be undone</p>
                    <p className={styles.confirmText}>
                        Your name, email, photo and payment details are erased, you leave every group, and you
                        are signed out everywhere. Expenses and payments you were part of stay in each
                        group&apos;s history as &ldquo;Deleted user&rdquo;, so everyone&apos;s balances still add up,
                        and groups you own pass to their longest-standing member. Settle up first: you can&apos;t
                        delete while you owe or are owed money.
                    </p>
                    <Input
                        label="Type DELETE to confirm"
                        value={confirmText}
                        onChange={(event) => setConfirmText(event.target.value)}
                        autoCapitalize="characters"
                        autoComplete="off"
                        wrapperClassName={styles.confirmInput}
                    />
                    <div className={styles.twoUp}>
                        <Button variant="secondary" onClick={() => setSheet(null)} disabled={deleting}>Cancel</Button>
                        <Button
                            variant="danger"
                            leftIcon={<Trash2 size={16} />}
                            loading={deleting}
                            disabled={confirmText.trim().toUpperCase() !== 'DELETE'}
                            onClick={deleteAccount}
                        >
                            Delete
                        </Button>
                    </div>
                </div>
            </Modal>
        </>
    );
}
