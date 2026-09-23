# Terraform: the platform and its edge

CloudFormation ([`cloudformation/`](../cloudformation)) makes the account layer once: Terraform's
state bucket, the two CI roles and their boundary, the budget. Terraform makes the rest.

| Root | Applied by | Lives | Holds |
|---|---|---|---|
| [`edge`](edge) | `aws-edge` once; `aws-up` points it at the platform, `aws-down` takes it offline | kept; costs nothing idle | CloudFront: HTTPS and a fixed address for the platform, the edge function, access logs |
| [`platform`](platform) | `aws-up`; destroyed by `aws-down` | one AWS day | the VPC, EKS and its add-ons, the nodes, the workloads' Pod Identity roles, the ALB's alarms |

[`bootstrap`](bootstrap) is not a root: it is the policy of `splitx-devops`, the IAM user that
deploys the CloudFormation stacks from the laptop.

- **Applied only by the workflows** in [`.github/workflows`](../.github/workflows), as
  `splitx-ci-deploy` (reviewed) or `splitx-ci-teardown` (can only remove), assumed with GitHub's OIDC
  token. Nothing is applied from a laptop.
- **State:** the `splitx-bootstrap` stack's bucket, one key per root, locked by S3 itself.
- **Checked on every push** by the CI job `terraform`: Trivy's misconfiguration checks (a gate),
  `terraform fmt`, `validate` with the committed lock files, and tflint with the AWS rules.
- **Pinned:** Terraform in [`.terraform-version`](.terraform-version), the AWS provider and every
  module to an exact version, the providers' checksums in each root's `.terraform.lock.hcl`, and the
  EKS add-ons in [`platform/cluster.tf`](platform/cluster.tf).

Why each choice was made: `docs/DECISIONS.md`, D-088 to D-090.
