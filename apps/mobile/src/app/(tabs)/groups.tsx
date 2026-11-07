/** Every group and trip you share money in, with where you stand in each. */
import { ChevronRight } from 'lucide-react-native';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { GROUPS } from '~/data/demo';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { AvatarStack } from '~/ui/Avatar';
import { rupees } from '~/ui/money';
import { Screen } from '~/ui/Screen';
import { Text } from '~/ui/Text';

export default function Groups() {
    const { tokens, calm } = useLook();
    const total = GROUPS.reduce((sum, group) => sum + group.totalPaise, 0);
    return (
        <Screen>
            <View style={{ alignItems: 'center', gap: 4 }}>
                <Text variant="eyebrow" tone="secondary" onLiquid>
                    Shared spaces
                </Text>
                <Text variant="display" onLiquid>
                    Your groups
                </Text>
                <Text variant="label" tone="secondary" onLiquid tabular>
                    {GROUPS.length} groups · {rupees(total)} tracked together
                </Text>
            </View>
            {GROUPS.map((group, index) => (
                <Animated.View key={group.id} entering={calm ? undefined : FadeInDown.delay(60 + index * 70).springify().damping(18)}>
                    <GlassSurface style={{ padding: 16, gap: 14 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: tokens.chip, alignItems: 'center', justifyContent: 'center' }}>
                                <Text style={{ fontSize: 24, lineHeight: 30 }}>{group.emoji}</Text>
                            </View>
                            <View style={{ flex: 1, gap: 2 }}>
                                <Text variant="heading" align="left">
                                    {group.name}
                                </Text>
                                <Text variant="caption" tone="secondary" align="left">
                                    {group.members.length} members · active {group.active}
                                </Text>
                            </View>
                            <ChevronRight size={20} color={tokens.muted} />
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <AvatarStack names={group.members} size={28} />
                            <View style={{ alignItems: 'flex-end' }}>
                                <Text variant="caption" tone="muted" align="right">
                                    {group.yourPaise >= 0 ? 'You get back' : 'You owe'}
                                </Text>
                                <Text variant="heading" tone={group.yourPaise >= 0 ? 'in' : 'out'} align="right" tabular>
                                    {rupees(Math.abs(group.yourPaise))}
                                </Text>
                            </View>
                        </View>
                    </GlassSurface>
                </Animated.View>
            ))}
        </Screen>
    );
}
