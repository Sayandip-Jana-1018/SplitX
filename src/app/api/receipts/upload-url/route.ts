import { z } from 'zod';
import { apiError, apiSuccess, ErrorMessages } from '@/lib/apiResponse';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { RECEIPTS_BUCKET } from '@/lib/receiptUrl';
import { MAX_RECEIPT_BYTES, RECEIPT_TYPES, receiptObjectPath, storageAdmin, StorageUnavailableError } from '@/lib/storage';

/**
 * POST /api/receipts/upload-url — a one-time signed URL for uploading one receipt photo.
 *
 * Body: { "contentType": "image/jpeg", "size": 834122 }
 *
 * The server chooses the object path (the caller's own folder, a random name)
 * and signs it with the service role key; the browser then uploads the photo
 * straight to Supabase Storage with the returned token. Photos never pass
 * through the app's pods, the public anon key needs no write access, and the
 * token cannot overwrite an existing object. Signed upload URLs expire after
 * two hours. The bucket's own type and size limits are the final check on
 * what is actually uploaded.
 */

const UploadRequest = z.strictObject({
    contentType: z.enum(RECEIPT_TYPES),
    size: z.int().positive().max(MAX_RECEIPT_BYTES),
});

const UNAVAILABLE = 'Receipt uploads are unavailable right now';

export async function POST(request: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) return apiError(ErrorMessages.UNAUTHORIZED, 401);

        const parsed = UploadRequest.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
            return apiError(`Receipts must be JPEG, PNG or WebP images up to ${MAX_RECEIPT_BYTES / (1024 * 1024)} MB`, 400);
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
        if (!user) return apiError(ErrorMessages.USER_NOT_FOUND, 404);

        const bucket = storageAdmin().storage.from(RECEIPTS_BUCKET);
        const { data, error } = await bucket.createSignedUploadUrl(receiptObjectPath(user.id, parsed.data.contentType));
        if (error) {
            logger.error('Could not sign a receipt upload', { err: error });
            return apiError(UNAVAILABLE, 502, 'STORAGE_ERROR');
        }

        return apiSuccess({
            path: data.path,
            token: data.token,
            publicUrl: bucket.getPublicUrl(data.path).data.publicUrl,
        });
    } catch (error) {
        if (error instanceof StorageUnavailableError) {
            logger.error('Receipt upload requested but storage is not configured', { err: error });
            return apiError(UNAVAILABLE, 503, 'STORAGE_UNAVAILABLE');
        }
        logger.error('Receipt upload URL failed', { err: error });
        return apiError(ErrorMessages.SERVER_ERROR, 500);
    }
}
