#!/usr/bin/env node
/**
 * The AWS side of aws-down (.github/workflows/aws-down.yml), run as the IAM
 * role splitx-ci-teardown: it may look at everything in the platform's region
 * and delete what the platform made, and nothing else
 * (cloudformation/bootstrap.yaml). What counts as the platform's is decided in
 * scripts/lib/aws-leftovers.mjs, by SplitX's tags and names only.
 *
 *   node scripts/aws-teardown.mjs wait-load-balancers
 *       After the Ingresses are deleted: until the load balancers the AWS Load
 *       Balancer Controller made, and their network interfaces, are gone.
 *   node scripts/aws-teardown.mjs wait-volumes
 *       After the workload namespaces are deleted: until the EBS volumes
 *       behind their PVCs are gone.
 *   node scripts/aws-teardown.mjs sweep
 *       Deletes what the cluster made and Terraform doesn't know about: the
 *       controller's load balancers, target groups and security groups, volumes,
 *       stray interfaces and addresses, and the platform's log groups, alarms
 *       and the demo's secrets. A deletion that fails is reported and left for
 *       the report to count.
 *   node scripts/aws-teardown.mjs report [--wait <seconds>]
 *       Everything the platform makes that still exists, as a table (in the
 *       job summary too). Exits 1 unless there is nothing. --wait gives what is
 *       still being deleted (a NAT gateway takes a minute) that long.
 *
 * AWS_REGION is the platform's region; CLUSTER_NAME defaults to splitx.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import {
    ALARM_PREFIX,
    SECRET_PREFIX,
    isClusterVolume,
    isControllerMade,
    isPlatformTagged,
    isStrayInterface,
    leftovers,
    logGroupPrefixes,
    tagMap,
} from './lib/aws-leftovers.mjs';

const REGION = process.env.AWS_REGION;
const CLUSTER = process.env.CLUSTER_NAME || 'splitx';
const WAIT_SECONDS = 600;
const [command, ...args] = process.argv.slice(2);

function aws(argv) {
    const result = spawnSync('aws', [...argv, '--region', REGION, '--output', 'json'], {
        encoding: 'utf8',
        env: { ...process.env, AWS_PAGER: '' },
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) throw new Error(`could not run the AWS CLI: ${result.error.message}`);
    if (result.status !== 0) throw new Error((result.stderr ?? '').trim() || `aws ${argv[0]} ${argv[1]} exited ${result.status}`);
    return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const unique = (list, key) => [...new Map(list.map((item) => [item[key], item])).values()];

/** Tags of load balancers or target groups, 20 at a time (the API's limit). */
function elbTags(arns) {
    const tags = new Map();
    for (let i = 0; i < arns.length; i += 20) {
        const answer = aws(['elbv2', 'describe-tags', '--resource-arns', ...arns.slice(i, i + 20)]);
        for (const description of answer.TagDescriptions ?? []) tags.set(description.ResourceArn, tagMap(description.Tags));
    }
    return tags;
}

function loadBalancers() {
    const all = aws(['elbv2', 'describe-load-balancers']).LoadBalancers ?? [];
    const tags = elbTags(all.map((lb) => lb.LoadBalancerArn));
    return all.map((lb) => ({ ...lb, tags: tags.get(lb.LoadBalancerArn) ?? {} }));
}

function targetGroups() {
    const all = aws(['elbv2', 'describe-target-groups']).TargetGroups ?? [];
    const tags = elbTags(all.map((tg) => tg.TargetGroupArn));
    return all.map((tg) => ({ ...tg, tags: tags.get(tg.TargetGroupArn) ?? {} }));
}

function volumes() {
    return unique([
        ...(aws(['ec2', 'describe-volumes', '--filters', 'Name=tag:project,Values=splitx']).Volumes ?? []),
        ...(aws(['ec2', 'describe-volumes', '--filters', 'Name=tag-key,Values=ebs.csi.aws.com/cluster']).Volumes ?? []),
    ], 'VolumeId');
}

/** What exists now, in the shape scripts/lib/aws-leftovers.mjs reads. */
function collect() {
    return {
        clusters: aws(['eks', 'list-clusters']).clusters ?? [],
        instances: (aws(['ec2', 'describe-instances', '--filters', `Name=tag:eks:cluster-name,Values=${CLUSTER}`]).Reservations ?? [])
            .flatMap((reservation) => reservation.Instances ?? []),
        loadBalancers: loadBalancers(),
        targetGroups: targetGroups(),
        // NAT gateways take --filter, not --filters.
        natGateways: aws(['ec2', 'describe-nat-gateways', '--filter', 'Name=tag:project,Values=splitx']).NatGateways ?? [],
        addresses: aws(['ec2', 'describe-addresses', '--filters', 'Name=tag:project,Values=splitx']).Addresses ?? [],
        vpcs: aws(['ec2', 'describe-vpcs', '--filters', 'Name=tag:project,Values=splitx']).Vpcs ?? [],
        volumes: volumes(),
        networkInterfaces: aws(['ec2', 'describe-network-interfaces', '--filters', 'Name=status,Values=available']).NetworkInterfaces ?? [],
        securityGroups: unique([
            ...(aws(['ec2', 'describe-security-groups', '--filters', 'Name=tag:project,Values=splitx']).SecurityGroups ?? []),
            ...(aws(['ec2', 'describe-security-groups', '--filters', `Name=tag:elbv2.k8s.aws/cluster,Values=${CLUSTER}`]).SecurityGroups ?? []),
        ], 'GroupId'),
        logGroups: logGroupPrefixes(CLUSTER).flatMap((prefix) => aws(['logs', 'describe-log-groups', '--log-group-name-prefix', prefix]).logGroups ?? []),
        alarms: (aws(['cloudwatch', 'describe-alarms', '--alarm-name-prefix', ALARM_PREFIX]).MetricAlarms ?? []).map((alarm) => alarm.AlarmName),
        secrets: (aws(['secretsmanager', 'list-secrets', '--filters', `Key=name,Values=${SECRET_PREFIX}`]).SecretList ?? []).map((secret) => secret.Name),
        roles: (aws(['iam', 'list-roles']).Roles ?? []).map((role) => role.RoleName),
        policies: (aws(['iam', 'list-policies', '--scope', 'Local']).Policies ?? []).map((policy) => policy.PolicyName),
    };
}

/** Polls `remaining` every 15 s until it is empty; false when time runs out. */
function waitUntilGone(label, remaining, seconds = WAIT_SECONDS) {
    const deadline = Date.now() + seconds * 1000;
    for (;;) {
        const left = remaining();
        if (left.length === 0) {
            console.log(`${label}: none left`);
            return true;
        }
        if (Date.now() > deadline) {
            // The sweep and the report after it deal with what is left.
            console.log(`::warning::${label}: still ${left.join(', ')} after ${seconds} s`);
            return false;
        }
        console.log(`${label}: waiting for ${left.join(', ')}`);
        sleep(15_000);
    }
}

function controllerLoadBalancers() {
    return loadBalancers().filter((lb) => isControllerMade(lb.tags, CLUSTER));
}

function waitLoadBalancers() {
    waitUntilGone('load balancers', () => {
        const left = controllerLoadBalancers().map((lb) => lb.LoadBalancerName);
        // A deleted load balancer's interfaces linger for a few minutes, and
        // they keep the public subnets from being deleted.
        const vpcIds = (aws(['ec2', 'describe-vpcs', '--filters', 'Name=tag:project,Values=splitx']).Vpcs ?? []).map((vpc) => vpc.VpcId);
        if (vpcIds.length > 0) {
            const interfaces = aws(['ec2', 'describe-network-interfaces', '--filters',
                `Name=vpc-id,Values=${vpcIds.join(',')}`, 'Name=requester-id,Values=amazon-elb']).NetworkInterfaces ?? [];
            left.push(...interfaces.map((networkInterface) => networkInterface.NetworkInterfaceId));
        }
        return left;
    });
}

function waitVolumes() {
    waitUntilGone('volumes behind PVCs', () => volumes()
        .filter((volume) => isClusterVolume(tagMap(volume.Tags), CLUSTER))
        .map((volume) => `${volume.VolumeId} (${volume.State})`));
}

function sweep() {
    const snapshot = collect();
    const attempt = (label, argv) => {
        try {
            aws(argv);
            console.log(`deleted ${label}`);
            return true;
        } catch (error) {
            console.log(`could not delete ${label}: ${error.message}`);
            return false;
        }
    };

    // Load balancers first: they hold the target groups and the interfaces.
    const lbs = snapshot.loadBalancers.filter((lb) => isControllerMade(lb.tags, CLUSTER));
    for (const lb of lbs) attempt(`load balancer ${lb.LoadBalancerName}`, ['elbv2', 'delete-load-balancer', '--load-balancer-arn', lb.LoadBalancerArn]);
    if (lbs.length > 0) waitUntilGone('load balancers', () => controllerLoadBalancers().map((lb) => lb.LoadBalancerName), 300);

    for (const tg of snapshot.targetGroups.filter((group) => isControllerMade(group.tags, CLUSTER))) {
        attempt(`target group ${tg.TargetGroupName}`, ['elbv2', 'delete-target-group', '--target-group-arn', tg.TargetGroupArn]);
    }

    for (const volume of snapshot.volumes) {
        const tags = tagMap(volume.Tags);
        if (volume.State === 'available' && (isClusterVolume(tags, CLUSTER) || isPlatformTagged(tags))) {
            attempt(`volume ${volume.VolumeId}`, ['ec2', 'delete-volume', '--volume-id', volume.VolumeId]);
        }
    }

    for (const networkInterface of snapshot.networkInterfaces.filter((eni) => isStrayInterface(eni, CLUSTER))) {
        attempt(`interface ${networkInterface.NetworkInterfaceId}`, ['ec2', 'delete-network-interface', '--network-interface-id', networkInterface.NetworkInterfaceId]);
    }

    // The controller's security groups can go only once nothing uses them,
    // which is a few minutes after their load balancer.
    const controllerGroups = snapshot.securityGroups.filter((group) => isControllerMade(tagMap(group.Tags), CLUSTER));
    if (controllerGroups.length > 0) {
        let left = controllerGroups;
        waitUntilGone('the controller\'s security groups', () => {
            left = left.filter((group) => !attempt(`security group ${group.GroupId}`, ['ec2', 'delete-security-group', '--group-id', group.GroupId]));
            return left.map((group) => group.GroupId);
        }, 300);
    }

    for (const address of snapshot.addresses) {
        if (!address.AssociationId && isPlatformTagged(tagMap(address.Tags))) {
            attempt(`address ${address.AllocationId}`, ['ec2', 'release-address', '--allocation-id', address.AllocationId]);
        }
    }

    for (const group of snapshot.logGroups) {
        attempt(`log group ${group.logGroupName}`, ['logs', 'delete-log-group', '--log-group-name', group.logGroupName]);
    }

    if (snapshot.alarms.length > 0) {
        attempt(`alarms ${snapshot.alarms.join(', ')}`, ['cloudwatch', 'delete-alarms', '--alarm-names', ...snapshot.alarms]);
    }

    for (const name of snapshot.secrets) {
        // No recovery window: they were copies of .env, which still has them.
        attempt(`secret ${name}`, ['secretsmanager', 'delete-secret', '--secret-id', name, '--force-delete-without-recovery']);
    }
}

function report(waitSeconds) {
    const deadline = Date.now() + waitSeconds * 1000;
    let rows;
    for (;;) {
        rows = leftovers(collect(), CLUSTER);
        const total = rows.reduce((sum, row) => sum + row.items.length, 0);
        if (total === 0 || Date.now() > deadline) break;
        console.log(`${total} still there; checking again in 15 s`);
        sleep(15_000);
    }

    const total = rows.reduce((sum, row) => sum + row.items.length, 0);
    const lines = [
        `### What the platform left in ${REGION}: ${total === 0 ? 'nothing' : total}`,
        '',
        '| Kind | Left |',
        '|---|---|',
        ...rows.map((row) => `| ${row.kind} | ${row.items.length === 0 ? '0' : row.items.join(', ')} |`),
        '',
        `Checked ${new Date().toISOString()}.`,
    ];
    console.log(lines.join('\n'));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
    if (total > 0) {
        console.log('::error::The platform is not fully removed; see the table.');
        process.exit(1);
    }
}

if (!REGION) {
    console.error('aws-teardown: set AWS_REGION to the platform\'s region');
    process.exit(2);
}

switch (command) {
    case 'wait-load-balancers':
        waitLoadBalancers();
        break;
    case 'wait-volumes':
        waitVolumes();
        break;
    case 'sweep':
        sweep();
        break;
    case 'report': {
        const index = args.indexOf('--wait');
        report(index === -1 ? 0 : Number(args[index + 1] ?? 0));
        break;
    }
    default:
        console.error('usage: node scripts/aws-teardown.mjs wait-load-balancers | wait-volumes | sweep | report [--wait <seconds>]');
        process.exit(2);
}
