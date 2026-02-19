'use client';

import { useState } from 'react';
import styles from './avatar.module.css';
import { cn, getInitials, getAvatarColor } from '@/lib/utils';

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface AvatarProps {
    name: string;
    image?: string | null;
    size?: AvatarSize;
    ring?: boolean;
    className?: string;
}

export default function Avatar({ name, image, size = 'md', ring, className }: AvatarProps) {
    const initials = getInitials(name);
    const bgColor = getAvatarColor(name);
    const [imgError, setImgError] = useState(false);

    const showImage = image && !imgError;

    return (
        <div
            className={cn(styles.avatar, styles[size], ring && styles.ring, className)}
            style={{ backgroundColor: showImage ? undefined : bgColor }}
            title={name}
        >
            {showImage ? (
                <img
                    src={image}
                    alt={name}
                    className={styles.image}
                    onError={() => setImgError(true)}
                    referrerPolicy="no-referrer"
                />
            ) : (
                initials
            )}
        </div>
    );
}

// Avatar Group — stacks avatars with overlap
interface AvatarGroupProps {
    users: Array<{ name: string; image?: string | null }>;
    max?: number;
    size?: AvatarSize;
}

export function AvatarGroup({ users, max = 4, size = 'sm' }: AvatarGroupProps) {
    const visible = users.slice(0, max);
    const remaining = users.length - max;

    return (
        <div className={styles.group}>
            {visible.map((user, i) => (
                <Avatar key={i} name={user.name} image={user.image} size={size} />
            ))}
            {remaining > 0 && (
                <div className={cn(styles.avatar, styles[size], styles.overflow)}>
                    +{remaining}
                </div>
            )}
        </div>
    );
}
