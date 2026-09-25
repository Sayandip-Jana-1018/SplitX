# SplitX on AWS: the setup

SplitX's demo platform runs on AWS only on the days that need it. This guide sets up what stays in
the account between those days. It is done once, and costs nothing, or cents, while idle. What to do
on each AWS day is in the runbook, [docs/DEMO_DAY.md](docs/DEMO_DAY.md). Why each part is built this
way is in [docs/DECISIONS.md](docs/DECISIONS.md): D-087 to D-103.

## What lives where

| Layer | Made by | Stays | What it holds |
|---|---|---|---|
| **The laptop's identity** | by hand, once | always | The IAM user `splitx-devops`, for the laptop's CLI calls. It may manage only `splitx-*` IAM names, and every role it makes must carry the permissions boundary ([terraform/bootstrap](terraform/bootstrap/README.md)). The root user keeps MFA and has no access keys. |
| **The account layer** | CloudFormation, `npm run aws:bootstrap` | always | `splitx-bootstrap`: Terraform's state bucket, GitHub's OIDC provider, the roles `splitx-ci-deploy` (builds; only the reviewed environment `aws-demo` may assume it) and `splitx-ci-teardown` (can only remove), and the boundary both carry. `splitx-guardrails`: a $15 monthly budget and the alert topic ([cloudformation](cloudformation/README.md)). |
| **The edge** | Terraform, `terraform/edge`, the **AWS edge** workflow | always, $0 idle | The CloudFront distribution and its function, which refuses the internal paths and serves an offline page while the platform is down. |
| **The platform** | Terraform, `terraform/platform`, in **AWS up** | one day at a time | A VPC in two zones, EKS 1.35 with its add-ons, 3 to 4 `m7i-flex.large` nodes, and each workload's role through EKS Pod Identity. |
| **The software** | `scripts/cluster-up.mjs --target eks`, in **AWS up** | one day at a time | External Secrets, Prometheus, Grafana, Loki, Kyverno, the AWS Load Balancer Controller, the Cluster Autoscaler, Jenkins, Nexus, the app, ops-api and the traffic lab. |
| **The secrets** | `npm run aws:secrets`, from `.env` | only during an AWS day | `splitx/demo/app` and `splitx/demo/platform` in Secrets Manager. `aws-down` deletes them. |

No workflow holds an AWS key. GitHub's OIDC token is exchanged for a role, for at most three hours,
and only in `ap-south-1`.

## The one-time setup

### 1. The laptop's CLI

1. Create the user `splitx-devops` and its policy as described in
   [terraform/bootstrap/README.md](terraform/bootstrap/README.md). Run this as an administrator, not as
   the user itself.
2. Create its access key in the IAM console, and enter it with `aws configure`, region `ap-south-1`.
   Never paste a key into a file in this repository.
3. Check it: `aws sts get-caller-identity` names `splitx-devops`.

### 2. The account layer

1. Put `BUDGET_EMAIL` in `.env`: where budget alerts are emailed.
2. See the changes first with `npm run aws:bootstrap -- --plan`, then deploy them with
   `npm run aws:bootstrap`.
3. Confirm the subscription: AWS emails a link to `BUDGET_EMAIL` first.

### 3. GitHub

1. **Environment `aws-demo`**, with you as its required reviewer (Settings → Environments). Only its
   jobs may assume `splitx-ci-deploy`, so **AWS edge**, **AWS up** and **AWS verify** wait for your
   approval.
2. **Environment `aws-teardown`**, with no reviewer. **AWS down** runs in it, including at night.
3. **The repository secret `AWS_ACCOUNT_ID`**: the 12-digit account number. GitHub masks it in the
   public logs.

### 4. The account's limits

- **vCPU quota:** four `m7i-flex.large` nodes need 8 vCPUs. Service Quotas → Amazon EC2 → "Running
  On-Demand Standard (A, C, D, H, I, M, R, T, Z) instances" (`L-1216C47A`). `aws-up` checks it before
  building anything.
- **CloudFront:** a new account may have to be verified by AWS Support before it can create a
  distribution. The **AWS edge** workflow says so in AWS's own words ("Your account must be verified
  before you can add new CloudFront resources"). Open a support case, and run the workflow again when
  AWS confirms.

### 5. The edge

1. GitHub → Actions → **AWS edge** → Run workflow, then approve `aws-demo`.
2. Its summary names the distribution's domain. Commit it as `NEXTAUTH_URL=https://<domain>` in
   `k8s/overlays/aws/kustomization.yaml`, the one place the address is written down.
   - `cluster-up` refuses to install when the two disagree.
   - While the platform is up behind the edge, the release job deploys every release to EKS too.

### 6. What depends on the edge's address

These are the runbook's §1, in [docs/DEMO_DAY.md](docs/DEMO_DAY.md):
- the second GitHub OAuth App (`AWS_GITHUB_ID` and `AWS_GITHUB_SECRET` in `.env`);
- Google's redirect URI;
- the second repository webhook, which reaches Jenkins through CloudFront;
- the Neon branch `demo`, schema only (`DEMO_DATABASE_URL` in `.env`).

## Each AWS day

Follow [docs/DEMO_DAY.md](docs/DEMO_DAY.md):
1. `npm run aws:secrets`, the day before;
2. **AWS up**, about two hours before;
3. **AWS verify**, after any fix;
4. **AWS down** in the evening. It also runs by itself at 23:30 IST.

## What it costs

| | |
|---|---|
| Between AWS days | Cents: the state bucket, and CloudFront with no traffic. |
| An AWS day of about 6 hours | About $3: EKS, three or four nodes, the NAT gateway, the load balancer and the volumes. |
| The budget | $15 a month, counted without credits. It emails at 50 %, 80 % and 100 %, and on the forecast. |

AWS's billing data lags 8 to 12 hours, so the budget can't notice a platform that was left up. The
nightly **AWS down** can, and it removes it.

## Checking the setup

- `npm run aws:secrets -- --check` names every key the platform needs, and anything missing in `.env`.
- The newest **Kind end-to-end** run tests the same platform on a GitHub runner, every night.
- **AWS up** checks the cluster, the edge and the delivery as it goes, and ends with **Verify the
  platform**: `k8s:verify` and `cd:verify` on EKS, through CloudFront.
