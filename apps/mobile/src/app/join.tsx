/**
 * Joining a group with the invite link someone sent you, or just its code. A pasted link is kept as
 * its code, and what it opens shows before you join: the group's name and how many are in it.
 */
import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { InvitePreview } from '@/lib/contract/v1';
import { api } from '~/api';
import { authErrorMessage } from '~/auth/AuthProvider';
import { useStep } from '~/auth/flow';
import { inviteCodeOf, useLedger } from '~/data/LedgerProvider';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { FONT } from '~/theme/type';
import { Field } from '~/ui/Field';
import { GlassButton } from '~/ui/GlassButton';
import { Header } from '~/ui/Header';
import { members } from '~/ui/money';
import { Screen } from '~/ui/Screen';
import { Text } from '~/ui/Text';
import { useToast } from '~/ui/Toast';

/** Invite codes are long and random: anything shorter is still being typed. */
const LONG_ENOUGH = 8;

export default function Join() {
    const { joinGroup } = useLedger();
    const { tokens } = useLook();
    const toast = useToast();
    const [code, setCode] = useState('');
    const [preview, setPreview] = useState<{ code: string; group: InvitePreview | null; problem: string | null } | null>(null);
    const { busy, error, run } = useStep();
    const ready = code.length >= LONG_ENOUGH;
    const shown = preview && preview.code === code ? preview : null;

    // What the code opens, a moment after it stops changing.
    useEffect(() => {
        if (code.length < LONG_ENOUGH) return;
        let live = true;
        const timer = setTimeout(() => {
            api.previewInvite(code)
                .then((group) => live && setPreview({ code, group, problem: null }))
                .catch((caught) => live && setPreview({ code, group: null, problem: authErrorMessage(caught) }));
        }, 350);
        return () => {
            live = false;
            clearTimeout(timer);
        };
    }, [code]);

    const join = () =>
        run(async () => {
            if (shown?.group?.alreadyIn) {
                router.replace(`/group/${shown.group.groupId}`);
                return;
            }
            const groupId = await joinGroup(code);
            toast(shown?.group ? `You’re in ${shown.group.name}` : 'You’re in');
            router.replace(`/group/${groupId}`);
        });

    return (
        <Screen tabBar={false}>
            <Header title="Join a group" close />
            <Text variant="body" tone="secondary" onLiquid style={{ maxWidth: 320, alignSelf: 'center' }}>
                Paste the invite link someone in the group sent you. Links work for 7 days.
            </Text>
            <View style={{ gap: 14 }}>
                <Field
                    label="Invite link or code"
                    value={code}
                    // A whole link becomes its code: shorter to show, and the same thing to the server.
                    onChangeText={(text) => setCode(inviteCodeOf(text))}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    maxLength={300}
                    autoFocus
                    returnKeyType="go"
                    onSubmitEditing={() => ready && !busy && join()}
                    style={code ? { fontFamily: FONT.medium, fontSize: code.length > 24 ? 12.5 : 15, letterSpacing: 0.2 } : undefined}
                />

                {shown?.group ? (
                    <GlassSurface style={{ alignItems: 'center', gap: 6, paddingVertical: 18 }}>
                        <Text style={{ fontSize: 34, lineHeight: 44 }}>{shown.group.emoji}</Text>
                        <Text variant="heading">{shown.group.name}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            {shown.group.alreadyIn ? <Check size={14} color={tokens.accentText} strokeWidth={2.6} /> : null}
                            <Text variant="caption" tone={shown.group.alreadyIn ? 'accent' : 'secondary'}>
                                {shown.group.alreadyIn ? 'You’re already in this group' : members(shown.group.members)}
                            </Text>
                        </View>
                    </GlassSurface>
                ) : null}

                {shown?.problem || error ? (
                    <Text variant="label" tone="danger" onLiquid accessibilityLiveRegion="polite">
                        {error ?? shown?.problem}
                    </Text>
                ) : null}

                <GlassButton kind="accent" contentStyle={{ height: 56 }} disabled={!ready || busy || Boolean(shown?.problem)} onPress={join}>
                    <Text variant="heading" tone="onAccent" numberOfLines={1}>
                        {busy ? 'Joining…' : shown?.group ? (shown.group.alreadyIn ? `Open ${shown.group.name}` : `Join ${shown.group.name}`) : 'Join'}
                    </Text>
                </GlassButton>
            </View>
        </Screen>
    );
}
