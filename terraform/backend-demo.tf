# ═══════════════════════════════════════════════════════════════
#   SplitX — LOCAL Backend for Demo/Development
#   Use this instead of backend.tf when S3 is not configured.
#
#   To activate for demo:
#     terraform init -backend-config=backend-demo.tf -reconfigure
#
#   This stores terraform.tfstate locally - safe for demo only.
# ═══════════════════════════════════════════════════════════════
