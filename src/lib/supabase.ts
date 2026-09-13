import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { RECEIPTS_BUCKET } from '@/lib/receiptUrl';

function getSupabaseConfig() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase is not configured');
    }

    return { supabaseUrl, supabaseKey };
}

export function getSupabaseClient(): SupabaseClient {
    const { supabaseUrl, supabaseKey } = getSupabaseConfig();
    return createClient(supabaseUrl, supabaseKey);
}

/**
 * Uploads a receipt photo and returns its public URL, or null when it couldn't
 * be saved. The server issues a signed upload URL for a new object in the
 * signed-in user's own folder; the photo goes straight to storage with it.
 */
export async function uploadReceipt(file: File): Promise<string | null> {
    try {
        const res = await fetch('/api/receipts/upload-url', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ contentType: file.type, size: file.size }),
        });
        if (!res.ok) {
            console.error('Receipt upload was refused:', res.status);
            return null;
        }
        const { data } = (await res.json()) as { data: { path: string; token: string; publicUrl: string } };

        const { error } = await getSupabaseClient()
            .storage.from(RECEIPTS_BUCKET)
            .uploadToSignedUrl(data.path, data.token, file, { contentType: file.type });
        if (error) {
            console.error('Supabase upload error:', error);
            return null;
        }
        return data.publicUrl;
    } catch (err) {
        console.error('Failed to upload receipt:', err);
        return null;
    }
}
