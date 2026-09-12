# ═══════════════════════════════════════════════════════════════
#   SplitX — Root Terraform Configuration
#   Composes all infrastructure modules
# ═══════════════════════════════════════════════════════════════

locals {
  # Single source of truth: the subnet discovery tags and the cluster itself
  # must agree, or the AWS Load Balancer Controller ignores the subnets.
  cluster_name = "${var.project_name}-eks-${var.environment}"
}

# ── VPC Module ──
module "vpc" {
  source       = "./modules/vpc"
  project_name = var.project_name
  environment  = var.environment
  aws_region   = var.aws_region
  cluster_name = local.cluster_name
}

# ── ECR Module (Docker Image Registry) ──
module "ecr" {
  source       = "./modules/ecr"
  project_name = var.project_name
  environment  = var.environment
}

# ── EKS Module (Kubernetes Cluster) ──
module "eks" {
  source             = "./modules/eks"
  cluster_name       = local.cluster_name
  project_name       = var.project_name
  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  node_instance_type = var.eks_node_instance_type
  node_desired_count = var.eks_node_desired_count
  node_min_count     = var.eks_node_min_count
  node_max_count     = var.eks_node_max_count
}
