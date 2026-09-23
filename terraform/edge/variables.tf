variable "region" {
  description = "Where the edge's buckets live: the splitx-bootstrap stack's region. CloudFront itself is global."
  type        = string
  default     = "ap-south-1"
}

variable "origin_domain" {
  description = "The platform's load balancer (its DNS name) while the platform is up; empty while it is down. aws-up sets it once the Ingress has an address, and aws-down applies without it, which takes the site offline."
  type        = string
  default     = ""

  validation {
    # Only an AWS load balancer, so a typo can never send the site's visitors,
    # and their cookies, to someone else's server.
    condition     = var.origin_domain == "" || can(regex("^[a-z0-9-]+\\.[a-z0-9-]+\\.elb\\.amazonaws\\.com$", var.origin_domain))
    error_message = "origin_domain must be empty (offline) or an ALB's DNS name (<name>.<region>.elb.amazonaws.com)."
  }
}
