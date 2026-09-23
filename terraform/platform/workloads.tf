# AWS credentials for the cluster's workloads, through EKS Pod Identity: each
# role trusts pods.eks.amazonaws.com and is bound to one service account, so no
# pod holds a key and none can borrow another's role. Every role and its policy
# is named splitx-wl-* (the module would otherwise name policies AmazonEKS_*,
# which the boundary refuses) and carries the boundary.
#
# The service accounts are the ones Phase 5's charts and manifests create; a
# name changed there must change here.

locals {
  demo_secrets_arn = "arn:${local.partition}:secretsmanager:${var.region}:${local.account_id}:secret:splitx/demo/*"
}

# The AWS Load Balancer Controller turns the Ingresses into the ALB.
module "alb_controller_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "2.9.0"

  name                     = "splitx-wl-alb-controller"
  use_name_prefix          = false
  permissions_boundary_arn = local.boundary_arn

  attach_aws_lb_controller_policy = true
  aws_lb_controller_policy_name   = "splitx-wl-alb-controller"

  associations = {
    controller = {
      cluster_name    = module.eks.cluster_name
      namespace       = "kube-system"
      service_account = "aws-load-balancer-controller"
    }
  }

  tags = local.tags
}

# The EBS CSI driver makes, attaches and deletes the volumes behind PVCs. Its
# add-on (cluster.tf) binds this role to its own service account.
module "ebs_csi_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "2.9.0"

  name                     = "splitx-wl-ebs-csi"
  use_name_prefix          = false
  permissions_boundary_arn = local.boundary_arn

  attach_aws_ebs_csi_policy = true
  aws_ebs_csi_policy_name   = "splitx-wl-ebs-csi"

  tags = local.tags
}

# The Cluster Autoscaler adds the fourth node when pods can't be placed, and
# removes it when it is empty. Only this cluster's node groups.
module "cluster_autoscaler_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "2.9.0"

  name                     = "splitx-wl-cluster-autoscaler"
  use_name_prefix          = false
  permissions_boundary_arn = local.boundary_arn

  attach_cluster_autoscaler_policy = true
  cluster_autoscaler_policy_name   = "splitx-wl-cluster-autoscaler"
  cluster_autoscaler_cluster_names = [module.eks.cluster_name]

  associations = {
    autoscaler = {
      cluster_name    = module.eks.cluster_name
      namespace       = "kube-system"
      service_account = "cluster-autoscaler"
    }
  }

  tags = local.tags
}

# The External Secrets Operator turns splitx/demo/* in Secrets Manager (copied
# from .env by npm run aws:secrets) into Kubernetes Secrets. It reads those
# secrets and no others.
module "external_secrets_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "2.9.0"

  name                     = "splitx-wl-external-secrets"
  use_name_prefix          = false
  permissions_boundary_arn = local.boundary_arn

  attach_external_secrets_policy        = true
  external_secrets_policy_name          = "splitx-wl-external-secrets"
  external_secrets_secrets_manager_arns = [local.demo_secrets_arn]

  associations = {
    operator = {
      cluster_name    = module.eks.cluster_name
      namespace       = "external-secrets"
      service_account = "external-secrets"
    }
  }

  tags = local.tags
}

# ops-api reads the account layer and the platform for the /ops control room:
# read only, and never Cost Explorer, which charges $0.01 for every call.
module "ops_api_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "2.9.0"

  name                     = "splitx-wl-ops-api"
  use_name_prefix          = false
  permissions_boundary_arn = local.boundary_arn

  attach_custom_policy      = true
  custom_policy_description = "Read-only view of SplitX's stacks, cluster, edge and budget for /ops."
  policy_statements = [
    {
      sid = "Stacks"
      actions = [
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackResources",
        "cloudformation:DescribeStackDriftDetectionStatus",
        "cloudformation:DescribeStackResourceDrifts",
      ]
      resources = ["arn:${local.partition}:cloudformation:${var.region}:${local.account_id}:stack/splitx-*/*"]
    },
    {
      sid = "Cluster"
      actions = [
        "eks:DescribeCluster",
        "eks:ListNodegroups",
        "eks:DescribeNodegroup",
        "eks:ListAddons",
        "eks:DescribeAddon",
      ]
      resources = [
        module.eks.cluster_arn,
        "arn:${local.partition}:eks:${var.region}:${local.account_id}:nodegroup/${var.cluster_name}/*",
        "arn:${local.partition}:eks:${var.region}:${local.account_id}:addon/${var.cluster_name}/*",
      ]
    },
    {
      # CloudFront's read actions can't be narrowed to one distribution.
      sid       = "Edge"
      actions   = ["cloudfront:GetDistribution", "cloudfront:ListDistributions"]
      resources = ["*"]
    },
    {
      sid       = "Budget"
      actions   = ["budgets:ViewBudget"]
      resources = ["arn:${local.partition}:budgets::${local.account_id}:budget/splitx-monthly"]
    },
    {
      sid       = "NeverCostExplorer"
      effect    = "Deny"
      actions   = ["ce:*"]
      resources = ["*"]
    },
  ]

  associations = {
    api = {
      cluster_name    = module.eks.cluster_name
      namespace       = "ops"
      service_account = "ops-api"
    }
  }

  tags = local.tags
}
