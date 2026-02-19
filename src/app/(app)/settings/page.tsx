'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { User, Palette, Moon, Sun, Bell, Shield, LogOut, ChevronRight, Smartphone, Check, Loader2, Save, Settings, Camera } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useThemeContext, COLOR_PALETTES } from '@/components/providers/ThemeProvider';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/components/ui/Toast';
import { signOut } from 'next-auth/react';

/* ── Glassmorphic styles ── */
const glass: React.CSSProperties = {
    background: 'var(--bg-glass)',
    backdropFilter: 'blur(24px) saturate(1.5)',
    WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
    border: '1px solid var(--border-glass)',
    borderRadius: 'var(--radius-xl)',
    boxShadow: 'var(--shadow-card)',
    position: 'relative',
    overflow: 'hidden',
};

export default function SettingsPage() {
    const { theme, palette, setTheme, setPalette } = useThemeContext();
    const { user, loading: userLoading, refresh: refreshUser } = useCurrentUser();
    const { toast } = useToast();

    const [editingProfile, setEditingProfile] = useState(false);
    const [editName, setEditName] = useState('');
    const [editPhone, setEditPhone] = useState('');
    const [editUpiId, setEditUpiId] = useState('');
    const [savingProfile, setSavingProfile] = useState(false);
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
    const [mounted, setMounted] = useState(false);

    useEffect(() => { setMounted(true); }, []);

    useEffect(() => {
        if (user) {
            setEditName(user.name || '');
            setEditPhone(user.phone || '');
            setEditUpiId(user.upiId || '');
        }
    }, [user]);

    const handleSaveProfile = async () => {
        setSavingProfile(true);
        try {
            const res = await fetch('/api/me', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: editName.trim(),
                    phone: editPhone.trim(),
                    upiId: editUpiId.trim(),
                }),
            });
            if (res.ok) {
                toast('Profile updated', 'success');
                setEditingProfile(false);
                // Refresh cached user so data persists across navigations
                await refreshUser();
            } else {
                toast('Failed to update', 'error');
            }
        } catch {
            toast('Network error', 'error');
        } finally {
            setSavingProfile(false);
        }
    };

    const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!validTypes.includes(file.type)) {
            toast('Please use JPEG, PNG, WebP, or GIF', 'error');
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            toast('Image must be under 2MB', 'error');
            return;
        }

        setUploadingAvatar(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch('/api/me/avatar', { method: 'POST', body: formData });
            if (res.ok) {
                toast('Avatar updated!', 'success');
                window.location.reload();
            } else {
                const data = await res.json();
                toast(data.error || 'Upload failed', 'error');
            }
        } catch {
            toast('Network error', 'error');
        } finally {
            setUploadingAvatar(false);
        }
    };

    const handleSignOut = async () => {
        try { await signOut({ callbackUrl: '/login' }); }
        catch { window.location.href = '/login'; }
    };

    const memberSince = mounted && user?.createdAt
        ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
        : '...';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', maxWidth: 500, width: '100%', margin: '0 auto' }} suppressHydrationWarning>

            {/* ═══ PROFILE CARD — Glassmorphic with glow ring ═══ */}
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, delay: 0.05 }}>
                <div style={{
                    ...glass, borderRadius: 'var(--radius-2xl)', padding: 'var(--space-5)',
                    background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.08), var(--bg-glass), rgba(var(--accent-500-rgb), 0.04))',
                    boxShadow: 'var(--shadow-card), 0 0 30px rgba(var(--accent-500-rgb), 0.06)',
                }}>
                    {/* Top light */}
                    <div style={{
                        position: 'absolute', top: 0, left: '15%', right: '15%', height: 1,
                        background: 'linear-gradient(90deg, transparent, rgba(var(--accent-500-rgb), 0.15), transparent)',
                        pointerEvents: 'none',
                    }} />
                    <div style={{ position: 'relative', zIndex: 1 }}>
                        {userLoading ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                                <div style={{
                                    width: 56, height: 56, borderRadius: '50%',
                                    background: 'rgba(var(--accent-500-rgb), 0.06)',
                                    animation: 'pulse 2s ease infinite',
                                }} />
                                <div style={{ flex: 1 }}>
                                    <div style={{ width: '50%', height: 14, borderRadius: 8, background: 'rgba(var(--accent-500-rgb), 0.08)', marginBottom: 8 }} />
                                    <div style={{ width: '70%', height: 10, borderRadius: 6, background: 'rgba(var(--accent-500-rgb), 0.05)' }} />
                                </div>
                            </div>
                        ) : editingProfile ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                                <Input label="Name" value={editName} onChange={(e) => setEditName(e.target.value)} leftIcon={<User size={16} />} />
                                <Input label="Phone" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="+91 9876543210" leftIcon={<Smartphone size={16} />} />
                                <Input label="UPI ID" value={editUpiId} onChange={(e) => setEditUpiId(e.target.value)} placeholder="name@upi" />
                                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                                    <Button fullWidth
                                        leftIcon={savingProfile ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
                                        onClick={handleSaveProfile}
                                        disabled={savingProfile || !editName.trim()}
                                        style={{
                                            background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                                            boxShadow: '0 4px 16px rgba(var(--accent-500-rgb), 0.25)',
                                        }}
                                    >
                                        Save
                                    </Button>
                                    <Button variant="outline" onClick={() => setEditingProfile(false)}>Cancel</Button>
                                </div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                                {/* Avatar with vibrant rotating ring */}
                                <div style={{
                                    position: 'relative',
                                    width: 64, height: 64, // Explicit size ensuring perfect circle
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    flexShrink: 0,
                                }}>
                                    {/* Rotating Light Effect */}
                                    <motion.div
                                        animate={{ rotate: 360 }}
                                        transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                                        style={{
                                            position: 'absolute',
                                            inset: 0,
                                            borderRadius: '50%',
                                            background: 'conic-gradient(from 0deg, transparent 0%, var(--accent-500) 30%, transparent 60%)',
                                            filter: 'drop-shadow(0 0 6px var(--accent-500))', // Stronger glow
                                        }}
                                    />

                                    {/* Inner Mask (Gap) */}
                                    <div style={{
                                        position: 'relative',
                                        width: 54, height: 54, // ~5px ring thickness
                                        borderRadius: '50%',
                                        background: 'var(--bg-glass)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        zIndex: 1,
                                        backdropFilter: 'blur(4px)',
                                        boxShadow: 'inset 0 0 4px rgba(0,0,0,0.1)',
                                    }}>
                                        {/* Avatar Container */}
                                        <div style={{
                                            borderRadius: '50%',
                                            overflow: 'hidden',
                                            width: 48, height: 48,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            background: 'var(--bg-primary)',
                                        }}>
                                            <Avatar name={user?.name || 'User'} image={user?.image} size="lg" />
                                        </div>
                                    </div>

                                    {/* Camera overlay for upload */}
                                    <label style={{
                                        position: 'absolute', bottom: 0, right: 0,
                                        width: 24, height: 24, borderRadius: '50%',
                                        background: 'var(--accent-500)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        cursor: uploadingAvatar ? 'wait' : 'pointer',
                                        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                                        border: '2px solid var(--bg-glass)',
                                        zIndex: 2,
                                    }}>
                                        {uploadingAvatar ? (
                                            <Loader2 size={11} style={{ color: 'white', animation: 'spin 1s linear infinite' }} />
                                        ) : (
                                            <Camera size={11} style={{ color: 'white' }} />
                                        )}
                                        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleAvatarUpload} style={{ display: 'none' }} disabled={uploadingAvatar} />
                                    </label>
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                        fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--fg-primary)',
                                    }}>
                                        {user?.name || 'User'}
                                    </div>
                                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {user?.email || ''}
                                    </div>
                                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--fg-muted)', marginTop: 2 }} suppressHydrationWarning>
                                        Member since {memberSince}
                                    </div>
                                </div>
                                <button
                                    onClick={() => setEditingProfile(true)}
                                    style={{
                                        padding: '6px 14px', borderRadius: 'var(--radius-full)',
                                        background: 'rgba(var(--accent-500-rgb), 0.08)',
                                        border: '1px solid rgba(var(--accent-500-rgb), 0.12)',
                                        color: 'var(--accent-400)', fontSize: 'var(--text-xs)', fontWeight: 600,
                                        cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0,
                                    }}
                                >
                                    Edit
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </motion.div>

            {/* ═══ APPEARANCE — Glassmorphic Section ═══ */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                <GlassSection title="Appearance" icon={<Palette size={16} />}>
                    {/* Theme Toggle */}
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: 'var(--space-3) 0', gap: 'var(--space-3)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                            {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
                            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Dark Mode</span>
                        </div>
                        <ToggleSwitch
                            checked={theme === 'dark'}
                            onChange={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                        />
                    </div>

                    {/* Color Palette Picker */}
                    <div style={{ padding: 'var(--space-3) 0' }}>
                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-3)', textAlign: 'center' }}>
                            Color Theme
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                            {COLOR_PALETTES.map((p) => {
                                const isActive = palette === p.id;
                                return (
                                    <motion.button
                                        key={p.id}
                                        whileTap={{ scale: 0.9 }}
                                        whileHover={{ scale: 1.05 }}
                                        onClick={() => setPalette(p.id)}
                                        title={p.name}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 6,
                                            padding: '6px 12px', borderRadius: 'var(--radius-full)',
                                            border: isActive ? `2px solid ${p.accent500}` : '1px solid var(--border-glass)',
                                            background: isActive ? `rgba(${p.accent500rgb}, 0.12)` : 'var(--bg-glass)',
                                            backdropFilter: 'blur(8px)',
                                            WebkitBackdropFilter: 'blur(8px)',
                                            cursor: 'pointer',
                                            fontSize: 'var(--text-xs)', fontWeight: 600,
                                            color: isActive ? p.accent500 : 'var(--fg-secondary)',
                                            whiteSpace: 'nowrap',
                                            transition: 'all 0.2s',
                                            boxShadow: isActive ? `0 0 12px rgba(${p.accent500rgb}, 0.2)` : 'none',
                                        }}
                                    >
                                        <span style={{ display: 'flex', gap: 2 }}>
                                            {p.swatches.map((c, i) => (
                                                <span key={i} style={{
                                                    width: 8, height: 8, borderRadius: '50%', background: c,
                                                }} />
                                            ))}
                                        </span>
                                        {p.name}
                                        {isActive && <Check size={11} />}
                                    </motion.button>
                                );
                            })}
                        </div>
                    </div>
                </GlassSection>
            </motion.div>

            {/* ═══ NOTIFICATIONS ═══ */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                <GlassSection title="Notifications" icon={<Bell size={16} />}>
                    <GlassRow label="Push Notifications" subtitle="Get notified about settlements" />
                    <GlassRow label="Expense Reminders" subtitle="Daily summary of pending splits" />
                </GlassSection>
            </motion.div>

            {/* ═══ PRIVACY ═══ */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <GlassSection title="Privacy & Security" icon={<Shield size={16} />}>
                    <GlassRow label="Data Processing" subtitle="All data processed on-device" disabled />
                    <GlassRow label="Export My Data" action />
                    <GlassRow label="Delete Account" danger action />
                </GlassSection>
            </motion.div>

            {/* ═══ APP INFO ═══ */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
                <GlassSection title="App" icon={<Smartphone size={16} />}>
                    <GlassRow label="Version" subtitle="1.0.0 (MVP)" disabled />
                    <GlassRow label="Install as App (PWA)" action />
                </GlassSection>
            </motion.div>

            {/* ═══ SIGN OUT ═══ */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                <button
                    onClick={handleSignOut}
                    style={{
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        padding: '14px', borderRadius: 'var(--radius-xl)',
                        background: 'rgba(239, 68, 68, 0.08)',
                        border: '1px solid rgba(239, 68, 68, 0.15)',
                        backdropFilter: 'blur(16px)',
                        WebkitBackdropFilter: 'blur(16px)',
                        color: 'var(--color-error)',
                        fontSize: 'var(--text-sm)', fontWeight: 700,
                        cursor: 'pointer', transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(239, 68, 68, 0.14)';
                        e.currentTarget.style.boxShadow = '0 0 20px rgba(239, 68, 68, 0.1)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)';
                        e.currentTarget.style.boxShadow = 'none';
                    }}
                >
                    <LogOut size={16} /> Sign Out
                </button>
            </motion.div>
        </div>
    );
}

/* ═══ Sub-components ═══ */

function GlassSection({ title, icon, children }: {
    title: string; icon: React.ReactNode; children: React.ReactNode;
}) {
    return (
        <div style={{
            background: 'var(--bg-glass)',
            backdropFilter: 'blur(24px) saturate(1.5)',
            WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
            border: '1px solid var(--border-glass)',
            borderRadius: 'var(--radius-xl)',
            boxShadow: 'var(--shadow-card)',
            padding: 'var(--space-4)',
            position: 'relative',
            overflow: 'hidden',
        }} suppressHydrationWarning>
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)',
                marginBottom: 'var(--space-3)', paddingBottom: 'var(--space-2)',
                borderBottom: '1px solid var(--border-subtle)',
            }} suppressHydrationWarning>
                <span style={{ color: 'var(--accent-400)' }}>{icon}</span>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--fg-primary)' }}>{title}</span>
            </div>
            {children}
        </div>
    );
}

function GlassRow({ label, subtitle, danger, action, disabled }: {
    label: string; subtitle?: string; danger?: boolean; action?: boolean; disabled?: boolean;
}) {
    return (
        <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 'var(--space-3) 0', opacity: disabled ? 0.5 : 1,
            cursor: disabled ? 'default' : action ? 'pointer' : 'default',
            borderBottom: '1px solid rgba(var(--accent-500-rgb), 0.04)',
            gap: 6,
        }} suppressHydrationWarning>
            <div style={{ textAlign: 'center' }}>
                <div style={{
                    fontSize: 'var(--text-sm)', fontWeight: 600,
                    color: danger ? 'var(--color-error)' : 'var(--fg-primary)',
                }}>
                    {label}
                </div>
                {subtitle && (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginTop: 2 }}>
                        {subtitle}
                    </div>
                )}
            </div>
            {action && <ChevronRight size={15} style={{ color: 'var(--fg-muted)' }} />}
        </div>
    );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
    return (
        <motion.button
            onClick={onChange}
            style={{
                width: 46, height: 26, borderRadius: 'var(--radius-full)',
                border: 'none', padding: 3, cursor: 'pointer',
                background: checked
                    ? 'linear-gradient(135deg, var(--accent-500), var(--accent-600))'
                    : 'var(--bg-tertiary)',
                display: 'flex', alignItems: 'center',
                justifyContent: checked ? 'flex-end' : 'flex-start',
                transition: 'background 0.3s',
                boxShadow: checked ? '0 0 12px rgba(var(--accent-500-rgb), 0.2)' : 'none',
            }}
            suppressHydrationWarning
        >
            <motion.div
                layout
                style={{
                    width: 20, height: 20, borderRadius: '50%',
                    background: 'white',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
        </motion.button>
    );
}
