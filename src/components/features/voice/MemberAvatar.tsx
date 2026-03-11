'use client';

import { useState } from 'react';
import Image from 'next/image';

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
    const hue = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

    if (image && !imgErr) {
        return (
            <Image
                src={image}
                alt={name}
                width={size}
                height={size}
                onError={() => setImgErr(true)}
                style={{
                    width: size, height: size, borderRadius: size / 2,
                    objectFit: 'cover',
                    border: '2px solid rgba(255,255,255,0.08)',
                    flexShrink: 0,
                }}
            />
        );
    }

    return (
        <div style={{
            width: size, height: size, borderRadius: size / 2,
            background: `hsl(${hue}, 60%, 50%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: size * 0.4, fontWeight: 700,
            flexShrink: 0,
            border: '2px solid rgba(255,255,255,0.08)',
        }}>
            {initial}
        </div>
    );
}
