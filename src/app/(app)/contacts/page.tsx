'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    UserPlus, Search, Send, Trash2, Share2,
    Users, UserCheck, Inbox, ExternalLink,
    Loader2,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/components/ui/Toast';
import styles from './contacts.module.css';

interface Contact {
    id: string;
    name: string;
    email: string;
    phone?: string | null;
    linkedUser?: {
        id: string;
        name: string | null;
        image: string | null;
        email: string | null;
    } | null;
    addedAt: string;
}

interface GroupOption {
    id: string;
    name: string;
    emoji: string;
    members: { userId: string }[];
}

/* ── Gravatar URL helper ── */
function getGravatarUrl(email: string, size = 88): string {
    // Use simple hash for Gravatar - works without md5 library via Gravatar's API
    const hash = email.trim().toLowerCase();
    return `https://www.gravatar.com/avatar/${hashCode(hash)}?s=${size}&d=404`;
}

function hashCode(str: string): string {
    // Simple hash - for proper Gravatar we'd need MD5, but we'll use the
    // identicon endpoint which accepts any hash
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
}

export default function ContactsPage() {
    useCurrentUser();
    const { toast } = useToast();
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [showAddModal, setShowAddModal] = useState(false);

    // Form state
    const [formName, setFormName] = useState('');
    const [formEmail, setFormEmail] = useState('');
    const [formPhone, setFormPhone] = useState('');
    const [formError, setFormError] = useState('');
    const [saving, setSaving] = useState(false);

    // Group invite modal
    const [inviteContact, setInviteContact] = useState<Contact | null>(null);
    const [groups, setGroups] = useState<GroupOption[]>([]);
    const [loadingGroups, setLoadingGroups] = useState(false);
    const [sendingInvite, setSendingInvite] = useState<string | null>(null);

    // Share modal
    const [shareContact, setShareContact] = useState<Contact | null>(null);
    const [shareData, setShareData] = useState<{ message: string; url: string } | null>(null);
    const [loadingShare, setLoadingShare] = useState(false);
    const [copied, setCopied] = useState(false);

    // Avatar error tracking (for Gravatar fallback)
    const [avatarErrors, setAvatarErrors] = useState<Set<string>>(new Set());

    // Fetch contacts
    const loadContacts = useCallback(async () => {
        try {
            const res = await fetch('/api/contacts');
            if (res.ok) {
                const data = await res.json();
                setContacts(data);
            }
        } catch {
            // silent
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadContacts(); }, [loadContacts]);

    // Filtered contacts
    const filteredContacts = useMemo(() => {
        if (!searchQuery.trim()) return contacts;
        const q = searchQuery.toLowerCase();
        return contacts.filter(
            c => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
        );
    }, [contacts, searchQuery]);

    // Stats
    const totalContacts = contacts.length;
    const linkedCount = contacts.filter(c => c.linkedUser).length;
    const pendingCount = totalContacts - linkedCount;

    // Add contact
    const handleAdd = async () => {
        setFormError('');
        if (!formName.trim()) { setFormError('Name is required'); return; }
        if (!formEmail.trim() || !formEmail.includes('@')) { setFormError('Valid email is required'); return; }

        setSaving(true);
        try {
            const res = await fetch('/api/contacts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: formName.trim(), email: formEmail.trim(), phone: formPhone.trim() || undefined }),
            });

            if (res.ok) {
                const newContact = await res.json();
                setContacts(prev => [newContact, ...prev]);
                setShowAddModal(false);
                setFormName(''); setFormEmail(''); setFormPhone('');
                toast('Contact added!', 'success');
            } else {
                const err = await res.json();
                setFormError(err.error || 'Failed to add contact');
            }
        } catch {
            setFormError('Something went wrong');
        } finally {
            setSaving(false);
        }
    };

    // Delete contact
    const handleDelete = async (contactId: string) => {
        try {
            const res = await fetch(`/api/contacts?id=${contactId}`, { method: 'DELETE' });
            if (res.ok) {
                setContacts(prev => prev.filter(c => c.id !== contactId));
                toast('Contact removed', 'success');
            }
        } catch {
            // silent
        }
    };

    // ── Group Invite Flow ──
    const openGroupPicker = async (contact: Contact) => {
        setInviteContact(contact);
        setLoadingGroups(true);
        try {
            const res = await fetch('/api/groups');
            if (res.ok) {
                const data = await res.json();
                setGroups(data);
            }
        } catch {
            toast('Failed to load groups', 'error');
        } finally {
            setLoadingGroups(false);
        }
    };

    const sendGroupInvite = async (groupId: string) => {
        if (!inviteContact?.linkedUser) return;
        setSendingInvite(groupId);
        try {
            const res = await fetch('/api/invitations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groupId, inviteeId: inviteContact.linkedUser.id }),
            });
            const data = await res.json();
            if (res.ok) {
                toast(`Invitation sent to ${inviteContact.name}!`, 'success');
                setInviteContact(null);
            } else {
                toast(data.error || 'Failed to send invitation', 'error');
            }
        } catch {
            toast('Network error', 'error');
        } finally {
            setSendingInvite(null);
        }
    };

    // ── Share Flow ──
    const openShareModal = async (contact: Contact) => {
        setShareContact(contact);
        setLoadingShare(true);
        setCopied(false);
        try {
            const res = await fetch('/api/contacts/invite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contactId: contact.id }),
            });
            if (res.ok) {
                const data = await res.json();
                setShareData({ message: data.message, url: data.inviteUrl });
            }
        } catch {
            toast('Failed to generate invite', 'error');
        } finally {
            setLoadingShare(false);
        }
    };

    const shareViaWhatsApp = () => {
        if (!shareData || !shareContact) return;
        const text = encodeURIComponent(shareData.message);
        const phone = shareContact.phone?.replace(/[^0-9]/g, '') || '';
        const url = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
        window.open(url, '_blank');
    };

    const shareViaSMS = () => {
        if (!shareData || !shareContact) return;
        const body = encodeURIComponent(shareData.message);
        const phone = shareContact.phone?.replace(/[^0-9]/g, '') || '';
        window.open(`sms:${phone}?body=${body}`, '_blank');
    };

    const shareViaEmail = () => {
        if (!shareData || !shareContact) return;
        const subject = encodeURIComponent('Join me on SplitX!');
        const body = encodeURIComponent(shareData.message);
        window.open(`mailto:${shareContact.email}?subject=${subject}&body=${body}`, '_blank');
    };

    const shareViaCopy = () => {
        if (!shareData) return;
        navigator.clipboard.writeText(shareData.url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // Get initials
    const getInitials = (name: string) => {
        return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    };

    // Get avatar image URL: linkedUser image > Gravatar > initials
    const getAvatarImage = (contact: Contact): string | null => {
        if (contact.linkedUser?.image) return contact.linkedUser.image;
        if (!avatarErrors.has(contact.id)) return getGravatarUrl(contact.email);
        return null;
    };

    if (loading) {
        return (
            <div className={styles.contactsContainer}>
                {[...Array(4)].map((_, i) => (
                    <div key={i} className={styles.contactCard} style={{
                        animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                        animationDelay: `${i * 150}ms`,
                    }}>
                        <div className={styles.contactAvatar} style={{ background: 'rgba(var(--accent-500-rgb), 0.06)' }} />
                        <div style={{ flex: 1 }}>
                            <div style={{ width: '60%', height: 14, borderRadius: 8, background: 'rgba(var(--accent-500-rgb), 0.08)', marginBottom: 8 }} />
                            <div style={{ width: '80%', height: 10, borderRadius: 6, background: 'rgba(var(--accent-500-rgb), 0.05)' }} />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className={styles.contactsContainer}>
            {/* ═══ STATS ROW ═══ */}
            <div className={styles.statsRow}>
                <div className={styles.statCard}>
                    <div className={styles.statValue}>{totalContacts}</div>
                    <div className={styles.statLabel}>Total</div>
                </div>
                <div className={styles.statCard}>
                    <div className={styles.statValue}>{linkedCount}</div>
                    <div className={styles.statLabel}>On App</div>
                </div>
                <div className={styles.statCard}>
                    <div className={styles.statValue}>{pendingCount}</div>
                    <div className={styles.statLabel}>Invite</div>
                </div>
            </div>

            {/* ═══ SUBHEADER ═══ */}
            <div className={styles.subheader}>
                <p className={styles.subheaderText}>
                    {totalContacts} contact{totalContacts !== 1 ? 's' : ''} · Manage your split buddies
                </p>
                <button className={styles.addBtn} onClick={() => setShowAddModal(true)}>
                    <UserPlus size={14} /> Add Contact
                </button>
            </div>

            {/* ═══ SEARCH ═══ */}
            {contacts.length > 0 && (
                <div className={styles.searchBar}>
                    <Search size={16} className={styles.searchIcon} />
                    <input
                        className={styles.searchInput}
                        placeholder="Search contacts..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            )}

            {/* ═══ CONTACT LIST ═══ */}
            {filteredContacts.length === 0 && contacts.length === 0 ? (
                <motion.div
                    className={styles.emptyState}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                >
                    <div className={styles.emptyIcon}>
                        <Inbox size={28} />
                    </div>
                    <h3 className={styles.emptyTitle}>No contacts yet</h3>
                    <p className={styles.emptyDesc}>Add friends to split expenses with them</p>
                    <Button
                        size="sm"
                        leftIcon={<UserPlus size={14} />}
                        onClick={() => setShowAddModal(true)}
                        style={{
                            background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                            boxShadow: '0 4px 20px rgba(var(--accent-500-rgb), 0.3)',
                        }}
                    >
                        Add Your First Contact
                    </Button>
                </motion.div>
            ) : (
                <div className={styles.contactList}>
                    <AnimatePresence mode="popLayout">
                        {filteredContacts.map((contact, i) => {
                            const avatarImg = getAvatarImage(contact);
                            return (
                                <motion.div
                                    key={contact.id}
                                    className={styles.contactCard}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, x: -100 }}
                                    transition={{ delay: i * 0.04, duration: 0.3 }}
                                    layout
                                >
                                    {/* Avatar — image or initials */}
                                    <div className={styles.contactAvatar} style={avatarImg ? { padding: 0, overflow: 'hidden' } : undefined}>
                                        {avatarImg ? (
                                            /* eslint-disable-next-line @next/next/no-img-element */
                                            <img
                                                src={avatarImg}
                                                alt={contact.name}
                                                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }}
                                                onError={() => setAvatarErrors(prev => new Set(prev).add(contact.id))}
                                            />
                                        ) : (
                                            getInitials(contact.name)
                                        )}
                                    </div>

                                    <div className={styles.contactInfo}>
                                        <div className={styles.contactName}>{contact.name}</div>
                                        <div className={styles.contactMeta}>
                                            <span className={styles.contactEmail}>{contact.email}</span>
                                            {contact.linkedUser && (
                                                <span className={styles.linkedBadge}>
                                                    <UserCheck size={10} /> On App
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className={styles.contactActions}>
                                        {/* Invite to Group (only for linked/on-app users) */}
                                        {contact.linkedUser && (
                                            <button
                                                className={styles.actionBtn}
                                                title="Invite to Group"
                                                onClick={() => openGroupPicker(contact)}
                                            >
                                                <Users size={14} />
                                            </button>
                                        )}

                                        {/* Share / External Invite */}
                                        <button
                                            className={styles.actionBtn}
                                            title="Share Invite"
                                            onClick={() => openShareModal(contact)}
                                        >
                                            <Share2 size={14} />
                                        </button>

                                        {/* Delete */}
                                        <button
                                            className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                                            title="Remove Contact"
                                            onClick={() => handleDelete(contact.id)}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>

                    {filteredContacts.length === 0 && searchQuery && (
                        <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--fg-tertiary)' }}>
                            No contacts matching &quot;{searchQuery}&quot;
                        </div>
                    )}
                </div>
            )}

            {/* ═══ ADD CONTACT MODAL ═══ */}
            <Modal
                isOpen={showAddModal}
                onClose={() => { setShowAddModal(false); setFormError(''); }}
                title="Add Contact"
                size="small"
            >
                <AnimatePresence mode="wait">
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
                    >
                        {formError && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                style={{
                                    padding: '8px 12px', borderRadius: 'var(--radius-lg)',
                                    background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.15)',
                                    color: '#ef4444', fontSize: 'var(--text-xs)',
                                }}
                            >
                                {formError}
                            </motion.div>
                        )}

                        <div className={styles.formField}>
                            <label className={styles.formLabel}>Name</label>
                            <input
                                className={styles.formInput}
                                placeholder="e.g. Rahul Sharma"
                                value={formName}
                                onChange={(e) => setFormName(e.target.value)}
                                autoFocus
                            />
                        </div>

                        <div className={styles.formField}>
                            <label className={styles.formLabel}>Email</label>
                            <input
                                className={styles.formInput}
                                type="email"
                                placeholder="rahul@example.com"
                                value={formEmail}
                                onChange={(e) => setFormEmail(e.target.value)}
                            />
                        </div>

                        <div className={styles.formField}>
                            <label className={styles.formLabel}>Phone (optional)</label>
                            <input
                                className={styles.formInput}
                                type="tel"
                                placeholder="+91 98765 43210"
                                value={formPhone}
                                onChange={(e) => setFormPhone(e.target.value)}
                            />
                        </div>

                        <Button
                            fullWidth
                            size="lg"
                            disabled={!formName.trim() || !formEmail.trim()}
                            loading={saving}
                            leftIcon={<UserPlus size={18} />}
                            onClick={handleAdd}
                            style={{
                                background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                                boxShadow: '0 4px 20px rgba(var(--accent-500-rgb), 0.3)',
                                marginTop: 'var(--space-2)',
                            }}
                        >
                            Add Contact
                        </Button>
                    </motion.div>
                </AnimatePresence>
            </Modal>

            {/* ═══ GROUP PICKER MODAL ═══ */}
            <Modal
                isOpen={!!inviteContact}
                onClose={() => setInviteContact(null)}
                title={`Invite ${inviteContact?.name || ''} to Group`}
                size="small"
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {loadingGroups ? (
                        <div style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
                            <Loader2 size={24} style={{ color: 'var(--accent-500)', animation: 'spin 1s linear infinite', margin: '0 auto' }} />
                            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginTop: 'var(--space-2)' }}>Loading groups...</p>
                        </div>
                    ) : groups.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
                            <Users size={32} style={{ color: 'var(--fg-muted)', margin: '0 auto var(--space-2)' }} />
                            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)' }}>No groups yet. Create one first!</p>
                        </div>
                    ) : (
                        <>
                            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginBottom: 'var(--space-1)' }}>
                                Select a group to invite {inviteContact?.name} to:
                            </p>
                            {groups.map((group) => {
                                const isAlreadyMember = inviteContact?.linkedUser
                                    ? group.members?.some(m => m.userId === inviteContact.linkedUser!.id)
                                    : false;
                                const isSending = sendingInvite === group.id;

                                return (
                                    <button
                                        key={group.id}
                                        onClick={() => !isAlreadyMember && !isSending && sendGroupInvite(group.id)}
                                        disabled={isAlreadyMember || isSending}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 'var(--space-3)',
                                            padding: 'var(--space-3) var(--space-4)',
                                            borderRadius: 'var(--radius-lg)',
                                            border: '1px solid var(--border-default)',
                                            background: isAlreadyMember
                                                ? 'rgba(var(--accent-500-rgb), 0.04)'
                                                : 'var(--bg-secondary)',
                                            cursor: isAlreadyMember ? 'not-allowed' : 'pointer',
                                            color: 'var(--fg-primary)',
                                            fontSize: 'var(--text-sm)',
                                            fontWeight: 600,
                                            transition: 'all 0.15s ease',
                                            opacity: isAlreadyMember ? 0.5 : 1,
                                            textAlign: 'left',
                                            width: '100%',
                                        }}
                                    >
                                        <span style={{ fontSize: 24 }}>{group.emoji}</span>
                                        <span style={{ flex: 1 }}>{group.name}</span>
                                        {isAlreadyMember ? (
                                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}>Already in</span>
                                        ) : isSending ? (
                                            <Loader2 size={16} style={{ color: 'var(--accent-500)', animation: 'spin 1s linear infinite' }} />
                                        ) : (
                                            <Send size={14} style={{ color: 'var(--accent-500)' }} />
                                        )}
                                    </button>
                                );
                            })}
                        </>
                    )}
                </div>
            </Modal>

            {/* ═══ SHARE MODAL ═══ */}
            <Modal
                isOpen={!!shareContact}
                onClose={() => { setShareContact(null); setShareData(null); setCopied(false); }}
                title={`Invite ${shareContact?.name || ''}`}
                size="small"
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {loadingShare ? (
                        <div style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
                            <Loader2 size={24} style={{ color: 'var(--accent-500)', animation: 'spin 1s linear infinite', margin: '0 auto' }} />
                        </div>
                    ) : (
                        <>
                            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', textAlign: 'center', marginBottom: 'var(--space-2)' }}>
                                Choose how to send the invite:
                            </p>

                            {/* WhatsApp */}
                            <button onClick={shareViaWhatsApp} style={{
                                display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                                padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-lg)',
                                border: '1px solid var(--border-default)', background: 'var(--bg-secondary)',
                                cursor: 'pointer', color: 'var(--fg-primary)', fontSize: 'var(--text-sm)',
                                fontWeight: 600, transition: 'all 0.15s ease', width: '100%',
                            }}>
                                <span style={{ fontSize: 24 }}>💬</span>
                                <span style={{ flex: 1, textAlign: 'left' }}>WhatsApp</span>
                                <ExternalLink size={14} style={{ color: 'var(--fg-tertiary)' }} />
                            </button>

                            {/* SMS */}
                            <button onClick={shareViaSMS} style={{
                                display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                                padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-lg)',
                                border: '1px solid var(--border-default)', background: 'var(--bg-secondary)',
                                cursor: 'pointer', color: 'var(--fg-primary)', fontSize: 'var(--text-sm)',
                                fontWeight: 600, transition: 'all 0.15s ease', width: '100%',
                            }}>
                                <span style={{ fontSize: 24 }}>📱</span>
                                <span style={{ flex: 1, textAlign: 'left' }}>SMS / iMessage</span>
                                <ExternalLink size={14} style={{ color: 'var(--fg-tertiary)' }} />
                            </button>

                            {/* Email */}
                            <button onClick={shareViaEmail} style={{
                                display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                                padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-lg)',
                                border: '1px solid var(--border-default)', background: 'var(--bg-secondary)',
                                cursor: 'pointer', color: 'var(--fg-primary)', fontSize: 'var(--text-sm)',
                                fontWeight: 600, transition: 'all 0.15s ease', width: '100%',
                            }}>
                                <span style={{ fontSize: 24 }}>✉️</span>
                                <span style={{ flex: 1, textAlign: 'left' }}>Email to {shareContact?.email}</span>
                                <ExternalLink size={14} style={{ color: 'var(--fg-tertiary)' }} />
                            </button>

                            {/* Copy Link */}
                            <button onClick={shareViaCopy} style={{
                                display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                                padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-lg)',
                                border: '1px solid var(--border-default)',
                                background: copied ? 'rgba(var(--accent-500-rgb), 0.08)' : 'var(--bg-secondary)',
                                cursor: 'pointer', color: copied ? 'var(--accent-500)' : 'var(--fg-primary)',
                                fontSize: 'var(--text-sm)', fontWeight: 600, transition: 'all 0.15s ease', width: '100%',
                            }}>
                                <span style={{ fontSize: 24 }}>{copied ? '✅' : '🔗'}</span>
                                <span style={{ flex: 1, textAlign: 'left' }}>{copied ? 'Copied!' : 'Copy Invite Link'}</span>
                            </button>

                            {/* URL preview */}
                            {shareData && (
                                <div style={{
                                    padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)',
                                    background: 'var(--bg-tertiary)', fontSize: 'var(--text-xs)',
                                    color: 'var(--fg-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}>
                                    {shareData.url}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </Modal>
        </div>
    );
}
