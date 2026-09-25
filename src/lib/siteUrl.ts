/**
 * The site's public address, for links people are sent (emails, invites):
 * NEXTAUTH_URL or AUTH_URL when set; on Vercel, the production domain Vercel
 * sets on every deployment (next-auth itself runs there without either); else
 * the address the request came in on. Never localhost by default: a link to
 * localhost reaches nobody. Null only with none of those.
 */
export function siteUrl(request?: Request): string | null {
    const vercelDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const url = process.env.NEXTAUTH_URL
        || process.env.AUTH_URL
        || (vercelDomain ? `https://${vercelDomain}` : '')
        || (request ? new URL(request.url).origin : '');
    // (?<!\/): the match starts at a run's first slash only, so no run is scanned twice.
    return url ? url.replace(/(?<!\/)\/+$/, '') : null;
}
