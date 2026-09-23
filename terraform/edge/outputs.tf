output "domain_name" {
  description = "The site's address (https://<this>): NEXTAUTH_URL and the Ingress host in k8s/overlays/aws, the OAuth callbacks, and the GitHub webhook."
  value       = aws_cloudfront_distribution.edge.domain_name
}

output "distribution_id" {
  description = "For aws cloudfront wait distribution-deployed, and for /ops."
  value       = aws_cloudfront_distribution.edge.id
}

output "mode" {
  description = "online while the edge forwards to the platform's load balancer, offline while it answers with its offline page."
  value       = local.online ? "online" : "offline"
}

output "origin_domain" {
  description = "The load balancer the edge forwards to; empty while offline. aws-edge passes it back unchanged, so applying the edge never flips its mode."
  value       = var.origin_domain
}
