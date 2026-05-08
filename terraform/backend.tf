# ═══════════════════════════════════════════════════════════════
#   SplitX — Terraform Remote State Backend
#   Store state in S3 with DynamoDB locking
#   NOTE: Create the S3 bucket and DynamoDB table first with:
#     aws s3 mb s3://splitx-terraform-state-918183256068
#     aws dynamodb create-table --table-name splitx-terraform-lock \
#       --attribute-definitions AttributeName=LockID,AttributeType=S \
#       --key-schema AttributeName=LockID,KeyType=HASH \
#       --billing-mode PAY_PER_REQUEST
# ═══════════════════════════════════════════════════════════════

terraform {
  backend "s3" {
    bucket         = "splitx-terraform-state-918183256068"
    key            = "splitx/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "splitx-terraform-lock"
    encrypt        = true
  }
}
