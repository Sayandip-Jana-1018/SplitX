'use client';

import { useState, type CSSProperties } from 'react';
import styles from './avatar.module.css';
import { cn, getAvatarHue, getInitials } from '@/lib/utils';

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface AvatarProps {
    name: string;
    image?: string | null;
    size?: AvatarSize;
    ring?: boolean;
    className?: string;
    style?: CSSProperties;
}

const AVATAR_DEPTHS = [0.38, 0.44, 0.5, 0.56];

export default function Avatar({ name, image, size = 'md', ring, className, style }: AvatarProps) {
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const showImage = Boolean(image) && failedSrc !== image;
    const hue = getAvatarHue(name || '?');
    const depth = AVATAR_DEPTHS[hue % AVATAR_DEPTHS.length];
    const fallbackBackground = `oklch(${depth} calc(0.15 * var(--c)) var(--h))`;

    return (
        <span
            className={cn(styles.avatar, styles[size], ring && styles.ring, className)}
            style={showImage ? style : { background: fallbackBackground, ...style }}
            title={name}
        >
            {showImage ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                    src={image as string}
                    alt={name}
                    className={styles.image}
                    onError={() => setFailedSrc(image ?? null)}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                />
            ) : (
                <span className={styles.initials}>{getInitials(name || '?')}</span>
            )}
        </span>
    );
}

interface AvatarGroupProps {
    users: Array<{ name: string; image?: string | null }>;
    max?: number;
    size?: AvatarSize;
    className?: string;
}

export function AvatarGroup({ users, max = 4, size = 'sm', className }: AvatarGroupProps) {
    const visible = users.slice(0, max);
    const remaining = users.length - max;

    return (
        <span className={cn(styles.group, className)}>
            {visible.map((user, index) => (
                <Avatar key={`${user.name}-${index}`} name={user.name} image={user.image} size={size} />
            ))}
            {remaining > 0 && (
                <span className={cn(styles.avatar, styles[size], styles.overflow)}>+{remaining}</span>
            )}
        </span>
    );
}
