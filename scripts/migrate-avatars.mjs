#!/usr/bin/env node
/**
 * Moves profile photos that are stored as `data:` text in the database into
 * Supabase Storage, and points the profile at the stored object instead.
 *
 *   npm run avatars:check     report only
 *   npm run avatars:migrate   make the change
 *
 * Which database it touches: MIGRATION_DATABASE_URL if it is set, otherwise
 * DATABASE_URL. The local .env points DATABASE_URL at the Compose Postgres, so
 * to clean up the deployed site's profiles put the Neon URL in
 * MIGRATION_DATABASE_URL — the script prints the database it is connected to
 * before it touches anything, and reports only unless given --apply.
 *
 * Why this exists (B-018): an avatar kept as a data URL is carried, in full, in
 * every API response that includes that user — group members, expense payers,
 * settlement participants. A 200 KB photo becomes 200 KB on every page that
 * mentions them, for everyone in the group, forever.
 *
 * Safety:
 *   • nothing is written without --apply
 *   • the old value is saved to a backup file before any row is updated
 *   • the image type is taken from the bytes, not from the data URL's own
 *     claim, and anything that is not a real JPEG, PNG, WebP or GIF is skipped
 *   • uploads never overwrite: each object gets a fresh random name
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

const apply = process.argv.includes('--apply');
const BUCKET = 'receipts';
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

function sniffImageType(bytes) {
    const startsWith = (signature, offset = 0) => signature.every((byte, i) => bytes[offset + i] === byte);
    if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
    if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
    if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
    if (startsWith([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
    return null;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
    console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed. Run with --env-file=.env');
    process.exit(1);
}

const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
    console.error('No MIGRATION_DATABASE_URL or DATABASE_URL. Run with --env-file=.env');
    process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url: connectionString } } });

// Say out loud which database this is before touching it: the difference
// between the Compose Postgres and Neon is one environment variable.
const [where] = await prisma.$queryRaw`SELECT current_database() AS db, inet_server_addr()::text AS addr`;
const host = (() => {
    // No regex: the host is between the credentials and the database name.
    const at = connectionString.indexOf('@');
    if (at < 0) return 'unknown';
    const rest = connectionString.slice(at + 1);
    const end = rest.search(/[:/?]/);
    return end < 0 ? rest : rest.slice(0, end);
})();
console.log('Connected to database "' + where.db + '" on ' + host + (apply ? '  — WILL WRITE' : '  — read only'));

const bucket = createClient(url, key, { auth: { persistSession: false } }).storage.from(BUCKET);

const rows = await prisma.$queryRaw`
    SELECT id, email, image FROM "User" WHERE image LIKE 'data:%' ORDER BY id
`;

console.log(rows.length + ' profile(s) hold an avatar as data: text' + (apply ? '' : '  (reporting only — pass --apply to change them)'));
if (rows.length === 0) {
    await prisma.$disconnect();
    process.exit(0);
}

const backupPath = join(tmpdir(), 'splitx-avatar-backup-' + Date.now() + '.json');
writeFileSync(backupPath, JSON.stringify(rows.map((r) => ({ id: r.id, image: r.image })), null, 2));
console.log('Previous values saved to ' + backupPath);

let moved = 0;
let skipped = 0;

for (const row of rows) {
    const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(row.image);
    if (!match || !match[2]) {
        console.log('  skip ' + row.id + ': not a base64 data URL');
        skipped += 1;
        continue;
    }
    const declared = match[1];
    const bytes = Buffer.from(match[3], 'base64');
    const actual = sniffImageType(bytes);
    const summary = row.id + '  ' + (row.image.length / 1024).toFixed(0) + ' KB of text, '
        + (bytes.length / 1024).toFixed(0) + ' KB decoded, declared ' + declared + ', actually ' + (actual ?? 'not an image');

    if (!actual) {
        console.log('  skip ' + summary);
        skipped += 1;
        continue;
    }
    if (bytes.length > MAX_AVATAR_BYTES) {
        console.log('  skip ' + summary + ' — over the 2 MB avatar limit');
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
        console.log('  FAILED ' + row.id + ': ' + uploaded.error.message);
        skipped += 1;
        continue;
    }
    const publicUrl = bucket.getPublicUrl(path).data.publicUrl;
    await prisma.user.update({ where: { id: row.id }, data: { image: publicUrl } });
    console.log('  moved ' + summary);
    console.log('        -> ' + publicUrl);
    moved += 1;
}

console.log((apply ? 'Moved ' : 'Would move ') + moved + ', skipped ' + skipped + '.');
if (apply && moved > 0) {
    const left = await prisma.$queryRaw`SELECT count(*)::int AS n FROM "User" WHERE image LIKE 'data:%'`;
    console.log(left[0].n + ' profile(s) still hold a data: avatar.');
}
await prisma.$disconnect();
