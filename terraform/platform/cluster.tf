# Accepted, each with its reason (docs/DECISIONS.md, D-089):
# - Trivy AWS-0040, AWS-0041: the API server's endpoint is public and open to
#   any address. aws-up and aws-down run on GitHub-hosted runners, which have
#   no fixed addresses (GitHub publishes thousands of ranges; EKS allows 40),
#   and the laptop's address is shared (B-026). Reaching the endpoint is not
#   access: authentication_mode is API, so only the three IAM identities in
#   access_entries can do anything, and the cluster exists for a day.
# - Trivy AWS-0039: no customer-managed key for Kubernetes secrets. Since
#   2025-03-05 EKS envelope-encrypts all Kubernetes API data (1.28 and later)
#   with an AWS-owned key at no charge. A key of our own costs every month and
#   lingers 7 to 30 days after deletion, which a daily platform can't use.
# - Trivy AWS-0104: the nodes' security group allows egress anywhere. Nodes
#   pull images from GHCR, Docker Hub and ECR, and the app reaches Neon, GitHub
#   and Sigstore, all through the NAT gateway. Inside the cluster, egress is
#   limited per pod by NetworkPolicies (D-040), which the VPC CNI enforces.
#trivy:ignore:AWS-0039
#trivy:ignore:AWS-0040
#trivy:ignore:AWS-0041
#trivy:ignore:AWS-0104
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "21.26.0"

  name               = var.cluster_name
  kubernetes_version = var.kubernetes_version

  vpc_id            = module.vpc.vpc_id
  subnet_ids        = module.vpc.private_subnets
  service_ipv4_cidr = local.service_cidr

  endpoint_public_access  = true
  endpoint_private_access = true

  # ── Who may use the cluster: access entries, no aws-auth ConfigMap ──
  authentication_mode = "API"
  # No OIDC provider for IRSA: the boundary forbids creating one, and
  # workloads get AWS credentials through EKS Pod Identity (workloads.tf).
  enable_irsa = false
  # Explicit entries instead of "whoever ran Terraform", so destroy by the
  # teardown role never changes who the entries are for.
  enable_cluster_creator_admin_permissions = false
  access_entries = {
    # aws-up: installs the platform's charts and manifests.
    ci_deploy = {
      principal_arn = local.deploy_role_arn
      policy_associations = {
        admin = {
          policy_arn   = "arn:${local.partition}:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
          access_scope = { type = "cluster" }
        }
      }
    }
    # aws-down: may only list and delete what holds AWS resources (Ingresses,
    # load-balancer Services, namespaces with their volumes). Its Kubernetes
    # group is bound to a delete-only ClusterRole in k8s/eks.
    ci_teardown = {
      principal_arn     = local.teardown_role_arn
      kubernetes_groups = ["splitx-teardown"]
    }
    # The laptop's IAM user, for looking and fixing on an AWS day. It could add
    # itself anyway (its policy allows eks:*), so this saves a step and grants
    # nothing new.
    operator = {
      principal_arn = local.operator_user_arn
      policy_associations = {
        admin = {
          policy_arn   = "arn:${local.partition}:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
          access_scope = { type = "cluster" }
        }
      }
    }
  }

  # ── No KMS key (see AWS-0039 above) ──
  create_kms_key    = false
  encryption_config = null

  # ── Control-plane logs: all five kinds, kept one day ──
  # Terraform owns the log group, so destroy removes it with the cluster.
  enabled_log_types                      = ["api", "audit", "authenticator", "controllerManager", "scheduler"]
  create_cloudwatch_log_group            = true
  cloudwatch_log_group_retention_in_days = 1

  # ── Names the boundary accepts, and the boundary itself ──
  iam_role_name                       = "splitx-eks-cluster"
  iam_role_use_name_prefix            = false
  iam_role_permissions_boundary       = local.boundary_arn
  security_group_name                 = "splitx-eks-cluster"
  security_group_use_name_prefix      = false
  node_security_group_name            = "splitx-eks-node"
  node_security_group_use_name_prefix = false

  # ── Add-ons, pinned to the versions EKS offered for 1.35 on 2026-09-23 ──
  # (aws eks describe-addon-versions --kubernetes-version 1.35 --addon-name ...)
  # The VPC CNI and the Pod Identity agent come before the nodes; the rest
  # after, once there are nodes to run them.
  addons = {
    vpc-cni = {
      before_compute = true
      addon_version  = "v1.23.1-eksbuild.1"
      configuration_values = jsonencode({
        # Without this, every NetworkPolicy in the cluster is silently ignored.
        enableNetworkPolicy = "true"
        env = {
          # The CNI's network interfaces carry the platform's tags, so the
          # teardown's sweep can find any it leaves behind.
          ADDITIONAL_ENI_TAGS = jsonencode(local.tags)
        }
      })
    }
    eks-pod-identity-agent = {
      before_compute = true
      addon_version  = "v1.4.0-eksbuild.2"
    }
    kube-proxy = {
      addon_version = "v1.35.3-eksbuild.29"
    }
    coredns = {
      addon_version = "v1.14.6-eksbuild.4"
    }
    aws-ebs-csi-driver = {
      addon_version = "v1.66.0-eksbuild.1"
      pod_identity_association = [{
        role_arn        = module.ebs_csi_identity.iam_role_arn
        service_account = "ebs-csi-controller-sa"
      }]
      configuration_values = jsonencode({
        # The add-on's own default StorageClass can't be encrypted; k8s/eks
        # makes an encrypted gp3 one the default instead.
        defaultStorageClass = { enabled = false }
        controller = {
          extraVolumeTags = local.tags
        }
      })
    }
    # Replaces Kind's metrics-server, which needs --kubelet-insecure-tls (B-023):
    # EKS kubelets serve certificates the cluster trusts.
    metrics-server = {
      addon_version = "v0.9.0-eksbuild.11"
    }
  }

  # ── The nodes ──
  eks_managed_node_groups = {
    general = {
      name            = "splitx-general"
      use_name_prefix = false

      ami_type       = "AL2023_x86_64_STANDARD"
      instance_types = [var.node_instance_type]
      capacity_type  = "ON_DEMAND"

      # The Cluster Autoscaler moves the desired size between these; the
      # module ignores desired_size after creation, so a later apply never
      # undoes a scale-up. EKS tags the group's Auto Scaling group for the
      # autoscaler's discovery itself.
      min_size     = var.node_min_size
      max_size     = var.node_max_size
      desired_size = var.node_min_size

      iam_role_name                 = "splitx-eks-node"
      iam_role_use_name_prefix      = false
      iam_role_permissions_boundary = local.boundary_arn

      launch_template_name            = "splitx-eks-node"
      launch_template_use_name_prefix = false

      # 30 GiB: images for the app, Jenkins, monitoring and Nexus, cached.
      block_device_mappings = {
        root = {
          device_name = "/dev/xvda"
          ebs = {
            volume_size           = 30
            volume_type           = "gp3"
            encrypted             = true
            delete_on_termination = true
          }
        }
      }

      # One node at a time when the group changes.
      update_config = {
        max_unavailable = 1
      }
    }
  }

  tags = local.tags
}
