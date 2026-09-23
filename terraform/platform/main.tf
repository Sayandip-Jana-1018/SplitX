# The platform (terraform/platform): everything SplitX runs on AWS on a demo
# day, created by aws-up that morning and destroyed by aws-down that evening.
# The account layer it relies on is CloudFormation's (cloudformation/), and the
# edge that fronts it is terraform/edge, which stays.

provider "aws" {
  region = var.region

  default_tags {
    tags = local.tags
  }
}

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_availability_zones" "available" {
  state = "available"

  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition

  # On everything, including what the cluster's controllers create (their
  # configurations below), so the teardown's sweep and report can find it.
  tags = {
    project      = "splitx"
    stack        = "platform"
    "managed-by" = "terraform"
  }

  # splitx-ci-boundary (cloudformation/bootstrap.yaml): the CI roles may create
  # a role only if it carries this boundary, and only named splitx-eks-* or
  # splitx-wl-*. Every role below does both.
  boundary_arn = "arn:${local.partition}:iam::${local.account_id}:policy/splitx-ci-boundary"

  # Two zones: enough to show a spread, and half the subnets of three.
  azs = slice(data.aws_availability_zones.available.names, 0, 2)

  # Pinned, because the NetworkPolicies name the API server's service address
  # (the first in this range) and must not depend on what EKS picks.
  service_cidr = "172.20.0.0/16"

  # The GitHub OIDC roles and the laptop's user (cloudformation/bootstrap.yaml,
  # terraform/bootstrap), by their fixed names.
  deploy_role_arn   = "arn:${local.partition}:iam::${local.account_id}:role/splitx-ci-deploy"
  teardown_role_arn = "arn:${local.partition}:iam::${local.account_id}:role/splitx-ci-teardown"
  operator_user_arn = "arn:${local.partition}:iam::${local.account_id}:user/splitx-devops"

  # The alert topic in the splitx-guardrails stack, same region.
  alert_topic_arn = "arn:${local.partition}:sns:${var.region}:${local.account_id}:splitx-alerts"
}
