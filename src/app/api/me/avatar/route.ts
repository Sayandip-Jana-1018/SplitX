import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL
    ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    })
    : null;

const AVATAR_BUCKETS = ['avatars', 'receipts'] as const;

// POST /api/me/avatar — upload profile image to Supabase Storage
export async function POST(req: Request) {
    try {
        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const formData = await req.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        // Validate file type
        const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!validTypes.includes(file.type)) {
            return NextResponse.json({ error: 'Invalid file type. Use JPEG, PNG, WebP, or GIF.' }, { status: 400 });
        }

        // Validate file size (max 2MB)
        if (file.size > 2 * 1024 * 1024) {
            return NextResponse.json({ error: 'File too large. Max 2MB.' }, { status: 400 });
        }

        // Generate unique filename
        const ext = file.name.split('.').pop() || 'jpg';
        const sanitized = session.user.email.replace(/[^a-z0-9]/gi, '_');
        const filename = `avatars/${sanitized}_${Date.now()}.${ext}`;

        // Upload to Supabase Storage (receipts bucket — we reuse it for avatars too)
        const buffer = Buffer.from(await file.arrayBuffer());
        const storageClient = supabaseAdmin || supabase;
        let imageUrl: string | null = null;

        for (const bucket of AVATAR_BUCKETS) {
            const { error: uploadError } = await storageClient.storage
                .from(bucket)
                .upload(filename, buffer, {
                    contentType: file.type,
                    upsert: true,
                });

            if (!uploadError) {
                const { data: urlData } = storageClient.storage.from(bucket).getPublicUrl(filename);
                imageUrl = urlData.publicUrl;
                break;
            }

            console.warn(`Supabase avatar upload failed for bucket "${bucket}":`, uploadError);
        }

        if (!imageUrl) {
            imageUrl = `data:${file.type};base64,${buffer.toString('base64')}`;
        }

        // Update user record
        await prisma.user.update({
            where: { email: session.user.email },
            data: { image: imageUrl },
        });

        return NextResponse.json({ image: imageUrl });
    } catch (error) {
        console.error('Avatar upload error:', error);
        return NextResponse.json({ error: 'Failed to upload avatar' }, { status: 500 });
    }
}
