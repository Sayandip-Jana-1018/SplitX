import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { demoSecrets } from '../../../scripts/lib/demo-secrets.mjs';
import { admittedPrefixList, committedEdge, releaseImage, storeRegion } from '../../../scripts/lib/eks-facts.mjs';
import { chartsFor, helmInstallArgs, reposOf } from '../../../scripts/lib/platform-charts.mjs';

/*
 * The EKS platform (D-093) is spread over files that must agree with each
 * other and with terraform/platform: nothing but a real AWS day would show
 * a mismatch otherwise, and an AWS day costs money.
 */

const read = (path: string) => readFileSync(path, 'utf8');
const chartsFile = JSON.parse(read('helm/platform/charts.json'));
const releases = (target: 'kind' | 'eks') => chartsFor(chartsFile, target).map((chart) => chart.release);

describe('the charts each cluster installs', () => {
    it('leaves the Kind cluster exactly as it was', () => {
        expect(releases('kind')).toEqual(['kube-prometheus-stack', 'ingress-nginx', 'metrics-server', 'loki', 'alloy', 'kyverno', 'jenkins']);
    });

    it('installs on EKS the Secrets\' operator first, then Prometheus\' CRDs, and Jenkins last', () => {
        expect(releases('eks')).toEqual([
            'external-secrets', 'kube-prometheus-stack', 'aws-load-balancer-controller', 'cluster-autoscaler', 'loki', 'alloy', 'kyverno', 'jenkins',
        ]);
        expect(chartsFor(chartsFile, 'eks').filter((chart) => chart.stage === 'secrets').map((chart) => chart.release))
            .toEqual(['external-secrets']);
    });

    it('never puts Kind\'s ingress-nginx, or its insecure metrics-server, on EKS', () => {
        expect(releases('eks')).not.toContain('ingress-nginx');
        expect(releases('eks')).not.toContain('metrics-server');
    });

    it('has every values file it names, and pins every chart', () => {
        for (const chart of chartsFile.charts) {
            expect(chart.version).toMatch(/^\d+\.\d+\.\d+$/);
            for (const target of chart.targets) expect(['kind', 'eks']).toContain(target);
            expect(() => read(chart.values)).not.toThrow();
            if (chart.eksValues) expect(() => read(chart.eksValues)).not.toThrow();
        }
    });

    it('reads only outputs terraform/platform has', () => {
        const outputs = read('terraform/platform/outputs.tf');
        for (const chart of chartsFile.charts) {
            for (const output of Object.values(chart.set ?? {})) expect(outputs).toContain(`output "${output}"`);
        }
    });

    it('builds the helm command per cluster, with the day\'s values from Terraform', () => {
        const [jenkins] = chartsFile.charts.filter((chart: { release: string }) => chart.release === 'jenkins');
        expect(helmInstallArgs(jenkins, 'kind')).not.toContain('helm/platform/eks/jenkins.values.yaml');
        expect(helmInstallArgs(jenkins, 'eks')).toEqual(expect.arrayContaining(['helm/platform/jenkins.values.yaml', 'helm/platform/eks/jenkins.values.yaml']));

        const [controller] = chartsFile.charts.filter((chart: { release: string }) => chart.release === 'aws-load-balancer-controller');
        const outputs = { cluster_name: 'splitx', region: 'ap-south-1', vpc_id: 'vpc-0123' };
        expect(helmInstallArgs(controller, 'eks', outputs)).toEqual(expect.arrayContaining(['--set-string', 'vpcId=vpc-0123']));
        expect(() => helmInstallArgs(controller, 'eks', { ...outputs, vpc_id: '' })).toThrow(/vpc_id/);
    });

    it('has both Jenkins gather their build metrics every 30 s, since EKS replaces the whole environment list (D-100)', () => {
        const every30s = /- name: COLLECTING_METRICS_PERIOD_IN_SECONDS\n\s+value: "30"/;
        for (const file of ['helm/platform/jenkins.values.yaml', 'helm/platform/eks/jenkins.values.yaml']) {
            expect(read(file).replace(/\r\n/g, '\n')).toMatch(every30s);
        }
        expect(read('helm/platform/jenkins.values.yaml')).toMatch(/prometheus:\s+enabled: true\s+scrapeInterval: 30s/);
    });

    it('adds each helm repository once', () => {
        const names = reposOf(chartsFor(chartsFile, 'eks')).map(([name]: [string, string]) => name);
        expect(names).toEqual([...new Set(names)]);
        expect(names).toContain('grafana');
    });
});

describe('the Secrets on EKS match the ones Kind builds', () => {
    const externalSecrets = read('k8s/eks/secrets/externalsecrets.yaml');
    const platform = demoSecrets(
        Object.fromEntries(['DEMO_DATABASE_URL', 'NEXTAUTH_SECRET', 'METRICS_TOKEN', 'REDIS_PASSWORD', 'ORIGIN_VERIFY_SECRET', 'GF_ADMIN_PASSWORD',
            'JENKINS_ADMIN_PASSWORD', 'GITHUB_WEBHOOK_SECRET', 'JENKINS_TRIGGER_TOKEN', 'NEXUS_ADMIN_PASSWORD', 'NEXUS_JENKINS_PASSWORD', 'NEXUS_OPS_PASSWORD'].map((key) => [key, key === 'DEMO_DATABASE_URL' ? 'postgresql://demo@demo.example/splitx' : 'value'])),
        { alertmanagerTemplate: read('monitoring/alertmanager/alertmanager.yaml') },
    ).platform!;

    it('reads only properties aws:secrets always writes', () => {
        const properties = [...externalSecrets.matchAll(/property: (\S+)/g)].map((match) => match[1]);
        expect(properties.length).toBeGreaterThan(0);
        for (const property of properties) expect(Object.keys(platform)).toContain(property);
        expect(externalSecrets).toContain('key: splitx/demo/app');
    });

    it('makes the Secrets, and the keys, the charts and the app read on Kind', () => {
        const kind = read('scripts/cluster-up.mjs');
        for (const [name, keys] of [
            ['splitx-secrets', []],
            ['grafana-admin', ['admin-user', 'admin-password']],
            ['alertmanager-splitx', ['alertmanager.yaml']],
            ['jenkins-admin', ['jenkins-admin-user', 'jenkins-admin-password']],
            ['jenkins-secrets', ['webhook-secret', 'trigger-token', 'github-token', 'nexus-password']],
            ['nexus-admin', ['password', 'jenkins-password', 'ops-password']],
            ['ops-api', ['nexus-password']],
        ] as const) {
            expect(externalSecrets).toContain(`    name: ${name}\n`);
            expect(kind).toContain(`'${name}'`);
            for (const key of keys) {
                expect(externalSecrets).toMatch(new RegExp(`(secretKey: ${key.replace('.', '\\.')}\\n|\\n {8}${key}: )`));
                expect(kind).toContain(`'${key}'`);
            }
        }
    });

    it('reads Secrets Manager in the platform\'s region', () => {
        expect(storeRegion(read('k8s/eks/secrets/clustersecretstore.yaml'))).toBe(read('terraform/platform/variables.tf').match(/variable "region"[\s\S]*?default\s*=\s*"([a-z0-9-]+)"/)![1]);
    });
});

describe('the addresses the manifests name are the network Terraform builds', () => {
    const network = read('terraform/platform/network.tf');
    const publicSubnets = JSON.parse(network.match(/public_subnets\s*=\s*(\[[^\]]*\])/)![1]);

    it('admits the load balancer from exactly the public subnets', () => {
        for (const file of ['k8s/overlays/aws/patches/networkpolicy.yaml', 'jenkins/eks/networkpolicy.yaml']) {
            const cidrs = [...read(file).matchAll(/cidr: (10\.\d+\.\d+\.\d+\/\d+)/g)].map((match) => match[1]);
            expect(cidrs.filter((cidr) => cidr !== '10.0.0.0/8')).toEqual(publicSubnets);
        }
    });

    it('names the API server by the first address of the pinned service range', () => {
        const serviceCidr = read('terraform/platform/main.tf').match(/service_cidr\s*=\s*"([\d.]+)\/16"/)![1];
        const first = serviceCidr.replace(/\.0$/, '.1');
        expect(read('jenkins/eks/networkpolicy.yaml').match(/cidr: 172\.[\d.]+\/32/g)).toEqual([`cidr: ${first}/32`, `cidr: ${first}/32`]);
    });

    it('binds each chart\'s service account to the Pod Identity role Terraform made for it', () => {
        const workloads = read('terraform/platform/workloads.tf');
        for (const [values, namespace, account] of [
            ['helm/platform/eks/external-secrets.values.yaml', 'external-secrets', 'external-secrets'],
            ['helm/platform/eks/aws-load-balancer-controller.values.yaml', 'kube-system', 'aws-load-balancer-controller'],
            ['helm/platform/eks/cluster-autoscaler.values.yaml', 'kube-system', 'cluster-autoscaler'],
        ]) {
            expect(read(values)).toMatch(new RegExp(`\\n\\s+name: ${account}\\n`));
            expect(workloads).toMatch(new RegExp(`namespace\\s*=\\s*"${namespace}"\\s*\\n\\s*service_account\\s*=\\s*"${account}"`));
            expect(chartsFile.charts.find((chart: { values: string }) => chart.values === values).namespace).toBe(namespace);
        }
    });
});

describe('the load balancer', () => {
    const order = (file: string) => Number(read(file).match(/group\.order: "(\d+)"/)![1]);

    it('refuses the internal paths before Jenkins\' path, and both before the app\'s "/"', () => {
        expect(order('k8s/overlays/aws/patches/ingress-internal.yaml')).toBeLessThan(order('jenkins/eks/ingress.yaml'));
        expect(order('jenkins/eks/ingress.yaml')).toBeLessThan(order('k8s/overlays/aws/patches/ingress.yaml'));
    });

    it('admits CloudFront\'s prefix list, over plain HTTP only', () => {
        const ingress = read('k8s/overlays/aws/patches/ingress.yaml');
        expect(admittedPrefixList(ingress)).toMatch(/^pl-[0-9a-f]+$/);
        expect(ingress).toContain(`listen-ports: '[{"HTTP": 80}]'`);
        expect(ingress).not.toMatch(/certificate-arn|ssl-redirect/);
    });

    it('keeps the group name terraform/platform finds it by', () => {
        expect(read('terraform/platform/alarms.tf')).toContain('"ingress.k8s.aws/stack" = "splitx"');
        for (const file of ['k8s/overlays/aws/patches/ingress.yaml', 'k8s/overlays/aws/patches/ingress-internal.yaml', 'jenkins/eks/ingress.yaml']) {
            expect(read(file)).toContain('alb.ingress.kubernetes.io/group.name: splitx');
        }
    });
});

describe('the edge\'s address, committed once', () => {
    it('is still the placeholder until terraform/edge exists, and then a bare https origin', () => {
        expect(committedEdge('      - NEXTAUTH_URL=https://REPLACE_WITH_PUBLIC_HOSTNAME\n')).toBeNull();
        expect(committedEdge('      - NEXTAUTH_URL=https://d111111abcdef8.cloudfront.net\n'))
            .toEqual({ url: 'https://d111111abcdef8.cloudfront.net', host: 'd111111abcdef8.cloudfront.net' });
        expect(() => committedEdge('      - NEXTAUTH_URL=http://d111111abcdef8.cloudfront.net\n')).toThrow(/https/);
        expect(() => committedEdge('      - NEXTAUTH_URL=https://d111111abcdef8.cloudfront.net/app\n')).toThrow(/https/);
        expect(() => committedEdge('literals: []\n')).toThrow(/NEXTAUTH_URL/);
    });

    it('is read from the overlay as committed', () => {
        expect(() => committedEdge(read('k8s/overlays/aws/kustomization.yaml'))).not.toThrow();
    });

    it('runs only our signed registry\'s images, by digest', () => {
        const digest = 'sha256:' + 'a'.repeat(64);
        expect(releaseImage(`ghcr.io/sayandip-jana-1018/splitx@${digest}`)).toEqual({ name: 'ghcr.io/sayandip-jana-1018/splitx', digest });
        expect(() => releaseImage('ghcr.io/sayandip-jana-1018/splitx:latest')).toThrow();
        expect(() => releaseImage(`docker.io/someone/splitx@${digest}`)).toThrow();
    });
});
