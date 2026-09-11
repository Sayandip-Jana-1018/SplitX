'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
    Check,
    Copy,
    Link2,
    Mail,
    MessageCircle,
    MessageSquare,
    Search,
    Send,
    Share2,
    Trash2,
    UserCheck,
    UserPlus,
    Users,
    X,
} from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import { ListSkeleton } from '@/components/ui/Skeleton';
import {
    IconButton,
    IconTile,
    ListGroup,
    ListRow,
    Notice,
    Segmented,
    Spinner,
    Stagger,
    StaggerItem,
    Tag,
} from '@/components/ui/kit';
import { useToast } from '@/components/ui/Toast';
import { getNetworkErrorCopy, NetworkTaggedError } from '@/lib/networkErrors';
import { fetcher } from '@/lib/swr';
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

type Filter = 'all' | 'onApp' | 'invite';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const EMPTY_FORM = { name: '', email: '', phone: '' };

const firstName = (name?: string | null) => (name || 'Contact').trim().split(/\s+/)[0];

function errorMessage(data: unknown, fallback: string) {
    const error = (data as { error?: unknown } | null)?.error;
    return typeof error === 'string' && error ? error : fallback;
}

function letterFor(name: string) {
    const first = name.trim().charAt(0).toUpperCase();
    return /[A-Z]/.test(first) ? first : '#';
}

export default function ContactsPage() {
    const { toast } = useToast();
    const { data, error, isLoading, mutate } = useSWR<Contact[]>('/api/contacts', fetcher);
    const contacts = useMemo(() => (Array.isArray(data) ? data : []), [data]);

    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState<Filter>('all');

    const [addOpen, setAddOpen] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [formError, setFormError] = useState('');
    const [saving, setSaving] = useState(false);

    const [selected, setSelected] = useState<Contact | null>(null);
    const [confirmRemove, setConfirmRemove] = useState(false);
    const [removing, setRemoving] = useState(false);

    const [groupPickerFor, setGroupPickerFor] = useState<Contact | null>(null);
    const [sendingTo, setSendingTo] = useState<string | null>(null);
    const groupsQuery = useSWR<GroupOption[]>(groupPickerFor ? '/api/groups' : null, fetcher);

    const [shareFor, setShareFor] = useState<Contact | null>(null);
    const [shareData, setShareData] = useState<{ message: string; url: string } | null>(null);
    const [copied, setCopied] = useState(false);

    const onAppCount = contacts.filter((contact) => contact.linkedUser).length;
    const inviteCount = contacts.length - onAppCount;

    const sections = useMemo(() => {
        const q = query.trim().toLowerCase();
        const visible = contacts
            .filter((contact) => filter === 'all' || (filter === 'onApp' ? Boolean(contact.linkedUser) : !contact.linkedUser))
            .filter((contact) => !q
                || contact.name.toLowerCase().includes(q)
                || contact.email.toLowerCase().includes(q)
                || (contact.phone || '').includes(q))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

        const grouped = new Map<string, Contact[]>();
        for (const contact of visible) {
            const letter = letterFor(contact.name);
            grouped.set(letter, [...(grouped.get(letter) ?? []), contact]);
        }
        return Array.from(grouped.entries());
    }, [contacts, filter, query]);

    /* ── Add ── */
    const addContact = async () => {
        setFormError('');
        const name = form.name.trim();
        const email = form.email.trim();
        const phone = form.phone.trim();
        if (!name) {
            setFormError('Add a name for this contact');
            return;
        }
        if (!EMAIL_PATTERN.test(email)) {
            setFormError('Enter a valid email address');
            return;
        }

        setSaving(true);
        try {
            const res = await fetch('/api/contacts', {
                method: 'POST',
                headers: JSON_HEADERS,
                body: JSON.stringify({ name, email, phone: phone || undefined }),
            });
            const payload = await res.json().catch(() => null);
            if (res.ok && payload) {
                const created = payload as Contact;
                await mutate((prev) => [created, ...(prev ?? [])], { revalidate: false });
                setAddOpen(false);
                setForm(EMPTY_FORM);
                toast(created.linkedUser ? `${firstName(name)} is already on SplitX` : `${firstName(name)} added`, 'success');
            } else {
                setFormError(errorMessage(payload, 'Could not add this contact'));
            }
        } catch {
            setFormError('Network error — try again');
        } finally {
            setSaving(false);
        }
    };

    /* ── Contact sheet ── */
    const closeContact = () => {
        setSelected(null);
        setConfirmRemove(false);
    };

    const removeContact = async () => {
        if (!selected) return;
        if (!confirmRemove) {
            setConfirmRemove(true);
            return;
        }
        setRemoving(true);
        try {
            const res = await fetch(`/api/contacts?id=${encodeURIComponent(selected.id)}`, { method: 'DELETE' });
            if (res.ok) {
                const removedId = selected.id;
                await mutate((prev) => (prev ?? []).filter((contact) => contact.id !== removedId), { revalidate: false });
                toast(`${firstName(selected.name)} removed`, 'success');
                closeContact();
            } else {
                toast(errorMessage(await res.json().catch(() => null), 'Could not remove this contact'), 'error');
            }
        } catch {
            toast('Network error — try again', 'error');
        } finally {
            setRemoving(false);
        }
    };

    /* ── Group invite ── */
    const openGroupPicker = (contact: Contact) => {
        closeContact();
        setGroupPickerFor(contact);
    };

    const sendGroupInvite = async (groupId: string) => {
        const invitee = groupPickerFor?.linkedUser;
        if (!groupPickerFor || !invitee) return;
        setSendingTo(groupId);
        try {
            const res = await fetch('/api/invitations', {
                method: 'POST',
                headers: JSON_HEADERS,
                body: JSON.stringify({ groupId, inviteeId: invitee.id }),
            });
            const payload = await res.json().catch(() => null);
            if (res.ok) {
                toast(`Invite sent to ${firstName(groupPickerFor.name)}`, 'success');
                setGroupPickerFor(null);
            } else {
                toast(errorMessage(payload, 'Could not send the invite'), 'error');
            }
        } catch {
            toast('Network error — try again', 'error');
        } finally {
            setSendingTo(null);
        }
    };

    /* ── Share invite ── */
    const openShare = async (contact: Contact) => {
        closeContact();
        setShareFor(contact);
        setShareData(null);
        setCopied(false);
        try {
            const res = await fetch('/api/contacts/invite', {
                method: 'POST',
                headers: JSON_HEADERS,
                body: JSON.stringify({ contactId: contact.id }),
            });
            if (res.ok) {
                const payload = await res.json();
                setShareData({ message: payload.message, url: payload.inviteUrl });
            } else {
                toast('Could not create an invite link', 'error');
                setShareFor(null);
            }
        } catch {
            toast('Network error — try again', 'error');
            setShareFor(null);
        }
    };

    const digits = (shareFor?.phone || '').replace(/[^0-9]/g, '');

    const copyLink = async () => {
        if (!shareData) return;
        try {
            await navigator.clipboard.writeText(shareData.url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            toast('Could not copy the link', 'error');
        }
    };

    const nativeShare = async () => {
        if (!shareData) return;
        if (navigator.share) {
            try {
                await navigator.share({ title: 'Join me on SplitX', text: shareData.message });
            } catch { /* dismissed */ }
        } else {
            copyLink();
        }
    };

    if (isLoading && !data) {
        return (
            <div className={styles.page}>
                <ListSkeleton rows={6} />
            </div>
        );
    }

    if (error && !data) {
        const variant = error instanceof NetworkTaggedError ? error.variant : 'default';
        const copy = getNetworkErrorCopy(variant);
        return <ErrorState variant={variant} title={copy.title} message={copy.message} onRetry={() => mutate()} />;
    }

    return (
        <>
            <Stagger className={styles.page}>
                {contacts.length === 0 ? (
                    <StaggerItem>
                        <EmptyState
                            icon={<Users size={26} />}
                            title="Your people live here"
                            description="Add friends once and split with them in any group — we’ll tell you who’s already on SplitX."
                            actionLabel="Add a contact"
                            actionIcon={<UserPlus size={16} />}
                            onAction={() => setAddOpen(true)}
                        />
                    </StaggerItem>
                ) : (
                    <>
                        <StaggerItem>
                            <Segmented<Filter>
                                ariaLabel="Filter contacts"
                                value={filter}
                                onChange={setFilter}
                                options={[
                                    { value: 'all', label: 'All', count: contacts.length },
                                    { value: 'onApp', label: 'On SplitX', count: onAppCount },
                                    { value: 'invite', label: 'To invite', count: inviteCount },
                                ]}
                            />
                        </StaggerItem>

                        <StaggerItem>
                            <div className={styles.toolbar}>
                                <Input
                                    aria-label="Search contacts"
                                    placeholder="Search name, email or phone"
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    leftIcon={<Search size={17} />}
                                    rightSlot={query ? (
                                        <button type="button" className={styles.clearButton} onClick={() => setQuery('')} aria-label="Clear search">
                                            <X size={14} />
                                        </button>
                                    ) : undefined}
                                />
                                <IconButton icon={<UserPlus size={19} />} label="Add contact" variant="solid" size="lg" onClick={() => setAddOpen(true)} />
                            </div>
                        </StaggerItem>

                        {inviteCount > 0 && filter === 'all' && !query && (
                            <StaggerItem>
                                <Notice
                                    tone="info"
                                    icon={<Send size={16} />}
                                    title={`${inviteCount} ${inviteCount === 1 ? 'friend isn’t' : 'friends aren’t'} on SplitX yet`}
                                    action={<Button size="sm" variant="soft" onClick={() => setFilter('invite')}>Invite</Button>}
                                >
                                    Invite them so they can see balances and settle up in the app.
                                </Notice>
                            </StaggerItem>
                        )}

                        <StaggerItem>
                            {sections.length === 0 ? (
                                <EmptyState
                                    compact
                                    icon={<Search size={22} />}
                                    title="No matches"
                                    description={query ? `Nobody matches “${query}”.` : 'No contacts in this list yet.'}
                                />
                            ) : (
                                <div className={styles.sections}>
                                    {sections.map(([letter, list]) => (
                                        <div key={letter} className={styles.letterBlock}>
                                            <span className={styles.letter}>{letter}</span>
                                            <ListGroup>
                                                {list.map((contact) => (
                                                    <ListRow
                                                        key={contact.id}
                                                        onClick={() => setSelected(contact)}
                                                        leading={<Avatar name={contact.name} image={contact.linkedUser?.image} size="md" />}
                                                        title={contact.name}
                                                        subtitle={contact.email}
                                                        trailing={contact.linkedUser
                                                            ? <Tag tone="success" icon={<UserCheck size={11} />}>On SplitX</Tag>
                                                            : undefined}
                                                        chevron
                                                    />
                                                ))}
                                            </ListGroup>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </StaggerItem>
                    </>
                )}
            </Stagger>

            {/* ── Add contact ── */}
            <Modal
                isOpen={addOpen}
                onClose={() => {
                    if (saving) return;
                    setAddOpen(false);
                    setFormError('');
                }}
                title="Add contact"
                size="small"
            >
                <div className={styles.sheet}>
                    {formError && <Notice tone="danger">{formError}</Notice>}
                    <Input
                        label="Name"
                        placeholder="e.g. Rahul Sharma"
                        value={form.name}
                        onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                        autoComplete="name"
                        autoFocus
                    />
                    <Input
                        label="Email"
                        type="email"
                        inputMode="email"
                        placeholder="rahul@example.com"
                        value={form.email}
                        onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                        autoComplete="email"
                        autoCapitalize="none"
                    />
                    <Input
                        label="Phone (optional)"
                        type="tel"
                        inputMode="tel"
                        placeholder="+91 98765 43210"
                        value={form.phone}
                        onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                        autoComplete="tel"
                        hint="Used to open WhatsApp or SMS invites"
                    />
                    <Button
                        fullWidth
                        size="lg"
                        loading={saving}
                        disabled={!form.name.trim() || !form.email.trim()}
                        leftIcon={<UserPlus size={18} />}
                        onClick={addContact}
                    >
                        Add contact
                    </Button>
                </div>
            </Modal>

            {/* ── Contact card ── */}
            <Modal isOpen={Boolean(selected)} onClose={closeContact} title="Contact" size="small">
                {selected && (
                    <div className={styles.card}>
                        <Avatar name={selected.name} image={selected.linkedUser?.image} size="xl" />
                        <p className={styles.cardName}>{selected.name}</p>
                        <p className={styles.cardMeta}>
                            {selected.email}
                            {selected.phone ? ` · ${selected.phone}` : ''}
                        </p>
                        {selected.linkedUser
                            ? <Tag tone="success" icon={<UserCheck size={11} />}>On SplitX</Tag>
                            : <Tag tone="warning">Not on SplitX yet</Tag>}
                        <ListGroup className={styles.cardActions}>
                            {selected.linkedUser && (
                                <ListRow
                                    onClick={() => openGroupPicker(selected)}
                                    leading={<IconTile><Users size={18} /></IconTile>}
                                    title="Add to a group"
                                    subtitle="Invite them to one of your groups"
                                    chevron
                                />
                            )}
                            <ListRow
                                onClick={() => openShare(selected)}
                                leading={<IconTile tone="neutral"><Share2 size={18} /></IconTile>}
                                title={selected.linkedUser ? 'Share invite link' : 'Invite to SplitX'}
                                subtitle="WhatsApp, SMS, email or a link"
                                chevron
                            />
                            <ListRow
                                onClick={removing ? undefined : removeContact}
                                leading={<IconTile tone="danger">{removing ? <Spinner size={16} /> : <Trash2 size={18} />}</IconTile>}
                                title={confirmRemove ? 'Tap again to remove' : 'Remove contact'}
                                subtitle={confirmRemove ? 'This won’t affect shared groups' : undefined}
                                tone="danger"
                            />
                        </ListGroup>
                    </div>
                )}
            </Modal>

            {/* ── Group picker ── */}
            <Modal
                isOpen={Boolean(groupPickerFor)}
                onClose={() => setGroupPickerFor(null)}
                title={`Add ${firstName(groupPickerFor?.name)} to a group`}
                size="small"
            >
                {groupsQuery.isLoading && !groupsQuery.data ? (
                    <ListSkeleton rows={3} />
                ) : (groupsQuery.data ?? []).length === 0 ? (
                    <EmptyState
                        compact
                        variant="plain"
                        icon={<Users size={22} />}
                        title="No groups yet"
                        description="Create a group first, then invite your friends to it."
                        actionLabel="Create a group"
                        actionHref="/groups?create=1"
                    />
                ) : (
                    <ListGroup>
                        {(groupsQuery.data ?? []).map((group) => {
                            const alreadyIn = group.members?.some((member) => member.userId === groupPickerFor?.linkedUser?.id);
                            const sending = sendingTo === group.id;
                            return (
                                <ListRow
                                    key={group.id}
                                    onClick={alreadyIn || sendingTo ? undefined : () => sendGroupInvite(group.id)}
                                    leading={<IconTile tone="neutral"><span className={styles.groupEmoji}>{group.emoji}</span></IconTile>}
                                    title={group.name}
                                    subtitle={`${group.members?.length ?? 0} members`}
                                    trailing={alreadyIn
                                        ? <Tag tone="success">In group</Tag>
                                        : sending ? <Spinner size={16} /> : <Tag tone="accent" icon={<Send size={11} />}>Invite</Tag>}
                                    disabled={alreadyIn}
                                />
                            );
                        })}
                    </ListGroup>
                )}
            </Modal>

            {/* ── Share invite ── */}
            <Modal
                isOpen={Boolean(shareFor)}
                onClose={() => {
                    setShareFor(null);
                    setShareData(null);
                }}
                title={`Invite ${firstName(shareFor?.name)}`}
                size="small"
            >
                {!shareData ? (
                    <div className={styles.loadingBlock}><Spinner size={24} /></div>
                ) : (
                    <div className={styles.sheet}>
                        <div className={styles.shareGrid}>
                            <button
                                type="button"
                                className={styles.shareOption}
                                onClick={() => window.open(`https://wa.me/${digits}?text=${encodeURIComponent(shareData.message)}`, '_blank')}
                            >
                                <span className={styles.shareIcon}><MessageCircle size={18} /></span>
                                WhatsApp
                            </button>
                            <button
                                type="button"
                                className={styles.shareOption}
                                onClick={() => window.open(`sms:${digits}?body=${encodeURIComponent(shareData.message)}`, '_blank')}
                            >
                                <span className={styles.shareIcon}><MessageSquare size={18} /></span>
                                SMS
                            </button>
                            <button
                                type="button"
                                className={styles.shareOption}
                                onClick={() => window.open(`mailto:${shareFor?.email ?? ''}?subject=${encodeURIComponent('Join me on SplitX')}&body=${encodeURIComponent(shareData.message)}`, '_blank')}
                            >
                                <span className={styles.shareIcon}><Mail size={18} /></span>
                                Email
                            </button>
                        </div>
                        <div className={styles.linkBox}>
                            <Link2 size={16} style={{ color: 'var(--fg-muted)', flexShrink: 0 }} />
                            <span className={styles.linkText}>{shareData.url}</span>
                            <Button size="sm" variant={copied ? 'soft' : 'secondary'} onClick={copyLink} leftIcon={copied ? <Check size={14} /> : <Copy size={14} />}>
                                {copied ? 'Copied' : 'Copy'}
                            </Button>
                        </div>
                        <Button fullWidth leftIcon={<Share2 size={16} />} onClick={nativeShare}>More ways to share</Button>
                    </div>
                )}
            </Modal>
        </>
    );
}
