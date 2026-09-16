#!/usr/bin/env node
/**
 * Moves profile photos that are stored as `data:` text in the database into
 * Supabase Storage, and points each profile at the stored object instead.
 *
 *   npm run avatars:check                  report only
 *   npm run avatars:migrate                make the change
 *   ... -- --https                         reach Neon over port 443 instead of 5432
 *
 * Why this exists (B-018): an avatar kept as a data URL is carried, in full, in
 * every API response that includes that user — group members, expense payers,
 * settlement participants. The one found in production is 847 KB of text.
 *
 * Which database: MIGRATION_DATABASE_URL if set, otherwise DATABASE_URL. The
 * local .env points DATABASE_URL at the Compose Postgres, so cleaning up the
 * deployed site means putting the Neon URL in MIGRATION_DATABASE_URL. The
 * script names the database it reached before it touches anything.
 *
 * --https: some networks (this project's development network among them) block
 * outbound 5432. Neon also accepts SQL over HTTPS; this speaks that protocol
 * with plain fetch — the endpoint is the connection host with its first label
 * replaced by "api", the connection string travels in a header, and parameters
 * are bound server-side exactly as they are over the Postgres protocol.
 *
 * Safety:
 *   • nothing is written without --apply
 *   • the old value is saved to a backup file before any row changes
 *   • the image type comes from the bytes, never from the data URL's own claim
 *   • uploads never overwrite, and the row update only applies if the profile
 *     still holds a data: avatar — otherwise the new upload is removed again
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const apply = process.argv.includes('--apply');
const overHttps = process.argv.includes('--https');
const BUCKET = 'receipts';
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

function fail(message) {
    console.error(message);
    process.exit(1);
}

function sniffImageType(bytes) {
    const startsWith = (signature, offset = 0) => signature.every((byte, i) => bytes[offset + i] === byte);
    if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
    if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
    if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
    if (startsWith([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
    return null;
}

const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) fail('No MIGRATION_DATABASE_URL or DATABASE_URL. Run with --env-file=.env');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) fail('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed.');

async function openDatabase() {
    const host = new URL(connectionString).hostname;
    if (overHttps) {
        const endpoint = 'https://api.' + host.slice(host.indexOf('.') + 1) + '/sql';
        const call = async (query, params) => {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'Neon-Connection-String': connectionString,
                    'Neon-Raw-Text-Output': 'true',
                    'Neon-Array-Mode': 'false',
                },
                body: JSON.stringify({ query, params }),
            });
            const body = await response.json();
            if (!response.ok) throw new Error('Neon refused the query: ' + (body.message ?? 'HTTP ' + response.status));
            return body;
        };
        return {
            label: host + ' (SQL over HTTPS, port 443)',
            query: async (query, params = []) => (await call(query, params)).rows,
            execute: async (query, params = []) => Number((await call(query, params)).rowCount),
            close: async () => {},
        };
    }
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient({ datasources: { db: { url: connectionString } } });
    return {
        label: host + ' (Postgres protocol, port 5432)',
        query: (query, params = []) => prisma.$queryRawUnsafe(query, ...params),
        execute: (query, params = []) => prisma.$executeRawUnsafe(query, ...params),
        close: () => prisma.$disconnect(),
    };
}

const db = await openDatabase();
const bucket = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } }).storage.from(BUCKET);

try {
    const [where] = await db.query('SELECT current_database() AS db');
    console.log('Connected to database "' + where.db + '" on ' + db.label + (apply ? ' — WILL WRITE' : ' — read only'));

    const rows = await db.query('SELECT id, image FROM "User" WHERE image LIKE \'data:%\' ORDER BY id');
    console.log(rows.length + ' profile(s) hold an avatar as data: text' + (apply ? '' : ' (pass --apply to move them)'));
    if (rows.length === 0) process.exit(0);

    if (apply) {
        const backupPath = join(tmpdir(), 'splitx-avatar-backup-' + Date.now() + '.json');
        writeFileSync(backupPath, JSON.stringify(rows.map((row) => ({ id: row.id, image: row.image })), null, 2));
        console.log('Previous values saved to ' + backupPath);
    }

    let moved = 0;
    let skipped = 0;
    for (const row of rows) {
        const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(row.image);
        if (!match || !match[2]) {
            console.log('  skip ' + row.id + ': not a base64 data URL');
            skipped += 1;
            continue;
        }
        const bytes = Buffer.from(match[3], 'base64');
        const actual = sniffImageType(bytes);
        const summary = row.id + ': ' + Math.round(row.image.length / 1024) + ' KB of text, '
            + Math.round(bytes.length / 1024) + ' KB of image, declared ' + match[1] + ', actually ' + (actual ?? 'not an image');

        if (!actual || bytes.length > MAX_AVATAR_BYTES) {
            console.log('  skip ' + summary + (actual ? ' (over the 2 MB avatar limit)' : ''));
            skipped += 1;
            continue;
        }
        if (!apply) {
            console.log('  would move ' + summary);
            moved += 1;
            continue;
        }

        const path = 'avatars/' + row.id + '/' + randomUUID() + '.' + EXTENSIONS[actual];
        const uploaded = await bucket.upload(path, bytes, { contentType: actual, cacheControl: '31536000', upsert: false });
        if (uploaded.error) {
            console.log('  FAILED to upload ' + row.id + ': ' + uploaded.error.message);
            skipped += 1;
            continue;
        }
        const publicUrl = bucket.getPublicUrl(path).data.publicUrl;
        // Only if the profile still holds a data: avatar — someone may have
        // uploaded a new photo since the row was read.
        const changed = await db.execute(
            'UPDATE "User" SET image = $1 WHERE id = $2 AND image LIKE \'data:%\'',
            [publicUrl, row.id]
        );
        if (changed !== 1) {
            await bucket.remove([path]);
            console.log('  skip ' + row.id + ': the profile changed while this ran; upload removed');
            skipped += 1;
            continue;
        }

        // Prove the replacement actually serves the same image before calling it done.
        const served = await fetch(publicUrl);
        const servedBytes = Buffer.from(await served.arrayBuffer());
        const identical = served.ok && servedBytes.equals(bytes);
        console.log('  moved ' + summary);
        console.log('    now ' + publicUrl);
        console.log('    served: HTTP ' + served.status + ', ' + served.headers.get('content-type') + ', ' + servedBytes.length + ' bytes, ' + (identical ? 'byte-identical to the original' : 'DIFFERENT from the original'));
        moved += 1;
    }

    console.log((apply ? 'Moved ' : 'Would move ') + moved + ', skipped ' + skipped + '.');
    if (apply) {
        const [left] = await db.query('SELECT count(*)::int AS n FROM "User" WHERE image LIKE \'data:%\'');
        console.log(left.n + ' profile(s) still hold a data: avatar.');
    }
} finally {
    await db.close();
}
