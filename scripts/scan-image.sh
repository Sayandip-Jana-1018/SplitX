#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#   SplitX — image vulnerability scan (Trivy)
#
#   ./scripts/scan-image.sh [image]            default: splitx:local
#   SEVERITY=CRITICAL ./scripts/scan-image.sh  gate on critical only
#   IGNORE_UNFIXED=false ./scripts/scan-image.sh   include what has no fix yet
#
#   Trivy runs as a container pinned by digest — nothing to install, and a
#   tampered scanner image can't slip in (the project's releases were
#   compromised once in 2026). The vulnerability database is cached in a
#   Docker volume, so repeat scans don't re-download it.
#
#   Exits non-zero when the image has vulnerabilities at or above SEVERITY
#   that already have a fix, which is what a pipeline should block on.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

IMAGE=${1:-splitx:local}
SEVERITY=${SEVERITY:-HIGH,CRITICAL}
IGNORE_UNFIXED=${IGNORE_UNFIXED:-true}
REPORT_DIR=${REPORT_DIR:-./reports}
TRIVY=aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969

mkdir -p "$REPORT_DIR"
unfixed_flag=""
[ "$IGNORE_UNFIXED" = "true" ] && unfixed_flag="--ignore-unfixed"

# Git Bash rewrites anything that looks like a path, which mangles the container
# side of -v; MSYS_NO_PATHCONV stops that, and `pwd -W` gives Docker Desktop the
# host path in the form it expects.
host_reports="$(cd "$REPORT_DIR" && pwd)"
case "$(uname -s)" in
    MINGW* | MSYS*) host_reports="$(cd "$REPORT_DIR" && pwd -W)" ;;
esac

trivy() {
    MSYS_NO_PATHCONV=1 docker run --rm \
        -v /var/run/docker.sock:/var/run/docker.sock \
        -v splitx-trivy-cache:/root/.cache \
        -v "${host_reports}:/report" \
        "$TRIVY" "$@"
}

echo "Scanning $IMAGE for $SEVERITY vulnerabilities (ignore-unfixed=$IGNORE_UNFIXED)"

# Everything found, for the record — never fails the build.
trivy image --scanners vuln --quiet --format json --output /report/trivy-report.json "$IMAGE"

# The gate: fixable findings at or above SEVERITY.
trivy image --scanners vuln --quiet --format table \
    --severity "$SEVERITY" $unfixed_flag --exit-code 1 "$IMAGE"

echo "No fixable $SEVERITY vulnerabilities. Full report: $REPORT_DIR/trivy-report.json"
