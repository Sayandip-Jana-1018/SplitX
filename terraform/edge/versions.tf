terraform {
  # As in terraform/platform: the workflows install exactly TERRAFORM_VERSION,
  # and state is locked by S3 itself.
  required_version = "~> 1.16"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.66.0"
    }
  }

  # Partial, like terraform/platform's: bucket and region come at init.
  backend "s3" {
    key          = "edge/terraform.tfstate"
    use_lockfile = true
    encrypt      = true
  }
}
