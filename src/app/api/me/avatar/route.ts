import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

// POST /api/me/avatar — upload profile image
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

        // Create upload directory
        const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'avatars');
        await mkdir(uploadDir, { recursive: true });

        // Generate unique filename
        const ext = file.name.split('.').pop() || 'jpg';
        const filename = `${session.user.email.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.${ext}`;
        const filepath = path.join(uploadDir, filename);

        // Write file
        const buffer = Buffer.from(await file.arrayBuffer());
        await writeFile(filepath, buffer);

        const imageUrl = `/uploads/avatars/${filename}`;

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
