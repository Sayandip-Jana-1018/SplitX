# ═══════════════════════════════════════════════════════════════
#   SplitX — ArgoCD Bootstrap Script (Windows PowerShell)
#   Run this ONE TIME before the presentation to set everything up
#   Usage: cd argocd; .\install-argocd.ps1
# ═══════════════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  SplitX ArgoCD Bootstrap" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Check prerequisites ──
Write-Host "[1/7] Checking prerequisites..." -ForegroundColor Yellow

if (-not (Get-Command "kind" -ErrorAction SilentlyContinue)) {
    Write-Host "  ERROR: 'kind' not found. Installing via winget..." -ForegroundColor Red
    winget install Kubernetes.kind --silent
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
}

if (-not (Get-Command "kubectl" -ErrorAction SilentlyContinue)) {
    Write-Host "  ERROR: 'kubectl' not found. Installing via winget..." -ForegroundColor Red
    winget install Kubernetes.kubectl --silent
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
}

if (-not (Get-Command "helm" -ErrorAction SilentlyContinue)) {
    Write-Host "  ERROR: 'helm' not found. Installing via winget..." -ForegroundColor Red
    winget install Helm.Helm --silent
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
}

Write-Host "  OK: kind, kubectl, helm all available" -ForegroundColor Green

# ── Step 2: Create Kind cluster ──
Write-Host ""
Write-Host "[2/7] Creating Kind cluster 'splitx-demo'..." -ForegroundColor Yellow

$clusterExists = $false
try {
    $clusters = kind get clusters 2>$null
    if ($clusters -match "splitx-demo") { $clusterExists = $true }
} catch { $clusterExists = $false }

if ($clusterExists) {
    Write-Host "  INFO: Cluster 'splitx-demo' already exists, skipping creation" -ForegroundColor Cyan
} else {
    kind create cluster --config kind-cluster.yml
    Write-Host "  OK: Kind cluster created" -ForegroundColor Green
}

# Set kubectl context
kubectl config use-context kind-splitx-demo
Write-Host "  OK: kubectl context set to kind-splitx-demo" -ForegroundColor Green

# ── Step 3: Create ArgoCD namespace ──
Write-Host ""
Write-Host "[3/7] Creating ArgoCD namespace..." -ForegroundColor Yellow
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
Write-Host "  OK: Namespace 'argocd' ready" -ForegroundColor Green

# ── Step 4: Install ArgoCD ──
Write-Host ""
Write-Host "[4/7] Installing ArgoCD (stable release)..." -ForegroundColor Yellow
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
Write-Host "  OK: ArgoCD manifests applied" -ForegroundColor Green

# ── Step 5: Wait for ArgoCD pods to be ready ──
Write-Host ""
Write-Host "[5/7] Waiting for ArgoCD pods to be ready (this takes ~2 minutes)..." -ForegroundColor Yellow
kubectl wait --for=condition=available deployment/argocd-server -n argocd --timeout=180s
Write-Host "  OK: ArgoCD server is ready" -ForegroundColor Green

# ── Step 6: Expose ArgoCD UI via NodePort ──
Write-Host ""
Write-Host "[6/7] Patching ArgoCD service to NodePort for localhost access..." -ForegroundColor Yellow
kubectl patch svc argocd-server -n argocd -p '{"spec": {"type": "NodePort", "ports": [{"port": 443, "targetPort": 8080, "nodePort": 30443, "name": "https"}, {"port": 80, "targetPort": 8080, "nodePort": 30080, "name": "http"}]}}'
Write-Host "  OK: ArgoCD UI accessible at http://localhost:8090" -ForegroundColor Green

# ── Step 7: Apply ArgoCD Application manifest ──
Write-Host ""
Write-Host "[7/7] Deploying SplitX ArgoCD Application..." -ForegroundColor Yellow
kubectl apply -f splitx-app.yml
Write-Host "  OK: ArgoCD Application 'splitx' created" -ForegroundColor Green

# ── Print admin credentials ──
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  ArgoCD Bootstrap Complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  URL:      http://localhost:8090" -ForegroundColor White
Write-Host "  Username: admin" -ForegroundColor White

$password = kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | ForEach-Object { [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($_)) }
Write-Host "  Password: $password" -ForegroundColor Yellow

Write-Host ""
Write-Host "  Save this password! Open http://localhost:8090 in your browser." -ForegroundColor Cyan
Write-Host ""
