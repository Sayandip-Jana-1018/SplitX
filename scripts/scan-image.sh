#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#   SplitX — Docker Image Security Scan (Trivy)
#   Usage: ./scripts/scan-image.sh splitx-app:latest
# ═══════════════════════════════════════════════════════════════

IMAGE=${1:-"splitx-app:latest"}
REPORT_DIR="./reports"

mkdir -p "$REPORT_DIR"

echo "🔍 Scanning image: $IMAGE"
echo "════════════════════════════════════════"

# Table output to console
trivy image \
    --severity HIGH,CRITICAL \
    --no-progress \
    --format table \
    "$IMAGE"

# HTML report
trivy image \
    --format template \
    --template "@contrib/html.tpl" \
    --output "$REPORT_DIR/trivy-report.html" \
    "$IMAGE" 2>/dev/null

# JSON report (for CI/CD integration)
trivy image \
    --format json \
    --output "$REPORT_DIR/trivy-report.json" \
    "$IMAGE"

echo ""
echo "════════════════════════════════════════"
echo "📄 Reports saved to: $REPORT_DIR/"
echo "   - trivy-report.html"
echo "   - trivy-report.json"
