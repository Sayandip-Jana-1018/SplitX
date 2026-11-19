/**
 * The list behind the bell, as the website's: your newest 50 notifications, unread ones marked,
 * today's first. Tapping one marks it read and opens what it's about; Mark all read clears the dot.
 */
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import type { AppNotification } from '@/lib/contract/v1';
import { useAuth } from '~/auth/AuthProvider';
import { markRead, refreshInbox, useInbox } from '~/notifications/inbox';
import { screenFor } from '~/notifications/links';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { EmptyState } from '~/ui/EmptyState';
import { GlassButton } from '~/ui/GlassButton';
import { Header } from '~/ui/Header';
import { Screen } from '~/ui/Screen';
import { Skeleton } from '~/ui/Skeleton';
import { Text } from '~/ui/Text';
import { when } from '~/ui/time';

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export default function Notifications() {
    const { tokens } = useLook();
    const auth = useAuth();
    const { notifications, unread } = useInbox();
    const signedIn = auth.status === 'signed_in';

    useEffect(() => {
        if (signedIn) void refreshInbox();
    }, [signedIn]);

    if (!signedIn) {
        return (
            <Screen tabBar={false}>
                <Header title="Notifications" />
                <EmptyState emoji="🔔" title="Nothing here in the demo" hint="Sign in, and you’re told here when friends add an expense, pay you back, or remind you." />
            </Screen>
        );
    }

    const open = (notification: AppNotification) => {
        if (!notification.read) markRead([notification.id]);
        router.push(screenFor(notification.link) as never);
    };

    const now = new Date();
    const today = (notifications ?? []).filter((n) => sameDay(new Date(n.createdAt), now));
    const earlier = (notifications ?? []).filter((n) => !sameDay(new Date(n.createdAt), now));

    const section = (title: string, items: AppNotification[]) =>
        items.length === 0 ? null : (
            <View style={{ gap: 10 }}>
                <Text variant="eyebrow" tone="secondary" onLiquid>
                    {title}
                </Text>
                <GlassSurface style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
                    {items.map((notification, index) => (
                        <Pressable
                            key={notification.id}
                            accessibilityRole="button"
                            accessibilityLabel={`${notification.read ? '' : 'Unread. '}${notification.title}. ${notification.body}`}
                            onPress={() => open(notification)}
                            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 14, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: tokens.border }}
                        >
                            <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, backgroundColor: notification.read ? 'transparent' : tokens.accent }} />
                            <View style={{ flex: 1, gap: 3 }}>
                                <Text variant="label" align="left" weight={notification.read ? 'semibold' : 'bold'}>
                                    {notification.title}
                                </Text>
                                {notification.body ? (
                                    <Text variant="caption" tone="secondary" align="left">
                                        {notification.body}
                                    </Text>
                                ) : null}
                                <Text variant="caption" tone="muted" align="left">
                                    {when(new Date(notification.createdAt))}
                                </Text>
                            </View>
                        </Pressable>
                    ))}
                </GlassSurface>
            </View>
        );

    return (
        <Screen tabBar={false} onRefresh={refreshInbox}>
            <Header title="Notifications" eyebrow={unread > 0 ? (unread === 1 ? '1 unread' : `${unread} unread`) : 'All caught up'} />
            {notifications === null ? (
                <View style={{ gap: 10 }}>
                    <Skeleton height={76} radius={20} />
                    <Skeleton height={76} radius={20} />
                    <Skeleton height={76} radius={20} />
                </View>
            ) : notifications.length === 0 ? (
                <EmptyState emoji="🔔" title="Nothing yet" hint="You’re told here when friends add an expense, pay you back, or remind you." />
            ) : (
                <>
                    {unread > 0 ? (
                        <GlassButton kind="thin" style={{ alignSelf: 'center' }} contentStyle={{ height: 40, paddingHorizontal: 22 }} onPress={() => markRead()}>
                            <Text variant="caption" weight="bold">
                                Mark all read
                            </Text>
                        </GlassButton>
                    ) : null}
                    {section('Today', today)}
                    {section('Earlier', earlier)}
                </>
            )}
        </Screen>
    );
}
