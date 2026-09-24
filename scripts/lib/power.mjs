/**
 * Is this machine on mains power?
 *
 * A laptop on battery throttles its CPU, and a load test then measures the power
 * plan instead of the application. On this project's laptop, 30 plans a second on
 * battery drove the autoscaler to ten pods at 219% of their CPU request, where
 * three pods had carried the same step on the charger (D-049).
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ source: 'ac' | 'battery' | 'unknown', detail: string }}
 */
export function powerSource(env = process.env) {
    // A GitHub-hosted runner is a virtual machine in a data centre: it has no
    // battery and no power plan to throttle it (kind-e2e.yml, D-099). A
    // self-hosted runner could be a laptop, so only GitHub's own count.
    if (env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted') {
        return { source: 'ac', detail: 'a GitHub-hosted runner, a data-centre VM with no battery' };
    }
    try {
        if (process.platform === 'win32') return windows();
        if (process.platform === 'darwin') return mac();
        if (process.platform === 'linux') return linux();
    } catch (error) {
        return { source: 'unknown', detail: String(error) };
    }
    return { source: 'unknown', detail: 'not checked on ' + process.platform };
}

function windows() {
    // PowerOnline is what Windows itself uses for "plugged in". A machine with no
    // battery has no instance, and is on mains power by definition.
    const probe = spawnSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        '$s = Get-CimInstance -Namespace root/wmi -ClassName BatteryStatus -ErrorAction SilentlyContinue | Select-Object -First 1; '
            + 'if ($s) { "online=" + $s.PowerOnline + " charge=" + (Get-CimInstance Win32_Battery | Select-Object -First 1).EstimatedChargeRemaining } else { "online=none" }',
    ], { encoding: 'utf8', timeout: 20_000 });
    const out = (probe.stdout ?? '').trim();
    if (/online=none/.test(out)) return { source: 'ac', detail: 'no battery' };
    if (/online=True/i.test(out)) return { source: 'ac', detail: 'charger connected, ' + chargeOf(out) };
    if (/online=False/i.test(out)) return { source: 'battery', detail: 'on battery, ' + chargeOf(out) };
    return { source: 'unknown', detail: out || (probe.stderr ?? '').trim() || 'no answer from PowerShell' };
}

const chargeOf = (out) => (/charge=(\d+)/.exec(out)?.[1] ?? '?') + '% charged';

function mac() {
    const out = spawnSync('pmset', ['-g', 'batt'], { encoding: 'utf8' }).stdout ?? '';
    if (/'AC Power'/.test(out)) return { source: 'ac', detail: 'AC Power' };
    if (/'Battery Power'/.test(out)) return { source: 'battery', detail: 'Battery Power' };
    return { source: 'unknown', detail: out.trim() };
}

function linux() {
    const base = '/sys/class/power_supply';
    const mains = readdirSync(base).filter((name) => readFileSync(join(base, name, 'type'), 'utf8').trim() === 'Mains');
    if (!mains.length) return { source: 'unknown', detail: 'no mains adapter reported' };
    const online = mains.some((name) => readFileSync(join(base, name, 'online'), 'utf8').trim() === '1');
    return online ? { source: 'ac', detail: mains.join(', ') + ' online' } : { source: 'battery', detail: mains.join(', ') + ' offline' };
}
