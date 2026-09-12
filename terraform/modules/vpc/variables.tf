variable "project_name" { type = string }
variable "environment" { type = string }
variable "aws_region" { type = string }

variable "cluster_name" {
  description = "EKS cluster name used in the kubernetes.io/cluster/<name> subnet discovery tags"
  type        = string
}
