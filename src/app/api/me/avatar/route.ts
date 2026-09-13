import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { RECEIPTS_BUCKET } from '@/lib/receiptUrl';
import { avatarObjectPath, MAX_AVATAR_BYTES, sniffImageType, storageAdmin, StorageUnavailableError } from '@/lib/storage';

/** Multipart framing on top of the largest allowed photo. */
const MAX_REQUEST_BYTES = MAX_AVATAR_BYTES + 64 * 1024;

// POST /api/me/avatar — upload a profile photo to Supabase Storage.
// The photo is stored under the user's own folder with a random name; the
// type comes from the file's bytes. If storage is unavailable the upload
// fails visibly rather than keeping the image somewhere else.
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (Number(req.headers.get('content-length')) > MAX_REQUEST_BYTES) {
            return NextResponse.json({ error: 'File too large. Max 2MB.' }, { status: 413 });
        }

        const formData = await req.formData();
        const file = formData.get('file');
        if (!(file instanceof File)) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }
        if (file.size > MAX_AVATAR_BYTES) {
            return NextResponse.json({ error: 'File too large. Max 2MB.' }, { status: 400 });
        }

        const bytes = new Uint8Array(await file.arrayBuffer());
        const contentType = sniffImageType(bytes);
        if (!contentType) {
            return NextResponse.json({ error: 'Invalid file type. Use JPEG, PNG, WebP, or GIF.' }, { status: 400 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const bucket = storageAdmin().storage.from(RECEIPTS_BUCKET);
        const path = avatarObjectPath(user.id, contentType);
        const { error: uploadError } = await bucket.upload(path, bytes, {
            contentType,
            // Every upload gets a new name, so the object never changes.
            cacheControl: '31536000',
            upsert: false,
        });
        if (uploadError) {
            logger.error('Avatar upload failed', { err: uploadError });
            return NextResponse.json({ error: 'Could not save your photo. Please try again.' }, { status: 502 });
        }

        const image = bucket.getPublicUrl(path).data.publicUrl;
        await prisma.user.update({ where: { id: user.id }, data: { image } });

        return NextResponse.json({ image });
    } catch (error) {
        if (error instanceof StorageUnavailableError) {
            logger.error('Avatar upload requested but storage is not configured', { err: error });
            return NextResponse.json({ error: 'Photo uploads are unavailable right now' }, { status: 503 });
        }
        logger.error('Avatar upload error', { err: error });
        return NextResponse.json({ error: 'Failed to upload avatar' }, { status: 500 });
    }
}
