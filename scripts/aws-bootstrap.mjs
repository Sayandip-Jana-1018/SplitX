#!/usr/bin/env node
/**
 * Deploys SplitX's two permanent CloudFormation stacks from the laptop, as the
 * IAM user splitx-devops (terraform/bootstrap):
 *
 *   splitx-bootstrap   Terraform's state bucket, GitHub's OIDC provider, the
 *                      role only the reviewed aws-demo environment may assume
 *                      (it builds), the role only aws-teardown may assume (it
 *                      can only remove), and the permissions boundary both
 *                      carry, as does every platform role
 *   splitx-guardrails  the monthly budget (without credits) and the alert topic
 *
 * Each stack is deployed through a change set (aws cloudformation deploy): the
 * changes are computed first and nothing happens when there are none.
 *
 *   npm run aws:bootstrap            deploy both
 *   npm run aws:bootstrap -- --plan  create the change sets and show them, without running them
 *
 * Reads BUDGET_EMAIL from .env: where budget alerts are emailed. AWS sends a
 * confirmation link to that address first. Region: AWS_REGION, else ap-south-1.
 */
import { spawnSync } from 'node:child_process';

const REGION = process.env.AWS_REGION || 'ap-south-1';
const PLAN_ONLY = process.argv.includes('--plan');

function aws(args, { json = true, quiet = false } = {}) {
    const result = spawnSync('aws', [...args, '--region', REGION, ...(json ? ['--output', 'json'] : [])], {
        encoding: 'utf8',
        stdio: quiet || json ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    if (result.error) throw new Error(`could not run the AWS CLI: ${result.error.message}`);
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function fail(message) {
    console.error(`aws:bootstrap: ${message}`);
    process.exit(1);
}

// ── Who is deploying ──
const identity = aws(['sts', 'get-caller-identity']);
if (identity.status !== 0) fail(`no AWS credentials: ${identity.stderr.trim()}`);
const arn = JSON.parse(identity.stdout).Arn;
if (!arn.endsWith(':user/splitx-devops')) fail('run this as the IAM user splitx-devops (aws configure)');
console.log(`Deploying as splitx-devops to ${REGION}${PLAN_ONLY ? ' (plan only)' : ''}.`);

const budgetEmail = process.env.BUDGET_EMAIL;
if (!budgetEmail) fail('set BUDGET_EMAIL in .env: where budget alerts are emailed');

// ── GitHub's OIDC provider exists once per account ──
const providers = aws(['iam', 'list-open-id-connect-providers']);
if (providers.status !== 0) fail(`could not list OIDC providers: ${providers.stderr.trim()}`);
const hasGitHubProvider = JSON.parse(providers.stdout).OpenIDConnectProviderList
    .some(({ Arn }) => Arn.endsWith(':oidc-provider/token.actions.githubusercontent.com'));

const stacks = [
    {
        name: 'splitx-bootstrap',
        template: 'cloudformation/bootstrap.yaml',
        parameters: [`CreateOidcProvider=${hasGitHubProvider ? 'false' : 'true'}`],
    },
    {
        name: 'splitx-guardrails',
        template: 'cloudformation/guardrails.yaml',
        parameters: [`AlertEmail=${budgetEmail}`],
    },
];

for (const stack of stacks) {
    const valid = aws(['cloudformation', 'validate-template', '--template-body', `file://${stack.template}`], { quiet: true });
    if (valid.status !== 0) fail(`${stack.template} is not valid: ${valid.stderr.trim()}`);

    console.log(`\n── ${stack.name} ──`);
    const deploy = aws([
        'cloudformation', 'deploy',
        '--stack-name', stack.name,
        '--template-file', stack.template,
        '--capabilities', 'CAPABILITY_NAMED_IAM',
        '--parameter-overrides', ...stack.parameters,
        '--tags', 'project=splitx',
        '--no-fail-on-empty-changeset',
        ...(PLAN_ONLY ? ['--no-execute-changeset'] : []),
    ], { json: false });
    if (deploy.status !== 0) fail(`${stack.name} failed; its events: aws cloudformation describe-stack-events --stack-name ${stack.name}`);

    if (!PLAN_ONLY) {
        const described = aws(['cloudformation', 'describe-stacks', '--stack-name', stack.name]);
        const [{ StackStatus, Outputs = [] }] = JSON.parse(described.stdout).Stacks;
        console.log(`${stack.name}: ${StackStatus}`);
        for (const output of Outputs) console.log(`  ${output.OutputKey}: ${output.OutputValue}`);
    }
}

if (!PLAN_ONLY) {
    console.log('\nNext: confirm the subscription in the email AWS sent to BUDGET_EMAIL, or budget alerts go nowhere.');
}
