/**
 * The restore drill's verdict (.github/workflows/restore-drill.yml): production's
 * fingerprint before and after the dump, against the restored copy's
 * (scripts/restore-drill.sql). Kept free of I/O so the unit tests hold the rules.
 *
 * The repository is public, and so are its Actions logs: the verdict names
 * tables and says same or different, and never prints a hash, a count of rows
 * or anything else read from the data. The one number it prints is how many
 * groups don't net to zero, which must be 0.
 */

/** "kind|key|value" and "kind|value" lines into a map of key to value. */
export function parseFingerprint(text) {
    const entries = new Map();
    for (const line of text.split(/\r?\n/)) {
        const parts = line.trim().split('|');
        if (parts.length === 3) entries.set(parts[0] + ' ' + parts[1], parts[2]);
        else if (parts.length === 2) entries.set(parts[0], parts[1]);
    }
    return entries;
}

/**
 * @returns {{ ok: boolean, verdict: 'restored' | 'moved' | 'different' | 'empty' | 'unbalanced', lines: string[] }}
 *   moved: production changed while the drill ran, so nothing can be judged; run it again.
 */
export function judgeDrill(beforeText, afterText, restoredText) {
    const before = parseFingerprint(beforeText);
    const after = parseFingerprint(afterText);
    const restored = parseFingerprint(restoredText);
    const tables = [...before.keys()].filter((key) => key.startsWith('table ')).map((key) => key.slice('table '.length));

    if (tables.length === 0 || !before.has('balances')) {
        return { ok: false, verdict: 'empty', lines: ['Production\'s fingerprint is empty: the drill read nothing.'] };
    }
    const sameBeforeAfter = before.size === after.size && [...before].every(([key, value]) => after.get(key) === value);
    if (!sameBeforeAfter) {
        return { ok: false, verdict: 'moved', lines: ['Production changed while the drill ran (someone saved something). Nothing is wrong: run it again at a quiet time.'] };
    }

    const lines = [];
    let different = 0;
    for (const table of tables) {
        const same = restored.get('table ' + table) === before.get('table ' + table);
        if (!same) different += 1;
        lines.push((same ? 'same       ' : 'DIFFERENT  ') + table);
    }
    for (const key of restored.keys()) {
        if (key.startsWith('table ') && !before.has(key)) {
            different += 1;
            lines.push('DIFFERENT  ' + key.slice('table '.length) + ' (only in the copy)');
        }
    }
    const balancesSame = restored.get('balances') === before.get('balances');
    if (!balancesSame) different += 1;
    lines.push((balancesSame ? 'same       ' : 'DIFFERENT  ') + 'every member\'s balance in every group');

    const unbalanced = Number(restored.get('unbalanced-groups'));
    lines.push('groups that don\'t net to zero in the copy: ' + (Number.isFinite(unbalanced) ? unbalanced : 'unknown'));

    if (different > 0) return { ok: false, verdict: 'different', lines };
    if (unbalanced !== 0) return { ok: false, verdict: 'unbalanced', lines };
    return { ok: true, verdict: 'restored', lines };
}

const HEADLINES = {
    restored: 'Restored whole: every table and every balance is the same as production.',
    moved: 'Not judged: production changed during the drill. Run it again.',
    different: 'The restored copy differs from production.',
    empty: 'The drill read nothing from production.',
    unbalanced: 'The copy has groups that don\'t net to zero.',
};

/** The job summary, as Markdown. */
export function drillSummary(result, at) {
    return ['### Restore drill, ' + at, '', '**' + HEADLINES[result.verdict] + '**', '', '```', ...result.lines, '```', ''].join('\n');
}
