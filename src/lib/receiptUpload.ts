/**
 * Uploads a receipt photo from the browser and returns what its expense should
 * record, or null when it couldn't be saved.
 *
 * The server signs a one-time upload URL for a new object in the signed-in
 * user's own folder, in the private bucket, and the photo is PUT straight to
 * storage with it. The browser needs no storage client, URL or key of its own,
 * so the same image works on Vercel, in Docker and on Kubernetes without
 * build-time settings. The returned reference opens nothing by itself: the
 * server turns it into a short-lived signed link for people who may see it.
 */

/** A receipt stays legible at this size, at a fraction of a phone photo's bytes. */
const MAX_SIDE = 2048;

/**
 * The photo as it is stored: at most 2,048 pixels on its long side, as a JPEG.
 * The original goes up when it is already smaller, or when the browser can't
 * redraw it (then the server's size limit still applies).
 */
async function shrinkForUpload(file: File): Promise<File> {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
    try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        const context = canvas.getContext('2d');
        if (!context) return file;
        // JPEG has no transparency: a see-through screenshot would otherwise turn black.
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
        if (!blob || blob.size >= file.size) return file;
        return new File([blob], 'receipt.jpg', { type: 'image/jpeg' });
    } catch {
        return file;
    }
}

export async function uploadReceipt(original: File, fetchImpl: typeof fetch = fetch): Promise<string | null> {
    try {
        const file = await shrinkForUpload(original);
        const signed = await fetchImpl('/api/receipts/upload-url', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ contentType: file.type, size: file.size }),
        });
        if (!signed.ok) {
            console.error('Receipt upload was refused:', signed.status);
            return null;
        }
        const { data } = (await signed.json()) as { data: { uploadUrl: string; receiptUrl: string } };

        const upload = await fetchImpl(data.uploadUrl, {
            method: 'PUT',
            headers: {
                'content-type': file.type,
                // Every upload gets a new random name, so the object never changes.
                'cache-control': 'max-age=31536000',
                'x-upsert': 'false',
            },
            body: file,
        });
        if (!upload.ok) {
            console.error('Receipt upload failed:', upload.status);
            return null;
        }
        return data.receiptUrl;
    } catch (err) {
        console.error('Failed to upload receipt:', err);
        return null;
    }
}
