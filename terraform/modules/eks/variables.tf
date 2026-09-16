variable "cluster_name" { type = string }
variable "project_name" { type = string }
variable "environment" { type = string }
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "node_instance_type" { type = string }
variable "node_desired_count" { type = number }
variable "node_min_count" { type = number }
variable "node_max_count" { type = number }

# ── Kubernetes version ──
#
# 1.31 left standard support on 2025-11-26. AWS keeps an unsupported version
# running on extended support and charges six times as much for the control
# plane while it does, so an out-of-date pin is a cost decision as much as a
# security one. 1.35 is in standard support until 2027-03, and it is the same
# version the Kind rehearsal cluster runs (k8s/kind/cluster.yaml), so what is
# tested locally is what runs on EKS.
#
# Check before changing:
#   aws eks describe-cluster-versions --query 'clusterVersions[?versionStatus==`STANDARD_SUPPORT`]'
variable "kubernetes_version" {
  description = "EKS control plane version; must be in AWS standard support"
  type        = string
  default     = "1.35"

  validation {
    # A plain list rather than a regex: it dates itself, so a stale pin is
    # obvious in the error message instead of silently passing a pattern.
    condition     = contains(["1.34", "1.35", "1.36"], var.kubernetes_version)
    error_message = "Use an EKS version in AWS standard support. As of 2026-09-16 that is 1.34, 1.35 or 1.36."
  }
}
