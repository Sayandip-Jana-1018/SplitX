/** A short message on a pill of glass at the top of the screen, which says what just happened. */
import { Check, Info } from 'lucide-react-native';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSurface } from '~/glass/GlassSurface';
import { useLook } from '~/theme/ThemeProvider';
import { Text } from './Text';

interface Message {
    id: number;
    text: string;
    tone: 'done' | 'info';
}

const ToastContext = createContext<(text: string, tone?: Message['tone']) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
    const insets = useSafeAreaInsets();
    const { tokens, calm } = useLook();
    const [message, setMessage] = useState<Message | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const show = useCallback((text: string, tone: Message['tone'] = 'done') => {
        if (timer.current) clearTimeout(timer.current);
        setMessage({ id: Date.now(), text, tone });
        timer.current = setTimeout(() => setMessage(null), 2600);
    }, []);

    const Icon = message?.tone === 'info' ? Info : Check;
    return (
        <ToastContext.Provider value={show}>
            {children}
            <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + 8, left: 0, right: 0, alignItems: 'center' }}>
                {message ? (
                    <Animated.View key={message.id} entering={calm ? undefined : FadeInUp.springify().damping(16)} exiting={calm ? undefined : FadeOutUp.duration(220)} accessibilityLiveRegion="polite">
                        <GlassSurface kind="thick" radius={999} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 18, maxWidth: 360 }}>
                            <Icon size={18} color={tokens.accentText} strokeWidth={2.6} />
                            <Text variant="label">{message.text}</Text>
                        </GlassSurface>
                    </Animated.View>
                ) : null}
            </View>
        </ToastContext.Provider>
    );
}

export const useToast = () => useContext(ToastContext);
