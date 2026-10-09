import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isNavActive } from '@/lib/navigation';

describe('isNavActive', () => {
    it('marks a destination and the pages beneath it', () => {
        expect(isNavActive('/groups', '/groups')).toBe(true);
        expect(isNavActive('/groups', '/groups/abc/journey')).toBe(true);
        expect(isNavActive('/settings', '/settings')).toBe(true);
    });

    it('does not mark a destination that only shares a prefix', () => {
        expect(isNavActive('/groups', '/groupsx')).toBe(false);
        expect(isNavActive('/dashboard', '/groups')).toBe(false);
    });

    it('keeps Activity off while composing or scanning, and on for its receipts', () => {
        expect(isNavActive('/transactions', '/transactions')).toBe(true);
        expect(isNavActive('/transactions', '/transactions/receipts')).toBe(true);
        expect(isNavActive('/transactions', '/transactions/new')).toBe(false);
        expect(isNavActive('/transactions', '/transactions/scan')).toBe(false);
    });
});

describe('profile photos', () => {
    // Next's image optimiser admits only the hosts in next.config, and a sign-in provider's
    // photo can come from anywhere (GitHub's did not): a refused photo showed its alt text
    // in the money flow map. Members' photos are plain images that fall back to initials.
    it.each([
        'src/components/features/SettlementGraph.tsx',
        'src/components/features/voice/MemberAvatar.tsx',
        'src/components/ui/Avatar.tsx',
    ])('%s draws them without next/image', (file) => {
        const source = readFileSync(file, 'utf8');
        expect(source).not.toMatch(/from 'next\/image'/);
        expect(source).toMatch(/onError=/);
    });
});
