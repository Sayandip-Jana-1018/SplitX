import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * The app's network policy opens the internet port by port. SMTP came to the
 * app (D-070) after the policy was written, so on Kind and EKS every address
 * confirmation and password reset waited ten seconds and failed: a password
 * account could never be confirmed there.
 */

const policy = readFileSync('k8s/base/networkpolicy.yaml', 'utf8');
const internetRule = policy.slice(policy.indexOf('cidr: 0.0.0.0/0')).split(/\n {4}- to:|\n---/)[0];
const ports = [...internetRule.matchAll(/- port: (\d+)/g)].map((match) => Number(match[1]));

describe('where the app may connect on the internet', () => {
    it('reaches the mail server on both submission ports, as well as HTTPS and Neon', () => {
        expect(ports).toEqual([443, 5432, 587, 465]);
    });

    it('still never reaches the private ranges', () => {
        expect(internetRule).toContain('- 10.0.0.0/8');
        expect(internetRule).toContain('- 172.16.0.0/12');
        expect(internetRule).toContain('- 192.168.0.0/16');
    });
});
