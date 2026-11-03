'use client';

import { useState } from 'react';

/** Compact avatar for use within the voice overlay. */
export function MemberAvatar({
    name,
    image,
    size = 36,
}: {
    name: string;
    image?: string | null;
    size?: number;
}) {
    const [imgErr, setImgErr] = useState(false);
    const initial = name.charAt(0).toUpperCase();
    const hue = name.split('').reduce((acc, c) => acc + (c.codePointAt(0) ?? 0), 0) % 360;

    if (image && !imgErr) {
        return (
            // A plain image, like Avatar: photos come from any sign-in provider, which Next's optimiser refuses.
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
                src={image}
                alt={name}
                width={size}
                height={size}
                referrerPolicy="no-referrer"
                onError={() => setImgErr(true)}
                style={{
                    width: size, height: size, borderRadius: size / 2,
                    objectFit: 'cover',
                    border: '2px solid var(--border-default)',
                    flexShrink: 0,
                }}
            />
        );
    }

    return (
        <div style={{
            width: size, height: size, borderRadius: size / 2,
            background: `oklch(${[0.38, 0.44, 0.5, 0.56][hue % 4]} calc(0.15 * var(--c)) var(--h))`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#ffffff', fontSize: size * 0.4, fontWeight: 700,
            flexShrink: 0,
            border: '2px solid rgba(255,255,255,0.08)',
        }}>
            {initial}
        </div>
    );
}
