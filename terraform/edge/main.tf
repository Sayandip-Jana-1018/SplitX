# The edge (terraform/edge): SplitX's HTTPS front door, an API Gateway HTTP API
# (D-114). Applied once and kept: idle it costs nothing, and its
# *.execute-api address stays the same, so the OAuth callback, the GitHub
# webhook and the QR code are registered once. It gives the EKS platform HTTPS
# without a domain of our own (the app's session cookie is __Secure-, so it
# can't work over plain HTTP). aws-up points it at the platform's load balancer;
# aws-down takes its route away, and the address answers 404 until next time.
#
# It replaces the CloudFront distribution of D-089, which this account may not
# create until AWS verifies it: that request has waited since 2026-09-24.

provider "aws" {
  region = var.region

  default_tags {
    tags = local.tags
  }
}

locals {
  online = var.origin_domain != ""

  tags = {
    project      = "splitx"
    stack        = "edge"
    "managed-by" = "terraform"
  }
}

resource "aws_apigatewayv2_api" "edge" {
  name          = "splitx-edge"
  protocol_type = "HTTP"
  description   = "SplitX demo platform: HTTPS in front of the platform's load balancer (D-114)"
}

# Online only: every request, to the load balancer, over HTTP inside AWS. An
# ALB can only serve HTTPS for a domain it has a certificate for, and it has
# none; the load balancer's own rules refuse the internal paths (D-043).
resource "aws_apigatewayv2_integration" "platform" {
  count = local.online ? 1 : 0

  api_id             = aws_apigatewayv2_api.edge.id
  integration_type   = "HTTP_PROXY"
  integration_method = "ANY"
  integration_uri    = "http://${var.origin_domain}"
  # The most an HTTP API waits for an answer; the app's own are far shorter.
  timeout_milliseconds = 30000

  request_parameters = {
    # The path the visitor asked for; the query string travels with it.
    "overwrite:path" = "$request.path"
    # The value that tells the app this request came through its own edge
    # (src/proxy.ts, D-092). API Gateway replaces any header of that name a
    # visitor sends.
    "overwrite:header.x-origin-verify" = var.origin_secret
  }
}

resource "aws_apigatewayv2_route" "platform" {
  count = local.online ? 1 : 0

  api_id    = aws_apigatewayv2_api.edge.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.platform[0].id}"
}

# Accepted (Trivy AWS-0001): no access log. CloudWatch Logs would bill for a
# log nobody reads between AWS days; on an AWS day the load balancer's metrics
# and the app's own logs (Loki) cover every request.
#trivy:ignore:AWS-0001
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.edge.id
  name        = "$default"
  auto_deploy = true

  # Room for a classroom opening the site at once (each page fetches its
  # scripts and styles) and the traffic lab's 30 plans a second. It is also the
  # most a flood of requests could cost: about $2 an hour at $1 a million.
  default_route_settings {
    throttling_burst_limit = 1000
    throttling_rate_limit  = 500
  }
}
