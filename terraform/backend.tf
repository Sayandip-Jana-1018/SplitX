# ═══════════════════════════════════════════════════════════════
#   SplitX — Terraform Backend Configuration
#
#   LOCAL BACKEND (active for demo — no AWS credentials needed)
#   Stores state in terraform.tfstate locally.
#
#   PRODUCTION S3 BACKEND (uncomment when deploying to real AWS):
#   terraform {
#     backend "s3" {
#       bucket         = "splitx-terraform-state-918183256068"
#       key            = "splitx/terraform.tfstate"
#       region         = "us-east-1"
#       use_lockfile   = true
#       encrypt        = true
#     }
#   }
# ═══════════════════════════════════════════════════════════════

terraform {
  backend "local" {
    path = "terraform.tfstate"
  }
}
