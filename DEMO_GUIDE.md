# SplitX — DevOps Demo Cheat Sheet
## 17 Tools | ~35 Minutes | University Presentation

---

## ⚡ STARTUP (Run this 10 min before demo)

```powershell
cd C:\Users\Sayan\Desktop\Projects\SplitX
docker compose --profile monitoring --profile ci up -d
```

### Open these tabs in browser:
| Tab | URL | Login |
|-----|-----|-------|
| App | http://localhost:3000 | your account |
| Prometheus | http://localhost:9090 | none |
| Grafana | http://localhost:3001 | admin / splitx_grafana |
| Jenkins | http://localhost:8080 | admin / admin |
| SonarQube | http://localhost:9000 | admin / admin |
| Nexus | http://localhost:8081 | admin / adminsj2003 |
| GitHub | https://github.com/Sayandip-Jana-1018/SplitX | none |

---

## DEMO ORDER

```
Git → Husky → Commitlint → ESLint → GitHub Actions →
Docker → Docker Compose → Jenkins → SonarQube → Trivy →
Nexus → Prometheus → Grafana → Terraform → Ansible →
Kubernetes → Helm
```

---

## TOOL 1 — Git + GitHub
**Category:** Version Control

**What to show:**
- Open GitHub → https://github.com/Sayandip-Jana-1018/SplitX
- Show commits tab → show history with `feat:`, `fix:`, `chore:` prefixes

**Command to run:**
```powershell
git log --oneline -10
git branch -a
```

**Say:** *"Every change is tracked with meaningful commits following the Conventional Commits standard. You can see feat: for features, fix: for bugs. This format is enforced automatically by Husky — my next tool."*

---

## TOOL 2 — Husky
**Category:** Git Hooks (Pre-commit automation)

**What to show:** File `.husky/pre-commit` and `.husky/commit-msg`

**DEMO — show a bad commit getting REJECTED:**
```powershell
git commit --allow-empty -m "updated stuff"
```
**Expected output:**
```
✖  subject may not be empty
✖  type may not be empty
husky - commit-msg script failed (code 1)
```

**Then show a GOOD commit:**
```powershell
git commit --allow-empty -m "chore: demo conventional commits"
git reset HEAD~1   # cleanup after demo
```

**Say:** *"Husky runs automatically before every commit. No developer can push bad code or bad commit messages. This is the first quality gate — on the developer's own machine."*

---

## TOOL 3 — Commitlint
**Category:** Commit Message Standards

**What to show:** File `commitlint.config.js`
```powershell
type commitlint.config.js
```

**Say:** *"Commitlint enforces the Conventional Commits standard. Valid types are: feat, fix, chore, docs, style, refactor, test, perf. The format is: type(scope): message. This enables automatic changelog generation and semantic versioning."*

---

## TOOL 4 — ESLint
**Category:** Static Code Linting

**What to show:** File `eslint.config.mjs`
```powershell
# Show the config
type eslint.config.mjs

# Run linting live
npm run lint
```

**Say:** *"ESLint is our TypeScript linter. Zero warnings are allowed — if any ESLint rule fires, the pre-commit hook blocks the commit. It's also run in Stage 3 of our Jenkins pipeline."*

---

## TOOL 5 — GitHub Actions
**Category:** Cloud CI Pipeline

**What to show:**
- Open: https://github.com/Sayandip-Jana-1018/SplitX/actions
- Show green checkmarks on all workflow runs
- Click any run → show 4 steps: checkout, test, lint, build

```powershell
type .github\workflows\ci.yml
```

**Say:** *"GitHub Actions is our cloud CI pipeline. Every push triggers an automated pipeline — tests, linting, and a full production build. If anything fails, the push is flagged. This runs for free in GitHub's cloud."*

---

## TOOL 6 — Docker
**Category:** Containerization

**What to show:** File `Dockerfile`

```powershell
type Dockerfile

# Show the built image
docker images splitx

# Show running container
docker inspect splitx-app --format "Status: {{.State.Status}} | Image: {{.Config.Image}}"
```

**Say:** *"Docker packages our Next.js app into a portable container. We use a 3-stage multi-stage build — dependencies, builder, and runner. The final image is ~250MB instead of 1.5GB, runs as a non-root user for security, and has a HEALTHCHECK that Kubernetes uses."*

---

## TOOL 7 — Docker Compose
**Category:** Multi-Container Orchestration

**What to show:**
```powershell
docker compose --profile monitoring --profile ci ps
```

**Expected output:**
```
splitx-app         running  0.0.0.0:3000->3000/tcp
splitx-postgres    running  0.0.0.0:5432->5432/tcp
splitx-redis       running  0.0.0.0:6379->6379/tcp
splitx-prometheus  running  0.0.0.0:9090->9090/tcp
splitx-grafana     running  0.0.0.0:3001->3000/tcp
splitx-jenkins     running  0.0.0.0:8080->8080/tcp
splitx-sonarqube   running  0.0.0.0:9000->9000/tcp
splitx-nexus       running  0.0.0.0:8081->8081/tcp
```

**Say:** *"Docker Compose runs our entire 8-service stack with ONE command. Services start in the right order using health checks and depends_on. We use profiles — run just the app, or add monitoring, or add CI tools as needed."*

---

## TOOL 8 — Jenkins
**Category:** Self-Hosted CI/CD Pipeline

**What to show:**
- Open: http://localhost:8080/job/SplitX-Pipeline/
- Show the Stage View — all 8 stages green ✅
- Click a stage → show console output

**The 8 Stages:**
```
Checkout → Install → Lint & Type Check → SonarQube Analysis
→ Docker Build → Security Scan (Trivy) → Artifact Registry (Nexus) → Deploy
```

**Say:** *"Jenkins is our self-hosted CI/CD engine. Unlike GitHub Actions in the cloud, Jenkins runs on our own infrastructure. The pipeline has 8 stages — it checks out code, installs deps, runs linting, does static analysis, builds a Docker image, scans for vulnerabilities, pushes to our private registry, and deploys. One push triggers all 8 stages automatically."*

**To trigger a new build:**
```powershell
# In browser: localhost:8080/job/SplitX-Pipeline/ → click "Build Now"
```

---

## TOOL 9 — SonarQube
**Category:** Code Quality & Static Analysis

**What to show:**
- Open: http://localhost:9000/dashboard?id=splitx
- Show: Quality Gate **PASSED** ✅
- Show: 36k lines, Security A, 3.1% duplication

**Say:** *"SonarQube performs deep static analysis. It found 38 reliability issues and 624 maintainability issues — but our security score is A with zero open issues. The Quality Gate passed, which means the pipeline was allowed to continue. If we introduced a critical security bug, the gate would fail and block the deployment."*

---

## TOOL 10 — Trivy
**Category:** Container Security Scanning (DevSecOps)

**What to show:** Jenkins Stage 6 console output, or run manually:
```powershell
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock `
  aquasec/trivy:latest image --no-progress splitx:local
```

**Say:** *"Trivy scans our Docker image for known CVEs before it can be deployed. In Jenkins Stage 6, we use --exit-code 0 for HIGH/CRITICAL findings — meaning the build continues but logs all vulnerabilities. In production you'd use --exit-code 1 to block on critical CVEs. This is DevSecOps — security is built into the pipeline."*

---

## TOOL 11 — Nexus
**Category:** Private Artifact Registry

**What to show:**
- Open: http://localhost:8081/#browse/browse:splitx-docker
- Show: `splitx/tags/latest` and `splitx/tags/1.0.0`

**Say:** *"Nexus is our private Docker registry. Instead of pushing to public Docker Hub, Jenkins pushes every built image to Nexus. Each image is tagged with both `latest` and a build number. This gives us full version history and the ability to roll back to any previous version."*

---

## TOOL 12 — Prometheus
**Category:** Metrics Collection & Alerting

**What to show:**
- Open: http://localhost:9090
- Status → Targets → show `splitx-app` is **UP** ✅
- Query tab → paste and execute:

```
splitx_http_requests_total
```
```
splitx_nodejs_heap_size_used_bytes
```
```
splitx_active_groups
```
```
splitx_transactions_created_total
```

Click **Graph** tab to show time series.

**Say:** *"Prometheus scrapes 38 metrics from our app every 15 seconds. We have standard Node.js metrics like heap memory and CPU, plus custom business metrics — how many transactions were created, settlements completed, AI chats used. The /api/metrics endpoint is secured with a Bearer token. We also have 4 alert rules for high error rate, high latency, app down, and DDoS detection."*

---

## TOOL 13 — Grafana
**Category:** Metrics Visualization & Dashboards

**What to show:**
- Open: http://localhost:3001
- Login: `admin` / `splitx_grafana`
- Go to: Dashboards → SplitX Overview
- Show live panels: request rate, memory, error rate

**Say:** *"Grafana turns raw Prometheus metrics into beautiful dashboards. This SplitX Overview dashboard auto-provisions from a JSON file — no manual setup. You can see real-time memory usage, request rates, and business metrics. In production, this would be on a big screen in the operations room."*

---

## TOOL 14 — Terraform
**Category:** Infrastructure as Code (IaC)

**What to show:**
```powershell
cd terraform
type main.tf
type variables.tf

# SAFE dry run — shows what would be created, NO cost
terraform init
terraform plan
```

**Expected:**
```
Plan: 23 to add, 0 to change, 0 to destroy.
  + ECR repository (Docker image registry)
  + EKS cluster (Kubernetes on AWS)
  + VPC with public/private subnets
```

> ⚠️ **DO NOT run `terraform apply`** — it creates real AWS resources!

**Say:** *"Terraform is Infrastructure as Code. Instead of clicking through the AWS console to create VPCs, container registries, and Kubernetes clusters, we define everything in code. 3 modules: VPC for networking, ECR for Docker images, EKS for Kubernetes. The plan shows 23 resources would be created. Everything is version-controlled — if we need to rebuild the infrastructure, one command recreates it identically."*

---

## TOOL 15 — Ansible
**Category:** Configuration Management & Server Automation

**What to show:**
```powershell
type ansible\playbooks\setup-node.yml
type ansible\ansible.cfg
```

**The 14 automated tasks:**
```
1. Update system packages        8. Install kubectl
2. Install system dependencies   9. Install Helm
3. Add Docker GPG key           10. Install AWS CLI v2
4. Add Docker repository        11. Configure UFW firewall
5. Install Docker Engine        12. Enable UFW (deny-by-default)
6. Start Docker service         13. Add user to docker group
7. Enable Docker on boot        14. Verify all tools + print versions
```

**Say:** *"Ansible automates EC2 server provisioning. Instead of SSH-ing into each server and running 14 commands manually, one playbook configures everything — Docker, kubectl, Helm, AWS CLI, and firewall. If we had 10 servers, they'd all be configured simultaneously in parallel. No SSH password needed — it uses SSH keys."*

---

## TOOL 16 — Kubernetes (K8s)
**Category:** Container Orchestration

**What to show:**
```powershell
# Show K8s manifests
ls k8s\
type k8s\deployment.yaml
type k8s\service.yaml
type k8s\hpa.yaml
```

**Key points to show in the YAML:**
- `replicas: 2` → runs 2 app instances for high availability
- `resources.limits` → CPU/memory limits prevent runaway usage
- `readinessProbe/livenessProbe` → health checks for self-healing
- `HorizontalPodAutoscaler` → auto-scales from 2 to 10 pods based on CPU

**Say:** *"Kubernetes is our container orchestration platform. The deployment runs 2 replicas for high availability. The HPA (Horizontal Pod Autoscaler) scales from 2 to 10 pods automatically when CPU exceeds 70%. If a pod crashes, Kubernetes restarts it automatically. In production, this runs on the EKS cluster provisioned by our Terraform code."*

---

## TOOL 17 — Helm
**Category:** Kubernetes Package Manager

**What to show:**
```powershell
type helm\splitx\Chart.yaml
type helm\splitx\values.yaml
ls helm\splitx\templates\
```

**Say:** *"Helm is the package manager for Kubernetes — think of it as npm but for K8s. Instead of maintaining 5 separate YAML files (deployment, service, ingress, HPA, configmap), Helm templates them all with configurable values. To deploy to production: `helm install splitx ./helm/splitx`. To update: `helm upgrade splitx ./helm/splitx --set image.tag=v1.2.0`. To rollback: `helm rollback splitx 1`. It's used in Jenkins Stage 8 to deploy after every successful build."*

---

## DEMO FLOW SUMMARY

```
[Git/GitHub] ──► [Husky] ──► [Commitlint] ──► [ESLint] ──► [GitHub Actions]
     │                                                              │
     └─────────────────── CODE QUALITY LAYER ──────────────────────┘
                                    │
                               [Jenkins Pipeline]
                         ┌──────────┴──────────────┐
                    [SonarQube]    [Trivy]    [Nexus Registry]
                         │           │               │
                         └─────── SECURITY ──────────┘
                                    │
                           [Terraform → AWS]
                           [Ansible → EC2]
                           [Kubernetes → EKS]
                           [Helm → Deploy]
                                    │
                    [Prometheus] ◄──┤
                    [Grafana]    ◄──┘
                   OBSERVABILITY LAYER
```

---

## QUICK REFERENCE — Credentials

| Tool | URL | Username | Password |
|------|-----|----------|----------|
| App | localhost:3000 | your email | your password |
| Grafana | localhost:3001 | admin | splitx_grafana |
| Jenkins | localhost:8080 | admin | admin |
| SonarQube | localhost:9000 | admin | admin |
| Nexus | localhost:8081 | admin | adminsj2003 |
| Prometheus | localhost:9090 | — | — |

## QUICK REFERENCE — Best Prometheus Queries

```
splitx_http_requests_total
splitx_nodejs_heap_size_used_bytes
splitx_process_cpu_seconds_total
splitx_active_groups
splitx_transactions_created_total
splitx_settlements_completed_total
splitx_ai_chat_requests_total
splitx_receipt_scans_total
```
