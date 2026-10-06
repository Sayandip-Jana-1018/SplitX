/**
 * What ops-api reads from AWS (D-097), with the AWS SDK and the credentials
 * EKS Pod Identity gives its service account: the role splitx-wl-ops-api
 * (terraform/platform/workloads.tf), which may read the stacks, the cluster,
 * the edge and the budget, and is denied Cost Explorer. On Kind there is no
 * role, and every reading here says so instead of guessing.
 */
import { ApiGatewayV2Client, GetApiCommand, GetIntegrationsCommand, GetRoutesCommand, GetStageCommand } from '@aws-sdk/client-apigatewayv2';
import { BudgetsClient, DescribeBudgetCommand } from '@aws-sdk/client-budgets';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { DescribeAddonCommand, DescribeClusterCommand, DescribeNodegroupCommand, EKSClient, ListAddonsCommand, ListNodegroupsCommand } from '@aws-sdk/client-eks';
import { summariseApi, summariseBudget, summariseEks, summariseStacks } from './summaries.mjs';

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

/** The HTTP API serving the edge's domain (EDGE_DOMAIN, from the platform's facts; D-114). */
export async function readEdge() {
    withRole();
    const domain = process.env.EDGE_DOMAIN;
    if (!domain) throw new Error('the edge\'s domain is not configured');
    const id = /^([a-z0-9]+)\.execute-api\.[a-z0-9-]+\.amazonaws\.com$/.exec(domain)?.[1];
    if (!id) throw new Error(domain + ' is not an API Gateway address');
    const gateway = client('apigatewayv2', () => new ApiGatewayV2Client({ region: REGION }));
    const api = await gateway.send(new GetApiCommand({ ApiId: id }));
    const routes = (await gateway.send(new GetRoutesCommand({ ApiId: id }))).Items ?? [];
    const integrations = (await gateway.send(new GetIntegrationsCommand({ ApiId: id }))).Items ?? [];
    const stage = await gateway.send(new GetStageCommand({ ApiId: id, StageName: '$default' })).catch(() => null);
    return summariseApi(api, routes, integrations, stage);
}

export async function readBudget() {
    withRole();
    if (!account) await readEks();
    const budgets = client('budgets', () => new BudgetsClient({ region: 'us-east-1' }));
    const { Budget } = await budgets.send(new DescribeBudgetCommand({ AccountId: account, BudgetName: BUDGET }));
    return summariseBudget(Budget);
}
