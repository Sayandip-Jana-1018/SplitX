import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase Storage, using the service role key.
 *
 * Browsers never write to storage with the public anon key. Receipt photos go
 * up through short-lived signed upload URLs that this server issues for a path
 * it chooses; profile photos are uploaded by the server itself. Object names
 * are random and uploads never overwrite, so no one can replace another
 * person's file, and no email address ever appears in a public URL.
 */

export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
// Browsers shrink receipt photos to 2,048 pixels before upload (lib/receiptUpload.ts),
// usually well under 1 MB; 5 MB leaves room for an original that couldn't be redrawn.
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/** The types a profile photo may be (sniffImageType); receipts take the first three (RECEIPT_TYPES). */
type ImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

const EXTENSIONS: Record<ImageType, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
};

export class StorageUnavailableError extends Error {
    constructor() {
        super('Storage is not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
        this.name = 'StorageUnavailableError';
    }
}

export function storageAdmin(): SupabaseClient {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) throw new StorageUnavailableError();
    return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

function userFolder(userId: string) {
    // Ids come from the database, but they become a path: never let one escape its folder.
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) throw new Error('Unexpected user id format for a storage path');
    return userId;
}

export function receiptObjectPath(userId: string, contentType: (typeof RECEIPT_TYPES)[number]) {
    return `${userFolder(userId)}/${randomUUID()}.${EXTENSIONS[contentType]}`;
}

export function avatarObjectPath(userId: string, contentType: ImageType) {
    return `avatars/${userFolder(userId)}/${randomUUID()}.${EXTENSIONS[contentType]}`;
}

/**
 * Removes every profile photo a person uploaded, for account deletion. Receipt
 * photos stay: they belong to the group's expenses, which other people still see.
 */
export async function removeAvatars(userId: string, bucketName: string): Promise<number> {
    const bucket = storageAdmin().storage.from(bucketName);
    const folder = `avatars/${userFolder(userId)}`;
    const { data, error } = await bucket.list(folder, { limit: 1000 });
    if (error) throw error;
    const paths = (data ?? []).map((object) => `${folder}/${object.name}`);
    if (paths.length === 0) return 0;
    const { error: removeError } = await bucket.remove(paths);
    if (removeError) throw removeError;
    return paths.length;
}

/** The image type a file really is, from its first bytes — never from its name or declared type. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
    const startsWith = (signature: number[], offset = 0) => signature.every((byte, i) => bytes[offset + i] === byte);
    if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
    if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
    if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
    if (startsWith([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
    return null;
}
