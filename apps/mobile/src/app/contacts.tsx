/**
 * Your people, as on the website's Contacts: everyone you've added, who is on SplitIT and who is
 * still to invite, and a search. Someone on SplitIT can be invited into one of your groups (they
 * accept in the app); anyone can be sent a link, to sign up or to join a group. Kept on the
 * server, so this screen needs a connection.
 */
import { ChevronRight, Link2, Trash2, UserPlus, Users } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import type { Contact } from '@/lib/contract/v1';
import { api } from '~/api';
import { authErrorMessage } from '~/auth/AuthProvider';
import { useLedger } from '~/data/LedgerProvider';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { Avatar } from '~/ui/Avatar';
import { Chips } from '~/ui/Chips';
import { EmptyState } from '~/ui/EmptyState';
import { Field } from '~/ui/Field';
import { GlassButton } from '~/ui/GlassButton';
import { Header } from '~/ui/Header';
import { Screen } from '~/ui/Screen';
import { Segmented } from '~/ui/Segmented';
import { Sheet } from '~/ui/Sheet';
import { Skeleton } from '~/ui/Skeleton';
import { Text } from '~/ui/Text';
import { useToast } from '~/ui/Toast';

type Filter = 'all' | 'onApp' | 'invite';
const firstName = (name: string) => name.split(' ')[0];
const plain = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function Contacts() {
    const { tokens } = useLook();
    const { real, ledger } = useLedger();
    const toast = useToast();
    const [contacts, setContacts] = useState<Contact[] | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    const [filter, setFilter] = useState<Filter>('all');
    const [query, setQuery] = useState('');
    const [adding, setAdding] = useState(false);
    const [selected, setSelected] = useState<Contact | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setFailed(null);
        try {
            setContacts((await api.contacts()).contacts);
        } catch (error) {
            setFailed(authErrorMessage(error));
        }
    }, []);

    useEffect(() => {
        if (!real) return;
        let live = true;
        api.contacts()
            .then(({ contacts: list }) => live && setContacts(list))
            .catch((error: unknown) => live && setFailed(authErrorMessage(error)));
        return () => {
            live = false;
        };
    }, [real]);

    const onApp = contacts?.filter((contact) => contact.userId).length ?? 0;
    const shown = useMemo(() => {
        const words = plain(query).split(/\s+/).filter(Boolean);
        return (contacts ?? []).filter((contact) => {
            if (filter === 'onApp' && !contact.userId) return false;
            if (filter === 'invite' && contact.userId) return false;
            const text = plain(`${contact.name} ${contact.email} ${contact.phone ?? ''}`);
            return words.every((word) => text.includes(word));
        });
    }, [contacts, filter, query]);

    const run = async (work: () => Promise<void>) => {
        setBusy(true);
        try {
            await work();
        } catch (error) {
            toast(authErrorMessage(error), 'info');
        } finally {
            setBusy(false);
        }
    };

    if (!real) {
        return (
            <Screen tabBar={false}>
                <Header title="Contacts" />
                <EmptyState emoji="👥" title="Contacts come with your account" hint="Sign in, and the people you add here can be invited into your groups." />
            </Screen>
        );
    }

    return (
        <>
            <Screen tabBar={false} onRefresh={load}>
                <Header title="Contacts" eyebrow="Your people" />

                <GlassButton kind="accent" contentStyle={{ height: 52, flexDirection: 'row', gap: 8 }} onPress={() => setAdding(true)}>
                    <UserPlus size={18} color={tokens.onAccent} strokeWidth={2.4} />
                    <Text variant="label" tone="onAccent">
                        Add a contact
                    </Text>
                </GlassButton>

                {failed ? (
                    <View style={{ gap: 12 }}>
                        <EmptyState emoji="📡" title="Couldn’t load your contacts" hint={failed} />
                        <GlassButton kind="thin" contentStyle={{ height: 46, paddingHorizontal: 26 }} style={{ alignSelf: 'center' }} onPress={() => void load()}>
                            <Text variant="label">Try again</Text>
                        </GlassButton>
                    </View>
                ) : contacts === null ? (
                    <View style={{ gap: 10 }}>
                        <Skeleton height={64} radius={20} />
                        <Skeleton height={64} radius={20} />
                        <Skeleton height={64} radius={20} />
                    </View>
                ) : contacts.length === 0 ? (
                    <EmptyState emoji="👋" title="Your people live here" hint="Add a friend by their email. Anyone already on SplitIT can be invited straight into a group." />
                ) : (
                    <>
                        <Segmented
                            options={[
                                { id: 'all', label: `All · ${contacts.length}` },
                                { id: 'onApp', label: `On SplitIT · ${onApp}` },
                                { id: 'invite', label: `To invite · ${contacts.length - onApp}` },
                            ]}
                            value={filter}
                            onChange={setFilter}
                            compact
                        />
                        <Field label="Search name, email or phone" value={query} onChangeText={setQuery} autoCorrect={false} autoCapitalize="none" returnKeyType="search" />
                        {shown.length === 0 ? (
                            <EmptyState emoji="🔍" title="No matches" hint="Try another name, or All." />
                        ) : (
                            <GlassSurface style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
                                {shown.map((contact, index) => (
                                    <Pressable
                                        key={contact.id}
                                        accessibilityRole="button"
                                        accessibilityLabel={`${contact.name}${contact.userId ? ', on SplitIT' : ''}. Options`}
                                        onPress={() => setSelected(contact)}
                                        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: tokens.border }}
                                    >
                                        <Avatar name={contact.name} size={40} />
                                        <View style={{ flex: 1, gap: 2 }}>
                                            <Text variant="label" align="left" numberOfLines={1}>
                                                {contact.name}
                                            </Text>
                                            <Text variant="caption" tone="secondary" align="left" numberOfLines={1}>
                                                {contact.userId ? `On SplitIT · ${contact.email}` : contact.email}
                                            </Text>
                                        </View>
                                        <ChevronRight size={18} color={tokens.muted} />
                                    </Pressable>
                                ))}
                            </GlassSurface>
                        )}
                    </>
                )}
            </Screen>

            <AddContact
                open={adding}
                busy={busy}
                onClose={() => setAdding(false)}
                onSave={(input) =>
                    run(async () => {
                        const { contact } = await api.addContact(input);
                        setContacts((current) => [contact, ...(current ?? [])]);
                        setAdding(false);
                        toast(contact.userId ? `${firstName(contact.name)} is already on SplitIT` : `${firstName(contact.name)} added`);
                    })
                }
            />

            <ContactSheet
                contact={selected}
                groups={ledger.groups.filter((group) => !selected?.userId || !group.memberIds.includes(selected.userId))}
                busy={busy}
                onClose={() => setSelected(null)}
                onInvite={(groupId) =>
                    run(async () => {
                        if (!selected?.userId) return;
                        await api.inviteToGroup(groupId, selected.userId);
                        const group = ledger.groups.find((candidate) => candidate.id === groupId);
                        setSelected(null);
                        toast(`Invited ${firstName(selected.name)} to ${group?.name ?? 'the group'}`);
                    })
                }
                onShare={(groupId) =>
                    run(async () => {
                        if (!selected) return;
                        const link = await api.contactInvite(selected.id, groupId);
                        await Share.share({ message: link.message });
                    })
                }
                onRemove={() =>
                    run(async () => {
                        if (!selected) return;
                        await api.removeContact(selected.id);
                        setContacts((current) => (current ?? []).filter((contact) => contact.id !== selected.id));
                        toast(`${firstName(selected.name)} removed`);
                        setSelected(null);
                    })
                }
            />
        </>
    );
}

function AddContact({ open, busy, onClose, onSave }: { open: boolean; busy: boolean; onClose: () => void; onSave: (input: { name: string; email: string; phone?: string }) => void }) {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const ready = name.trim().length > 0 && /^\S+@\S+\.\S+$/.test(email.trim());
    const close = () => {
        setName('');
        setEmail('');
        setPhone('');
        onClose();
    };
    return (
        <Sheet open={open} onClose={close} title="Add a contact" hint="If their email is on SplitIT, they can be invited straight into a group.">
            <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" returnKeyType="next" />
            <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" returnKeyType="next" />
            <Field label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" returnKeyType="done" />
            <GlassButton
                kind="accent"
                disabled={!ready || busy}
                contentStyle={{ height: 52 }}
                onPress={() => {
                    onSave({ name: name.trim(), email: email.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}) });
                    setName('');
                    setEmail('');
                    setPhone('');
                }}
            >
                <Text variant="label" tone="onAccent">
                    {busy ? 'Adding…' : 'Add'}
                </Text>
            </GlassButton>
        </Sheet>
    );
}

function ContactSheet({
    contact,
    groups,
    busy,
    onClose,
    onInvite,
    onShare,
    onRemove,
}: {
    contact: Contact | null;
    groups: { id: string; name: string; emoji: string }[];
    busy: boolean;
    onClose: () => void;
    onInvite: (groupId: string) => void;
    onShare: (groupId?: string) => void;
    onRemove: () => void;
}) {
    const { tokens } = useLook();
    const [groupId, setGroupId] = useState<string | null>(null);
    const chosen = groupId && groups.some((group) => group.id === groupId) ? groupId : (groups[0]?.id ?? null);
    const first = contact ? firstName(contact.name) : '';
    return (
        <Sheet open={contact !== null} onClose={onClose} title={contact?.name ?? ''} hint={contact ? (contact.userId ? `On SplitIT · ${contact.email}` : `${contact.email}. Not on SplitIT yet.`) : undefined}>
            {groups.length > 0 ? (
                <View style={{ gap: 8 }}>
                    <Text variant="eyebrow" tone="secondary">
                        Into a group
                    </Text>
                    <Chips label="Group" options={groups.map((group) => ({ id: group.id, label: group.name, emoji: group.emoji }))} value={chosen ?? ''} onChange={setGroupId} />
                </View>
            ) : null}
            {contact?.userId && chosen ? (
                <GlassButton kind="accent" disabled={busy} contentStyle={{ height: 52, flexDirection: 'row', gap: 8 }} onPress={() => onInvite(chosen)}>
                    <Users size={18} color={tokens.onAccent} strokeWidth={2.4} />
                    <Text variant="label" tone="onAccent">
                        Invite {first}
                    </Text>
                </GlassButton>
            ) : null}
            <GlassButton kind={contact?.userId ? 'thin' : 'accent'} disabled={busy} contentStyle={{ height: 52, flexDirection: 'row', gap: 8 }} onPress={() => onShare(chosen ?? undefined)}>
                <Link2 size={18} color={contact?.userId ? tokens.fg : tokens.onAccent} strokeWidth={2.4} />
                <Text variant="label" tone={contact?.userId ? 'primary' : 'onAccent'}>
                    {chosen ? 'Send a link to join' : 'Send a link to SplitIT'}
                </Text>
            </GlassButton>
            <GlassButton kind="thin" disabled={busy} contentStyle={{ height: 50, flexDirection: 'row', gap: 8 }} onPress={onRemove}>
                <Trash2 size={17} color={tokens.danger} strokeWidth={2.2} />
                <Text variant="label" tone="danger">
                    Remove {first}
                </Text>
            </GlassButton>
        </Sheet>
    );
}
