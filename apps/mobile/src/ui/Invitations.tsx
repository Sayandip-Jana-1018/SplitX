/**
 * Invitations into groups, waiting for your answer: someone added you from their contacts. Shown
 * at the top of Groups, for your real account, only while there are any. Join puts you in the
 * group (and opens it); No thanks tells them so.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import type { Invitation } from '@/lib/contract/v1';
import { api } from '~/api';
import { authErrorMessage } from '~/auth/AuthProvider';
import { useLedger } from '~/data/LedgerProvider';
import { GlassSurface } from '~/glass/GlassSurface';
import { GlassButton } from './GlassButton';
import { Text } from './Text';
import { useToast } from './Toast';

export function Invitations() {
    const { real, refresh } = useLedger();
    const toast = useToast();
    const [waiting, setWaiting] = useState<Invitation[]>([]);
    const [busy, setBusy] = useState<string | null>(null);

    // Asked each time Groups comes into view; offline, whatever was shown stays.
    useFocusEffect(
        useCallback(() => {
            if (!real) return;
            let live = true;
            api.invitations()
                .then(({ invitations }) => live && setWaiting(invitations))
                .catch(() => undefined);
            return () => {
                live = false;
            };
        }, [real]),
    );

    if (!real || waiting.length === 0) return null;

    const answer = async (invitation: Invitation, accept: boolean) => {
        setBusy(invitation.id);
        try {
            const { groupId } = await api.answerInvitation(invitation.id, accept);
            setWaiting((current) => current.filter((other) => other.id !== invitation.id));
            if (accept) {
                await refresh();
                toast(`You’re in ${invitation.groupName}`);
                if (groupId) router.push(`/group/${groupId}`);
            } else {
                toast(`${invitation.fromName.split(' ')[0]} is told you said no thanks`, 'info');
            }
        } catch (error) {
            toast(authErrorMessage(error), 'info');
        } finally {
            setBusy(null);
        }
    };

    return (
        <View style={{ gap: 12 }}>
            {waiting.map((invitation) => (
                <GlassSurface key={invitation.id} kind="thin" style={{ paddingVertical: 16, paddingHorizontal: 18, gap: 12, alignItems: 'center' }}>
                    <Text style={{ fontSize: 30, lineHeight: 38 }}>{invitation.groupEmoji}</Text>
                    <View style={{ alignItems: 'center', gap: 2 }}>
                        <Text variant="heading">{invitation.groupName}</Text>
                        <Text variant="caption" tone="secondary">
                            {invitation.fromName.split(' ')[0]} invited you to join
                        </Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch' }}>
                        <GlassButton kind="accent" style={{ flex: 1 }} contentStyle={{ height: 44 }} disabled={busy !== null} onPress={() => void answer(invitation, true)}>
                            <Text variant="label" tone="onAccent">
                                {busy === invitation.id ? 'Joining…' : 'Join'}
                            </Text>
                        </GlassButton>
                        <GlassButton kind="thin" style={{ flex: 1 }} contentStyle={{ height: 44 }} disabled={busy !== null} onPress={() => void answer(invitation, false)}>
                            <Text variant="label">No thanks</Text>
                        </GlassButton>
                    </View>
                </GlassSurface>
            ))}
        </View>
    );
}
