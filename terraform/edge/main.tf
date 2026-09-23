# The edge (terraform/edge): SplitX's CloudFront distribution. Applied once and
# kept: idle it costs nothing, and its *.cloudfront.net address stays the same,
# so the OAuth callbacks, the GitHub webhook and the QR code are registered
# once. It gives the EKS platform HTTPS without a domain of our own (the app's
# session cookie is __Secure-, so it can't work over plain HTTP), and caches
# the app's build assets. aws-up points it at the platform's load balancer;
# aws-down switches it back to its offline page.

provider "aws" {
  region = var.region

  default_tags {
    tags = local.tags
  }
}

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  online     = var.origin_domain != ""

  tags = {
    project      = "splitx"
    stack        = "edge"
    "managed-by" = "terraform"
  }
}

# ── Where CloudFront's access logs go: a week, then gone ──────────
resource "aws_s3_bucket" "logs" {
  bucket        = "splitx-edge-logs-${local.account_id}-${var.region}"
  force_destroy = true
}

# CloudFront's standard logs arrive with an ACL grant, so ACLs stay enabled on
# this bucket (and on no other).
resource "aws_s3_bucket_ownership_controls" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket                  = aws_s3_bucket.logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Accepted (Trivy AWS-0132): S3's own keys, not a customer-managed key, which
# would cost every month for access logs that are private and kept 7 days.
#trivy:ignore:AWS-0132
resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "logs" {
  bucket = aws_s3_bucket.logs.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    id     = "one-week"
    status = "Enabled"

    filter {}

    expiration {
      days = 7
    }

    noncurrent_version_expiration {
      noncurrent_days = 1
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_policy" "logs" {
  bucket = aws_s3_bucket.logs.id
  policy = data.aws_iam_policy_document.tls_only["logs"].json

  depends_on = [aws_s3_bucket_public_access_block.logs]
}

# ── The origin while the platform is down ─────────────────────────
# A distribution always needs an origin, and CloudFront requires it to be a
# real, resolvable name. This empty, private bucket is one SplitX owns, so the
# name can never be claimed by anyone else. The edge function answers every
# request while the platform is down, so CloudFront never actually asks it.
resource "aws_s3_bucket" "offline" {
  bucket        = "splitx-edge-offline-${local.account_id}-${var.region}"
  force_destroy = true
}

resource "aws_s3_bucket_ownership_controls" "offline" {
  bucket = aws_s3_bucket.offline.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "offline" {
  bucket                  = aws_s3_bucket.offline.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Accepted (Trivy AWS-0132): as for the logs bucket; this one holds nothing.
#trivy:ignore:AWS-0132
resource "aws_s3_bucket_server_side_encryption_configuration" "offline" {
  bucket = aws_s3_bucket.offline.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "offline" {
  bucket = aws_s3_bucket.offline.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_policy" "offline" {
  bucket = aws_s3_bucket.offline.id
  policy = data.aws_iam_policy_document.tls_only["offline"].json

  depends_on = [aws_s3_bucket_public_access_block.offline]
}

# Both buckets refuse any request that isn't over TLS.
data "aws_iam_policy_document" "tls_only" {
  for_each = {
    logs    = aws_s3_bucket.logs.arn
    offline = aws_s3_bucket.offline.arn
  }

  statement {
    sid       = "TlsOnly"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [each.value, "${each.value}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

# ── The edge function ─────────────────────────────────────────────
# Online it refuses /api/metrics and /api/health/ready (D-043); offline it
# answers everything with a 503 page (edge.js.tftpl).
resource "aws_cloudfront_function" "edge" {
  name    = "splitx-edge"
  runtime = "cloudfront-js-2.0"
  comment = "SplitX: refuses the cluster's internal paths; answers for the site while the platform is down"
  publish = true
  code    = templatefile("${path.module}/edge.js.tftpl", { online = local.online })
}

# ── What reaches the origin, and what is cached ───────────────────
data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

# Everything the viewer sent, the Host header included: the app builds its
# redirects and sign-in callbacks from it, and the load balancer's rules route
# on it.
data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewer"
}

# Build assets vary by nothing but their path; only Host is forwarded, for the
# load balancer's rules.
resource "aws_cloudfront_origin_request_policy" "host_only" {
  name    = "splitx-host-only"
  comment = "SplitX build assets: only the Host header reaches the origin"

  cookies_config {
    cookie_behavior = "none"
  }

  headers_config {
    header_behavior = "whitelist"

    headers {
      items = ["Host"]
    }
  }

  query_strings_config {
    query_string_behavior = "none"
  }
}

# ── The distribution ──────────────────────────────────────────────
# Accepted (Trivy AWS-0011): no AWS WAF. A web ACL costs $5 a month plus $1 per
# rule even while idle. The app limits requests itself, per signed-in user,
# device and network (D-022, D-045), and the edge function refuses the internal
# paths.
#trivy:ignore:AWS-0011
resource "aws_cloudfront_distribution" "edge" {
  enabled         = true
  comment         = "SplitX demo platform"
  http_version    = "http2and3"
  is_ipv6_enabled = true
  # Europe, North America and Asia, India included: the classroom is in India.
  price_class = "PriceClass_200"
  # A change reaches every edge location in a few minutes; the workflows wait
  # for it only when they need to.
  wait_for_deployment = false

  origin {
    origin_id   = "platform"
    domain_name = local.online ? var.origin_domain : aws_s3_bucket.offline.bucket_regional_domain_name

    # CloudFront to the ALB over HTTP, inside AWS's network: an ALB can only
    # serve HTTPS for a domain it has a certificate for, and it has none.
    # Phase 5 allows only CloudFront's addresses to reach it.
    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "http-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 60
    }
  }

  # The app: nothing cached, everything forwarded.
  default_cache_behavior {
    target_origin_id         = "platform"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.edge.arn
    }
  }

  # Next.js build assets: their names change with their content, so they are
  # cached at the edge (x-cache: Hit from cloudfront).
  ordered_cache_behavior {
    path_pattern             = "/_next/static/*"
    target_origin_id         = "platform"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = data.aws_cloudfront_cache_policy.optimized.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.host_only.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.edge.arn
    }
  }

  # GitHub's deployment webhook to Jenkins: POST, never cached, with its
  # signature and event headers and the trigger token in the query string.
  # Jenkins checks the HMAC signature, the token and GitHub's newest
  # deployment (D-056); no address filter, since GitHub's hook addresses are
  # shared by every GitHub user.
  ordered_cache_behavior {
    path_pattern             = "/generic-webhook-trigger/*"
    target_origin_id         = "platform"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = false
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.edge.arn
    }
  }

  logging_config {
    bucket          = aws_s3_bucket.logs.bucket_domain_name
    prefix          = "cloudfront/"
    include_cookies = false
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # The *.cloudfront.net certificate: HTTPS without a domain of our own.
  viewer_certificate {
    cloudfront_default_certificate = true
  }

  # Standard logs need the bucket's ACLs enabled first.
  depends_on = [aws_s3_bucket_ownership_controls.logs]
}
