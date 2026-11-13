/**
 * An amount that rolls to its new value when it changes, so you see money move. Calm motion
 * shows the new value at once.
 */
import { useEffect, useRef, useState } from 'react';
import type { TextProps } from 'react-native';
import { useLook } from '~/theme/ThemeProvider';
import { rupees } from './money';
import { Text, type Tone } from './Text';
import type { Variant, Weight } from '~/theme/type';

interface Props extends TextProps {
    paise: number;
    sign?: boolean;
    variant?: Variant;
    weight?: Weight;
    tone?: Tone;
    onLiquid?: boolean;
}

const DURATION_MS = 700;

export function RollingAmount({ paise, sign, ...rest }: Props) {
    const { calm } = useLook();
    const [shown, setShown] = useState(paise);
    const from = useRef(paise);

    useEffect(() => {
        if (calm || from.current === paise) {
            from.current = paise;
            setShown(paise);
            return;
        }
        const start = Date.now();
        const origin = from.current;
        let frame = 0;
        const step = () => {
            const progress = Math.min(1, (Date.now() - start) / DURATION_MS);
            const eased = 1 - (1 - progress) ** 3;
            setShown(Math.round(origin + (paise - origin) * eased));
            if (progress < 1) frame = requestAnimationFrame(step);
            else from.current = paise;
        };
        frame = requestAnimationFrame(step);
        return () => cancelAnimationFrame(frame);
    }, [paise, calm]);

    return (
        <Text tabular {...rest}>
            {rupees(shown, { sign })}
        </Text>
    );
}
