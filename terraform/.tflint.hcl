# tflint for terraform/edge and terraform/platform (CI job "terraform").
# The Terraform rules come with tflint; the AWS rules are a plugin, pinned, and
# downloaded by `tflint --init`.

config {
  format = "compact"
  # Registry modules are checked by their own authors; this checks our code
  # and what we pass them.
  call_module_type = "none"
}

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

plugin "aws" {
  enabled = true
  version = "0.49.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}
