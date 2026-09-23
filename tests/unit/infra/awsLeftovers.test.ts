import { describe, expect, it } from 'vitest';
import {
    isClusterVolume,
    isPlatformIamName,
    isStrayInterface,
    leftovers,
    tagMap,
} from '../../../scripts/lib/aws-leftovers.mjs';

/**
 * aws-down's sweep deletes what these select, unattended, so the test that
 * matters most is the negative one: nothing that isn't the platform's is ever
 * selected, however it is named or tagged.
 */
const CLUSTER = 'splitx';
const platform = [{ Key: 'project', Value: 'splitx' }, { Key: 'stack', Value: 'platform' }];

const empty = {
    clusters: [], instances: [], loadBalancers: [], targetGroups: [], natGateways: [], addresses: [], vpcs: [],
    volumes: [], networkInterfaces: [], securityGroups: [], logGroups: [], alarms: [], secrets: [], roles: [], policies: [],
};
const count = (rows: { items: string[] }[]) => rows.reduce((sum, row) => sum + row.items.length, 0);
const row = (rows: { kind: string; items: string[] }[], kind: string) => rows.find((r) => r.kind === kind)?.items;

describe('tags', () => {
    it('reads both of AWS\'s tag shapes, and none', () => {
        expect(tagMap([{ Key: 'a', Value: '1' }, { key: 'b', value: '2' }])).toEqual({ a: '1', b: '2' });
        expect(tagMap(undefined)).toEqual({});
    });
});

describe('what counts as the platform\'s', () => {
    it('counts a PVC volume by the CSI driver\'s tag plus this cluster\'s', () => {
        expect(isClusterVolume({ 'ebs.csi.aws.com/cluster': 'true', project: 'splitx', stack: 'platform' }, CLUSTER)).toBe(true);
        expect(isClusterVolume({ 'ebs.csi.aws.com/cluster': 'true', KubernetesCluster: 'splitx' }, CLUSTER)).toBe(true);
        expect(isClusterVolume({ 'ebs.csi.aws.com/cluster': 'true', 'kubernetes.io/cluster/splitx': 'owned' }, CLUSTER)).toBe(true);
    });

    it('does not count another cluster\'s volume, or a node\'s root volume, as a PVC volume', () => {
        expect(isClusterVolume({ 'ebs.csi.aws.com/cluster': 'true', KubernetesCluster: 'other' }, CLUSTER)).toBe(false);
        expect(isClusterVolume({ project: 'splitx', stack: 'platform' }, CLUSTER)).toBe(false);
    });

    it('counts only unused interfaces the platform tagged', () => {
        expect(isStrayInterface({ Status: 'available', TagSet: platform }, CLUSTER)).toBe(true);
        expect(isStrayInterface({ Status: 'available', TagSet: [{ Key: 'cluster.k8s.amazonaws.com/name', Value: 'splitx' }] }, CLUSTER)).toBe(true);
        expect(isStrayInterface({ Status: 'in-use', TagSet: platform }, CLUSTER)).toBe(false);
        expect(isStrayInterface({ Status: 'available', TagSet: [] }, CLUSTER)).toBe(false);
    });

    it('leaves the account layer\'s roles alone', () => {
        expect(isPlatformIamName('splitx-eks-node')).toBe(true);
        expect(isPlatformIamName('splitx-wl-ops-api')).toBe(true);
        expect(isPlatformIamName('splitx-ci-deploy')).toBe(false);
        expect(isPlatformIamName('splitx-ci-teardown')).toBe(false);
        expect(isPlatformIamName('splitx-devops-policy')).toBe(false);
    });
});

describe('the report', () => {
    it('counts nothing in an account that holds only other things', () => {
        // What this account really holds besides SplitX: coursework instances
        // and their volumes, the default VPC, and the account layer.
        const rows = leftovers({
            ...empty,
            instances: [
                { InstanceId: 'i-1', State: { Name: 'stopped' }, Tags: [{ Key: 'Name', Value: 'NagiosPrac' }] },
                { InstanceId: 'i-2', State: { Name: 'stopped' }, Tags: [{ Key: 'Name', Value: 'terraform-prac' }] },
            ],
            vpcs: [{ VpcId: 'vpc-default', Tags: [] }],
            volumes: [{ VolumeId: 'vol-coursework', State: 'in-use', Tags: [] }],
            securityGroups: [{ GroupId: 'sg-default', GroupName: 'default', Tags: [] }],
            loadBalancers: [{ LoadBalancerName: 'someone-else', LoadBalancerArn: 'arn:lb', tags: {} }],
            logGroups: [{ logGroupName: '/aws/lambda/something' }, { logGroupName: '/aws/eks/other/cluster' }],
            alarms: ['billing-alarm'],
            secrets: ['splitx/prod/app'],
            roles: ['splitx-ci-deploy', 'splitx-ci-teardown', 'AWSServiceRoleForSupport'],
            policies: ['splitx-devops-policy', 'splitx-ci-boundary'],
        }, CLUSTER);
        expect(count(rows)).toBe(0);
    });

    it('counts everything the platform leaves, by kind', () => {
        const rows = leftovers({
            ...empty,
            clusters: ['splitx', 'other'],
            instances: [
                { InstanceId: 'i-node', State: { Name: 'shutting-down' }, Tags: [{ Key: 'eks:cluster-name', Value: 'splitx' }] },
                { InstanceId: 'i-gone', State: { Name: 'terminated' }, Tags: [{ Key: 'eks:cluster-name', Value: 'splitx' }] },
            ],
            loadBalancers: [{ LoadBalancerName: 'k8s-splitx-abc', LoadBalancerArn: 'arn:lb', tags: { 'elbv2.k8s.aws/cluster': 'splitx' } }],
            natGateways: [
                { NatGatewayId: 'nat-1', State: 'deleting', Tags: platform },
                { NatGatewayId: 'nat-2', State: 'deleted', Tags: platform },
            ],
            volumes: [{ VolumeId: 'vol-pvc', State: 'available', Tags: [{ Key: 'ebs.csi.aws.com/cluster', Value: 'true' }, ...platform] }],
            securityGroups: [{ GroupId: 'sg-alb', GroupName: 'k8s-traffic', Tags: [{ Key: 'elbv2.k8s.aws/cluster', Value: 'splitx' }] }],
            logGroups: [{ logGroupName: '/aws/eks/splitx/cluster' }, { logGroupName: '/aws/vpc-flow-logs/splitx' }],
            alarms: ['splitx-alb-5xx'],
            secrets: ['splitx/demo/app'],
            roles: ['splitx-eks-node', 'splitx-ci-deploy'],
        }, CLUSTER);
        expect(row(rows, 'EKS cluster')).toEqual(['splitx']);
        expect(row(rows, 'EC2 instances')).toEqual(['i-node (shutting-down)']);
        expect(row(rows, 'Load balancers')).toEqual(['k8s-splitx-abc']);
        expect(row(rows, 'NAT gateways')).toEqual(['nat-1 (deleting)']);
        expect(row(rows, 'EBS volumes')).toEqual(['vol-pvc (available)']);
        expect(row(rows, 'Security groups')).toEqual(['sg-alb (k8s-traffic)']);
        expect(row(rows, 'Log groups')).toEqual(['/aws/eks/splitx/cluster', '/aws/vpc-flow-logs/splitx']);
        expect(row(rows, 'Alarms')).toEqual(['splitx-alb-5xx']);
        expect(row(rows, 'Secrets')).toEqual(['splitx/demo/app']);
        expect(row(rows, 'IAM roles')).toEqual(['splitx-eks-node']);
        expect(count(rows)).toBe(11);
    });
});
