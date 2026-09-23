# CloudFormation: the account layer

Terraform builds SplitX's platform (the network, EKS, the load balancer, CloudFront),
but it needs a few things to exist before it can run at all. CloudFormation makes
those, in two stacks deployed once from the laptop as `splitx-devops`
([`terraform/bootstrap`](../terraform/bootstrap)), and they stay.

| Stack | Template | What it holds |
|---|---|---|
| `splitx-bootstrap` | [`bootstrap.yaml`](bootstrap.yaml) | Terraform's state bucket (versioned, encrypted, TLS only, never public). GitHub's OIDC provider, so workflows reach AWS without stored keys. The role `splitx-ci-deploy`, which only jobs in the GitHub environment `aws-demo` may assume, for at most 3 hours. The boundary `splitx-ci-boundary`, which every role it creates must carry. |
| `splitx-guardrails` | [`guardrails.yaml`](guardrails.yaml) | A $15 monthly budget counted without credits, with alerts at 50%, 80% and 100% and on the forecast, sent to the SNS topic `splitx-alerts`, which emails the owner. |

The boundary is what keeps the deploy role from growing:
- no IAM changes except to `splitx-eks-*` and `splitx-wl-*` roles and policies;
- nothing at all to `splitx-ci-*`;
- every new role carries this same boundary, and none loses it.

```bash
npm run aws:bootstrap -- --plan   # the change sets, without running them
npm run aws:bootstrap             # deploy both (BUDGET_EMAIL in .env)
```

Every push and pull request lints both templates in CI (`cfn-lint`, then Trivy's
misconfiguration checks). Every deploy goes through a change set.
