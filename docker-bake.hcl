# ═══════════════════════════════════════════════════════════════
#   SplitX — image builds (docker buildx bake)
#
#   npm run image:build          the production image, with provenance
#   npm run image:report         naive vs production, measured
#   docker buildx bake --print   the resolved build definition
#
#   GIT_SHA / APP_VERSION / BUILD_DATE are supplied by
#   scripts/image-build.mjs from git and package.json.
# ═══════════════════════════════════════════════════════════════

variable "REGISTRY" {
  # e.g. "<account>.dkr.ecr.us-east-1.amazonaws.com/" or "ghcr.io/sayandip-jana-1018/"
  default = ""
}
variable "IMAGE" {
  default = "splitx"
}
variable "GIT_SHA" {
  default = "unknown"
}
variable "APP_VERSION" {
  default = "dev"
}
variable "BUILD_DATE" {
  default = "unknown"
}

group "default" {
  targets = ["app"]
}

target "_provenance" {
  args = {
    GIT_SHA     = GIT_SHA
    APP_VERSION = APP_VERSION
    BUILD_DATE  = BUILD_DATE
  }
}

# The image every environment runs: Compose, Kind, EKS.
target "app" {
  inherits   = ["_provenance"]
  context    = "."
  dockerfile = "Dockerfile"
  target     = "runner"
  platforms  = ["linux/amd64"]
  tags = [
    "${REGISTRY}${IMAGE}:${GIT_SHA}",
    "${REGISTRY}${IMAGE}:local",
  ]
}

# Registry pushes (CI): the same image plus a build provenance attestation and
# an SBOM stored next to it.
target "release" {
  inherits = ["app"]
  attest = [
    "type=provenance,mode=max",
    "type=sbom",
  ]
}

# Comparison exhibit only — see Dockerfile.naive.
target "naive" {
  context    = "."
  dockerfile = "Dockerfile.naive"
  platforms  = ["linux/amd64"]
  tags       = ["${IMAGE}:naive"]
}
