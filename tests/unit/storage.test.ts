import { afterEach, describe, expect, it, vi } from 'vitest';
import { avatarObjectPath, receiptObjectPath, sniffImageType, storageAdmin, StorageUnavailableError } from '@/lib/storage';

const bytes = (...values: number[]) => new Uint8Array([...values, ...new Array(16).fill(0)]);

describe('sniffImageType', () => {
    it.each([
        ['image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0)],
        ['image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
        ['image/webp', bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)],
        ['image/gif', bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)],
    ])('recognises %s from its signature', (type, file) => {
        expect(sniffImageType(file)).toBe(type);
    });

    it.each([
        ['SVG', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')],
        ['HTML', new TextEncoder().encode('<!doctype html><script>')],
        ['a RIFF file that is not WebP (WAV)', bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45)],
        ['a truncated PNG signature', new Uint8Array([0x89, 0x50, 0x4e])],
        ['nothing', new Uint8Array()],
    ])('rejects %s', (_, file) => {
        expect(sniffImageType(file)).toBeNull();
    });
});

describe('object paths', () => {
    it("put receipts and avatars in the user's own folder under random names", () => {
        expect(receiptObjectPath('cuseralice00001', 'image/jpeg')).toMatch(/^cuseralice00001\/[0-9a-f-]{36}\.jpg$/);
        expect(avatarObjectPath('cuseralice00001', 'image/gif')).toMatch(/^avatars\/cuseralice00001\/[0-9a-f-]{36}\.gif$/);
        expect(receiptObjectPath('cuseralice00001', 'image/png')).not.toBe(receiptObjectPath('cuseralice00001', 'image/png'));
    });

    it.each(['../cuserbob', 'a/b', '', 'x'.repeat(65), 'alice@example.com'])('refuses to build a path from the id %j', (userId) => {
        expect(() => receiptObjectPath(userId, 'image/jpeg')).toThrow();
    });
});

describe('storageAdmin', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('is unavailable without the service role key', () => {
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdproject.supabase.co');
        vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
        expect(() => storageAdmin()).toThrow(StorageUnavailableError);
    });
});
