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

- **IAM is scoped by name.** The user can create, attach and pass roles and
  policies only when their name starts with `splitx-`
  (`arn:aws:iam::918183256068:role/splitx-*`). A leaked key cannot mint an admin
  role for itself or modify anything else in the account.
- **S3 is scoped to `splitx-*` buckets** — the Terraform state bucket and the
  CloudFront asset bucket.
- **Service-level access** (`ec2`, `eks`, `ecr`, `elasticloadbalancing`,
  `cloudfront`, `logs`, `cloudwatch`, `kms`, `autoscaling`) is what an EKS +
  ALB + CloudFront stack genuinely needs; Terraform's `Describe*` calls cannot be
  narrowed to resource ARNs.
- OIDC providers (for IRSA and GitHub Actions) and service-linked roles are
  allowed because EKS cannot run without them.

Verified on 2026-09-13: `iam:ListUsers` is denied, `ec2:DescribeVpcs` and the
state bucket are allowed.

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
