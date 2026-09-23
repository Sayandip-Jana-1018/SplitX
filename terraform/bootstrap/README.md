# Bootstrap identity — `splitx-devops`

Terraform needs AWS credentials before it can create anything, so the identity
it runs as cannot sensibly be managed by that same Terraform: a bad apply could
revoke the permissions needed to fix it, and destroying the stack would delete
the user running the destroy. This one identity is created by hand, once, and
this folder is its source of truth.

| | |
|---|---|
| IAM user | `arn:aws:iam::918183256068:user/splitx-devops` |
| Managed policy | `arn:aws:iam::918183256068:policy/splitx-devops-policy` |
| Document | [`splitx-devops-policy.json`](splitx-devops-policy.json) |

## Why this policy and not `AdministratorAccess`

- **IAM is scoped by name.** The user manages roles and policies only when their
  name starts with `splitx-`. A leaked key cannot touch anything else in the
  account, create IAM users or access keys, or read secrets outside `splitx/`.
- **No way to raise its own permissions** (version 2, 2026-09-23):
  - it may never publish a new version of `splitx-devops-policy`, or delete it;
  - every `splitx-*` role it creates must carry the permissions boundary
    `splitx-ci-boundary` (from the `splitx-bootstrap` stack), and no role's
    boundary can be removed. So a role it makes can't do more than the boundary
    allows, even with an administrator policy attached;
  - it may pass `splitx-*` roles only to EKS, EC2 and EKS Pod Identity.

  What remains, by design: it can edit the boundary itself, through the
  bootstrap stack. It is the one identity that manages SplitX's IAM.
- **CloudFormation only on `splitx-*` stacks.** `splitx-bootstrap` and
  `splitx-guardrails` are deployed with it (`npm run aws:bootstrap`).
- **S3 only on `splitx-*` buckets** (Terraform's state, CloudFront's logs),
  **SNS on `splitx-*` topics**, **Secrets Manager on `splitx/*` secrets**.
- **Service-level access** (`ec2`, `eks`, `elasticloadbalancing`, `autoscaling`,
  `cloudfront`, `logs`, `cloudwatch`, `kms`, `budgets`) is what an EKS, ALB and
  CloudFront platform needs, and their `Describe*` calls can't be narrowed to
  resource ARNs. ECR is gone: images come from GHCR.
- GitHub's OIDC provider and service-linked roles are allowed because keyless
  CI and EKS need them.

Verified on 2026-09-13 (version 1): `iam:ListUsers` is denied, `ec2:DescribeVpcs`
and the state bucket are allowed.

## Recreate from scratch

Run as an administrator (not as `splitx-devops`):

```bash
aws iam create-policy --policy-name splitx-devops-policy \
  --policy-document file://terraform/bootstrap/splitx-devops-policy.json
aws iam create-user --user-name splitx-devops
aws iam attach-user-policy --user-name splitx-devops \
  --policy-arn arn:aws:iam::918183256068:policy/splitx-devops-policy
```

Create the access key in the IAM console and enter it with `aws configure`;
never paste it into a file in this repository.

## Update the policy

Policies keep up to five versions. Publish a new default version:

```bash
aws iam create-policy-version --set-as-default \
  --policy-arn arn:aws:iam::918183256068:policy/splitx-devops-policy \
  --policy-document file://terraform/bootstrap/splitx-devops-policy.json
```

`splitx-devops` can't run this itself: version 2 of the policy denies it
changing its own permissions. Update it as the account's administrator, in the
console: IAM → Policies → `splitx-devops-policy` → Edit → JSON, paste this
file, then Next and Save changes.
