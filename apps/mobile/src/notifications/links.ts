/**
 * Where a tapped notification opens. The server's notifications carry the website's links
 * (/groups/…, /settlements); this is the app's screen for each. Anything else, or nothing, opens Home.
 * Pure, so the website's tests check it (tests/unit/mobilePushLinks.test.ts).
 */
export function screenFor(link: unknown): string {
    if (typeof link !== 'string') return '/home';
    const group = /^\/groups\/([A-Za-z0-9_-]{1,64})(?:[/?#].*)?$/.exec(link);
    if (group) return `/group/${group[1]}`;
    if (link.startsWith('/settlements')) return '/settle';
    if (link === '/groups' || link.startsWith('/groups?')) return '/groups';
    return '/home';
}
