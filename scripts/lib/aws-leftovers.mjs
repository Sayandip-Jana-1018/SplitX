/**
 * What a SplitX platform leaves on AWS, decided from the AWS CLI's answers.
 *
 * aws-down (scripts/aws-teardown.mjs) asks AWS what exists in the platform's
 * region; these functions pick out what belongs to the platform, by the tags
 * Terraform and the cluster's controllers put on it (terraform/platform) and by
 * names only SplitX uses. Nothing else in the account is ever selected, which
 * is what makes it safe for the teardown role to delete what they return.
 */

/**
 * Tags as a plain object, from AWS's list shapes ([{ Key, Value }], or
 * [{ key, value }] where a service spells it that way).
 * @param {Array<Record<string, string>> | undefined} tags
 * @returns {Record<string, string>}
 */
export function tagMap(tags = []) {
    const map = {};
    for (const tag of tags ?? []) map[tag.Key ?? tag.key] = tag.Value ?? tag.value;
    return map;
}

/** Terraform's default tags (and the controllers' extra tags) on the platform. */
export const isPlatformTagged = (tags) => tags.project === 'splitx' && tags.stack === 'platform';

/** Made by the AWS Load Balancer Controller for this cluster: ALBs, NLBs, target groups, their security groups. */
export const isControllerMade = (tags, cluster) => tags['elbv2.k8s.aws/cluster'] === cluster;

/** A volume the EBS CSI driver made for one of this cluster's PVCs (not a node's root volume). */
export function isClusterVolume(tags, cluster) {
    if (tags['ebs.csi.aws.com/cluster'] !== 'true') return false;
    return isPlatformTagged(tags) || tags.KubernetesCluster === cluster || tags[`kubernetes.io/cluster/${cluster}`] === 'owned';
}

/** A network interface the VPC CNI made and nothing uses any more. */
export function isStrayInterface(networkInterface, cluster) {
    if (networkInterface.Status !== 'available') return false;
    const tags = tagMap(networkInterface.TagSet);
    return isPlatformTagged(tags) || tags['cluster.k8s.amazonaws.com/name'] === cluster;
}

/** The platform's IAM roles and policies (splitx-ci-* belong to the account layer and stay). */
export const isPlatformIamName = (name) => /^splitx-(eks|wl)-/.test(name);

/** The log groups the platform writes: the control plane's and the VPC's flow logs. */
export const logGroupPrefixes = (cluster) => [`/aws/eks/${cluster}/`, `/aws/vpc-flow-logs/${cluster}`];

/** Alarms aws-up makes on the load balancer (terraform/platform/alarms.tf). */
export const ALARM_PREFIX = 'splitx-alb-';

/** The demo's secrets, copied from .env by npm run aws:secrets. */
export const SECRET_PREFIX = 'splitx/demo/';

const GONE_INSTANCE = new Set(['terminated']);
const GONE_NAT = new Set(['deleted', 'failed']);

/**
 * Everything the platform makes, and what of it still exists. `snapshot` is
 * what the AWS CLI answered (see collect() in scripts/aws-teardown.mjs).
 * @param {Snapshot} snapshot
 * @param {string} cluster
 * @returns {{ kind: string, items: string[] }[]}
 */
export function leftovers(snapshot, cluster) {
    const tagged = (list, tagsOf, test) => list.filter((item) => test(tagMap(tagsOf(item))));
    const platformOrController = (tags) => isPlatformTagged(tags) || isControllerMade(tags, cluster);

    return [
        { kind: 'EKS cluster', items: snapshot.clusters.filter((name) => name === cluster) },
        {
            kind: 'EC2 instances',
            items: snapshot.instances
                .filter((instance) => !GONE_INSTANCE.has(instance.State?.Name))
                .filter((instance) => tagMap(instance.Tags)['eks:cluster-name'] === cluster)
                .map((instance) => `${instance.InstanceId} (${instance.State?.Name})`),
        },
        {
            kind: 'Load balancers',
            items: snapshot.loadBalancers.filter((lb) => isControllerMade(lb.tags, cluster)).map((lb) => lb.LoadBalancerName),
        },
        {
            kind: 'Target groups',
            items: snapshot.targetGroups.filter((tg) => isControllerMade(tg.tags, cluster)).map((tg) => tg.TargetGroupName),
        },
        {
            kind: 'NAT gateways',
            items: tagged(snapshot.natGateways, (nat) => nat.Tags, isPlatformTagged)
                .filter((nat) => !GONE_NAT.has(nat.State))
                .map((nat) => `${nat.NatGatewayId} (${nat.State})`),
        },
        {
            kind: 'Elastic IPs',
            items: tagged(snapshot.addresses, (address) => address.Tags, isPlatformTagged).map((address) => address.AllocationId),
        },
        { kind: 'VPCs', items: tagged(snapshot.vpcs, (vpc) => vpc.Tags, isPlatformTagged).map((vpc) => vpc.VpcId) },
        {
            kind: 'EBS volumes',
            items: snapshot.volumes
                .filter((volume) => {
                    const tags = tagMap(volume.Tags);
                    return isClusterVolume(tags, cluster) || isPlatformTagged(tags);
                })
                .map((volume) => `${volume.VolumeId} (${volume.State})`),
        },
        {
            kind: 'Network interfaces',
            items: snapshot.networkInterfaces
                .filter((networkInterface) => isStrayInterface(networkInterface, cluster))
                .map((networkInterface) => networkInterface.NetworkInterfaceId),
        },
        {
            kind: 'Security groups',
            items: tagged(snapshot.securityGroups, (group) => group.Tags, platformOrController).map((group) => `${group.GroupId} (${group.GroupName})`),
        },
        {
            kind: 'Log groups',
            items: snapshot.logGroups
                .map((group) => group.logGroupName)
                .filter((name) => logGroupPrefixes(cluster).some((prefix) => name.startsWith(prefix))),
        },
        { kind: 'Alarms', items: snapshot.alarms.filter((name) => name.startsWith(ALARM_PREFIX)) },
        { kind: 'Secrets', items: snapshot.secrets.filter((name) => name.startsWith(SECRET_PREFIX)) },
        { kind: 'IAM roles', items: snapshot.roles.filter(isPlatformIamName) },
        { kind: 'IAM policies', items: snapshot.policies.filter(isPlatformIamName) },
    ];
}

/**
 * @typedef {object} Snapshot
 * @property {string[]} clusters
 * @property {Array<{ InstanceId: string, State?: { Name: string }, Tags?: object[] }>} instances
 * @property {Array<{ LoadBalancerName: string, LoadBalancerArn: string, tags: Record<string, string> }>} loadBalancers
 * @property {Array<{ TargetGroupName: string, TargetGroupArn: string, tags: Record<string, string> }>} targetGroups
 * @property {Array<{ NatGatewayId: string, State: string, Tags?: object[] }>} natGateways
 * @property {Array<{ AllocationId: string, AssociationId?: string, Tags?: object[] }>} addresses
 * @property {Array<{ VpcId: string, Tags?: object[] }>} vpcs
 * @property {Array<{ VolumeId: string, State: string, Tags?: object[] }>} volumes
 * @property {Array<{ NetworkInterfaceId: string, Status: string, TagSet?: object[] }>} networkInterfaces
 * @property {Array<{ GroupId: string, GroupName: string, Tags?: object[] }>} securityGroups
 * @property {Array<{ logGroupName: string }>} logGroups
 * @property {string[]} alarms
 * @property {string[]} secrets
 * @property {string[]} roles
 * @property {string[]} policies
 */
