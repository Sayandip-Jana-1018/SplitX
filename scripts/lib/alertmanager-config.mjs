/**
 * Alertmanager's configuration as a cluster runs it: the committed routing tree
 * (monitoring/alertmanager/alertmanager.yaml) with the addresses and the SMTP
 * password from .env filled in.
 *
 * Both clusters get it from here, so both email the same way (D-052):
 *   Kind  `npm run k8s:up` stores it as the Secret monitoring/alertmanager-splitx
 *   EKS   `npm run aws:secrets` stores it in splitx/demo/platform, and the
 *         External Secrets Operator makes the same Secret from it (D-093)
 */

export const ALERT_KEYS = ['ALERT_SMTP_USERNAME', 'ALERT_SMTP_PASSWORD', 'ALERT_EMAIL_TO'];

/**
 * @param {string} template  the committed alertmanager.yaml
 * @param {Record<string, string | undefined>} env
 * @returns {{ config: string, emailed: boolean, unset: string[] }}
 */
export function renderAlertmanagerConfig(template, env) {
    const value = (key) => (env[key] ?? '').trim();
    const unset = ALERT_KEYS.filter((key) => !value(key));
    let config = template;
    if (unset.length) {
        // The email integration is the last block in the file. Without it the
        // receiver still exists, so routing works and alerts show in Grafana.
        const lines = config.slice(0, config.indexOf('\n    email_configs:')).split('\n');
        while (lines.at(-1).trim().startsWith('#')) lines.pop();
        config = lines.join('\n') + '\n';
    } else {
        for (const key of ALERT_KEYS) {
            // Google shows an App Password in groups of four; the spaces are not part of it.
            const filled = key === 'ALERT_SMTP_PASSWORD' ? value(key).replace(/\s+/g, '') : value(key);
            // JSON strings are valid YAML double-quoted scalars, whatever the value holds.
            config = config.split('${' + key + '}').join(JSON.stringify(filled));
        }
    }
    const left = config.match(/\$\{[A-Z_]+\}/);
    if (left) throw new Error('monitoring/alertmanager/alertmanager.yaml has a placeholder nothing fills: ' + left[0]);
    return { config, emailed: unset.length === 0, unset };
}
