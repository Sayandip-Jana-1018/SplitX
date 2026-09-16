/**
 * Uploads a receipt photo from the browser and returns its public URL, or null
 * when it couldn't be saved.
 *
 * The server signs a one-time upload URL for a new object in the signed-in
 * user's own folder, and the photo is PUT straight to storage with it. The
 * browser needs no storage client, URL or key of its own, so the same image
 * works on Vercel, in Docker and on Kubernetes without build-time settings.
 */
export async function uploadReceipt(file: File, fetchImpl: typeof fetch = fetch): Promise<string | null> {
    try {
        const signed = await fetchImpl('/api/receipts/upload-url', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ contentType: file.type, size: file.size }),
        });
        if (!signed.ok) {
            console.error('Receipt upload was refused:', signed.status);
            return null;
        }
        const { data } = (await signed.json()) as { data: { uploadUrl: string; publicUrl: string } };

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
        return data.publicUrl;
    } catch (err) {
        console.error('Failed to upload receipt:', err);
        return null;
    }
}
