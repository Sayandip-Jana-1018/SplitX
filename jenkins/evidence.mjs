/**
 * Stores one file of a deployment's evidence in Nexus (D-096), for the
 * Archive step of jenkins/deploy.mjs; on its own so the unit tests can run it.
 *
 * The repository never overwrites (write policy "allow once"), so a second
 * attempt for the same deployment, a rebuild, finds its evidence already
 * there and is refused: Nexus 3.96.3 answers 409 (Jenkins build 3 on AWS,
 * 10 October 2026), where this step was written expecting 400. Either way, a
 * file that is there already counts as stored.
 */
export async function storeOnce(url, authorization, body) {
    const res = await fetch(url, { method: 'PUT', headers: { authorization, 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(60_000) });
    if (res.status === 400 || res.status === 409) {
        const existing = await fetch(url, { method: 'HEAD', headers: { authorization }, signal: AbortSignal.timeout(30_000) });
        if (existing.ok) return 'already stored';
    }
    // The file's name is enough: the reason goes into the GitHub status, which is short.
    if (!res.ok) throw new Error('Nexus answered ' + res.status + ' to storing ' + url.split('/').pop());
    return 'stored';
}
