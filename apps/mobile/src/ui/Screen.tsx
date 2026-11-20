/**
 * A screen over the liquid: it scrolls, keeps clear of the notch and the floating tab bar,
 * and keeps everything on one centre axis, at a readable width on a tablet too. Its glass is drawn
 * by the scroll view, in strips that scroll with the content (GlassScrollView). The keyboard
 * shortens it rather than covering it, and a tap on a button while typing presses the button (not
 * just closes the keyboard).
 */
import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, RefreshControl, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassScrollView } from '~/glass/GlassScroll';
import { useLook } from '~/theme/ThemeProvider';

/** The floating tab bar's height, with the gap above it. */
export const TAB_BAR_ROOM = 112;

interface Props {
    children: ReactNode;
    /** Screens without the tab bar, such as sheets, need less room at the bottom. */
    tabBar?: boolean;
    contentStyle?: StyleProp<ViewStyle>;
    /** Pull down to bring it up to date. */
    onRefresh?: () => Promise<unknown>;
}

export function Screen({ children, tabBar = true, contentStyle, onRefresh }: Props) {
    const insets = useSafeAreaInsets();
    const { tokens } = useLook();
    const [pulling, setPulling] = useState(false);
    const pull = onRefresh
        ? () => {
              setPulling(true);
              onRefresh().finally(() => setPulling(false));
          }
        : undefined;
    return (
        <View style={{ flex: 1 }}>
            <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
            <GlassScrollView
                style={{ flex: 1 }}
                keyboardShouldPersistTaps="handled"
                refreshControl={pull ? <RefreshControl refreshing={pulling} onRefresh={pull} progressViewOffset={insets.top} tintColor={tokens.accentText} colors={[tokens.accentText]} progressBackgroundColor={tokens.bg} /> : undefined}
                contentContainerStyle={{
                    paddingTop: insets.top + 12,
                    paddingBottom: insets.bottom + (tabBar ? TAB_BAR_ROOM : 32),
                    paddingHorizontal: 20,
                    alignItems: 'center',
                }}
                showsVerticalScrollIndicator={false}
            >
                <View style={[{ width: '100%', maxWidth: 560, gap: 22 }, contentStyle]}>{children}</View>
            </GlassScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

/** A section's title, centred, with an optional link beside it. */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: -8 }}>
            {children}
            {action ? <View style={{ position: 'absolute', right: 0 }}>{action}</View> : null}
        </View>
    );
}
