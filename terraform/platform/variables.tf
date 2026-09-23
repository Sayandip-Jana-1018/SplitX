variable "region" {
  description = "Where the platform runs: the splitx-bootstrap stack's region, which the state bucket's name and the CI roles' region lock both use."
  type        = string
  default     = "ap-south-1"
}

variable "cluster_name" {
  description = "The EKS cluster's name. cloudformation/bootstrap.yaml (ClusterName) lets the teardown role delete this cluster and its logs, and no other."
  type        = string
  default     = "splitx"
}

# 1.35 is the version the Kind rehearsal cluster runs (k8s/kind/cluster.yaml),
# so what is tested there is what runs here. A version past standard support
# moves to extended support, which costs six times as much per hour.
# Check before changing:
#   aws eks describe-cluster-versions --query 'clusterVersions[?versionStatus==`STANDARD_SUPPORT`]'
variable "kubernetes_version" {
  description = "EKS control plane version; must be in AWS standard support."
  type        = string
  default     = "1.35"

  validation {
    # A list, not a pattern: it dates itself, so a stale pin shows in the error.
    condition     = contains(["1.34", "1.35", "1.36"], var.kubernetes_version)
    error_message = "Use an EKS version in standard support. On 2026-09-23 that is 1.34 (until 2026-12-02), 1.35 (2027-03-27) or 1.36 (2027-08-02)."
  }
}

variable "node_instance_type" {
  description = "Worker instance type. t3.large has 2 vCPUs and 8 GiB, enough for the app, Jenkins, monitoring and Nexus across three nodes."
  type        = string
  default     = "t3.large"
}

variable "node_min_size" {
  description = "Nodes the group never goes below; it starts here."
  type        = number
  default     = 3
}

variable "node_max_size" {
  description = "Nodes the Cluster Autoscaler may reach. The fourth is the traffic lab's node-scaling moment; 4 x t3.large need 8 vCPUs of quota."
  type        = number
  default     = 4

  validation {
    condition     = var.node_max_size <= 4
    error_message = "More than 4 nodes is outside the approved budget (and the account's 8-vCPU plan)."
  }
}

variable "alb_ready" {
  description = "true once the Ingress has made its load balancer: aws-up sets it on a second apply, which adds the load balancer's alarms. The balancer is made at run time by the AWS Load Balancer Controller, so it can't exist on the first plan."
  type        = bool
  default     = false
}
