# What the next steps of aws-up read (Phase 5): the charts need the region and
# the VPC (the nodes can't ask the instance metadata service: its hop limit is
# 1, so pods never reach it), and the NetworkPolicies need the address ranges.

output "cluster_name" {
  description = "The EKS cluster (aws eks update-kubeconfig --name ...)."
  value       = module.eks.cluster_name
}

output "region" {
  description = "Where the platform runs."
  value       = var.region
}

output "kubernetes_version" {
  description = "The control plane's version."
  value       = module.eks.cluster_version
}

output "vpc_id" {
  description = "For the AWS Load Balancer Controller's vpcId."
  value       = module.vpc.vpc_id
}

output "vpc_cidr" {
  description = "The whole network."
  value       = module.vpc.vpc_cidr_block
}

output "public_subnet_cidrs" {
  description = "Where the ALB's addresses are: the only sources allowed to reach the app's pods from outside the cluster."
  value       = module.vpc.public_subnets_cidr_blocks
}

output "private_subnet_cidrs" {
  description = "The nodes and pods, including the kubelets that probe pods."
  value       = module.vpc.private_subnets_cidr_blocks
}

output "service_cidr" {
  description = "Kubernetes service addresses; the API server's is the first."
  value       = local.service_cidr
}

output "node_security_group_id" {
  description = "The nodes' (and pods') security group."
  value       = module.eks.node_security_group_id
}

output "alb_alarms" {
  description = "The load balancer's alarms, once alb_ready is true."
  value       = concat(aws_cloudwatch_metric_alarm.app_errors[*].alarm_name, aws_cloudwatch_metric_alarm.edge_errors[*].alarm_name)
}
