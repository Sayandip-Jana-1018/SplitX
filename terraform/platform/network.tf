module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "6.7.3"

  name = var.cluster_name
  cidr = "10.0.0.0/16"
  azs  = local.azs

  # Nodes and pods live in the private subnets (the VPC CNI gives every pod a
  # VPC address, hence /19s). Only the load balancer and the NAT gateway sit in
  # the public ones.
  private_subnets = ["10.0.0.0/19", "10.0.32.0/19"]
  public_subnets  = ["10.0.64.0/24", "10.0.65.0/24"]

  # One NAT gateway, not one per zone: half the cost for a platform that lives
  # a day. The price: if its zone fails, the other zone's nodes lose egress.
  enable_nat_gateway = true
  single_nat_gateway = true

  # How the AWS Load Balancer Controller finds its subnets.
  public_subnet_tags  = { "kubernetes.io/role/elb" = "1" }
  private_subnet_tags = { "kubernetes.io/role/internal-elb" = "1" }

  # The default security group loses its rules (the module's default); the
  # default network ACL stays as AWS makes it. Security groups and the
  # cluster's NetworkPolicies are what filter traffic here.
  manage_default_network_acl = false

  # Every accepted and rejected flow, to CloudWatch Logs, kept one day, in
  # one-minute batches so they can be queried while the demo runs. The role
  # the flow-logs service assumes is named and bounded like every other role
  # (the deploy role may pass it to vpc-flow-logs.amazonaws.com only).
  enable_flow_log                                 = true
  create_flow_log_cloudwatch_log_group            = true
  create_flow_log_cloudwatch_iam_role             = true
  flow_log_cloudwatch_log_group_name_prefix       = "/aws/vpc-flow-logs/"
  flow_log_cloudwatch_log_group_name_suffix       = var.cluster_name
  flow_log_cloudwatch_log_group_retention_in_days = 1
  flow_log_max_aggregation_interval               = 60
  vpc_flow_log_iam_role_name                      = "splitx-eks-vpc-flow-logs"
  vpc_flow_log_iam_role_use_name_prefix           = false
  vpc_flow_log_iam_policy_name                    = "splitx-eks-vpc-flow-logs"
  vpc_flow_log_iam_policy_use_name_prefix         = false
  vpc_flow_log_permissions_boundary               = local.boundary_arn
  flow_log_cloudwatch_iam_role_conditions = [
    {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    },
    {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:${local.partition}:ec2:${var.region}:${local.account_id}:vpc-flow-log/*"]
    },
  ]

  tags = local.tags
}
