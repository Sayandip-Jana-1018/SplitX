output "domain_name" {
  description = "The site's address (https://<this>): NEXTAUTH_URL in k8s/overlays/aws, the OAuth callback, and the GitHub webhook."
  value       = trimprefix(aws_apigatewayv2_api.edge.api_endpoint, "https://")
}

output "api_id" {
  description = "The HTTP API's ID, for /ops."
  value       = aws_apigatewayv2_api.edge.id
}

output "mode" {
  description = "online while the edge forwards to the platform's load balancer, offline while it has no route and answers 404."
  value       = local.online ? "online" : "offline"
}

output "origin_domain" {
  description = "The load balancer the edge forwards to; empty while offline. aws-edge passes it back unchanged, so applying the edge never flips its mode."
  value       = var.origin_domain
}
