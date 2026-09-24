/**
 * What ops-api reads from AWS (D-097), with the AWS SDK and the credentials
 * EKS Pod Identity gives its service account: the role splitx-wl-ops-api
 * (terraform/platform/workloads.tf), which may read the stacks, the cluster,
 * the edge and the budget, and is denied Cost Explorer. On Kind there is no
 * role, and every reading here says so instead of guessing.
 */
import { BudgetsClient, DescribeBudgetCommand } from '@aws-sdk/client-budgets';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { CloudFrontClient, ListDistributionsCommand } from '@aws-sdk/client-cloudfront';
import { DescribeAddonCommand, DescribeClusterCommand, DescribeNodegroupCommand, EKSClient, ListAddonsCommand, ListNodegroupsCommand } from '@aws-sdk/client-eks';
import { summariseBudget, summariseDistribution, summariseEks, summariseStacks } from './summaries.mjs';

const REGION = process.env.AWS_REGION ?? 'ap-south-1';
const CLUSTER = process.env.CLUSTER_NAME ?? 'splitx';
const STACKS = ['splitx-bootstrap', 'splitx-guardrails'];
const BUDGET = 'splitx-monthly';

// The account the budget belongs to, learned from the cluster's ARN; used for
// the Budgets call only, never returned.
let account = null;

function withRole() {
    if (!process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI) {
        throw new Error('no AWS role here: only the EKS platform gives ops-api one (EKS Pod Identity)');
    }
}

const clients = {};
const client = (name, make) => (clients[name] ??= make());

export async function readStacks() {
    withRole();
    const cloudformation = client('cloudformation', () => new CloudFormationClient({ region: REGION }));
    const stacks = [];
    for (const name of STACKS) stacks.push(...((await cloudformation.send(new DescribeStacksCommand({ StackName: name }))).Stacks ?? []));
    return summariseStacks(stacks);
}

export async function readEks() {
    withRole();
    const eks = client('eks', () => new EKSClient({ region: REGION }));
    const { cluster } = await eks.send(new DescribeClusterCommand({ name: CLUSTER }));
    account = cluster.arn.split(':')[4];
    const groups = [];
    for (const name of (await eks.send(new ListNodegroupsCommand({ clusterName: CLUSTER }))).nodegroups ?? []) {
        groups.push((await eks.send(new DescribeNodegroupCommand({ clusterName: CLUSTER, nodegroupName: name }))).nodegroup);
    }
    const addons = [];
    for (const name of (await eks.send(new ListAddonsCommand({ clusterName: CLUSTER }))).addons ?? []) {
        addons.push((await eks.send(new DescribeAddonCommand({ clusterName: CLUSTER, addonName: name }))).addon);
    }
    return summariseEks(cluster, groups, addons);
}

/** The distribution serving the edge's domain (EDGE_DOMAIN, from the platform's facts). */
export async function readEdge() {
    withRole();
    const domain = process.env.EDGE_DOMAIN;
    if (!domain) throw new Error('the edge\'s domain is not configured');
    const cloudfront = client('cloudfront', () => new CloudFrontClient({ region: 'us-east-1' }));
    const list = await cloudfront.send(new ListDistributionsCommand({}));
    const distribution = list.DistributionList?.Items?.find((item) => item.DomainName === domain);
    if (!distribution) throw new Error('no CloudFront distribution serves ' + domain);
    return summariseDistribution(distribution);
}

export async function readBudget() {
    withRole();
    if (!account) await readEks();
    const budgets = client('budgets', () => new BudgetsClient({ region: 'us-east-1' }));
    const { Budget } = await budgets.send(new DescribeBudgetCommand({ AccountId: account, BudgetName: BUDGET }));
    return summariseBudget(Budget);
}
