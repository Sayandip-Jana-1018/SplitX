terraform {
  # The workflows install exactly TERRAFORM_VERSION (.github/workflows). S3's
  # own state locking (use_lockfile) needs 1.10 or later, so there is no
  # DynamoDB table to pay for or to forget.
  required_version = "~> 1.16"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.66.0"
    }
  }

  # Partial: the bucket's name contains the account ID, so it is never
  # committed. The workflows pass bucket and region at init
  # (-backend-config), following the splitx-bootstrap stack's name for it:
  # splitx-tfstate-<account>-<region>. CI validates with init -backend=false.
  backend "s3" {
    key          = "platform/terraform.tfstate"
    use_lockfile = true
    encrypt      = true
  }
}
