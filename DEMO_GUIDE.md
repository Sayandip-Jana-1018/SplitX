# SplitX — Complete AWS Setup + Presentation Guide
## From zero to fully deployed, every command, every output

---

## PART 1: IMPORTANT QUESTIONS ANSWERED FIRST

### Q: Should I keep AWS running or destroy after setup?
**Keep it running** — presentation is in 24 hours.
- Cost for 24 hours: ~$5.50 total. Not worth the risk of re-setting up.
- Just leave it running overnight.

### Q: Will Vercel and AWS have the same data?
**NO — they are separate environments:**
| | Vercel (Production) | AWS (Demo) |
|-|--------------------|----|
| URL | splitsj.vercel.app | Load Balancer URL from EKS |
| Database | Supabase (cloud) | Local Postgres in container |
| Purpose | Real production app | DevOps demo only |
| Data | Your real user data | Empty / test data |

**For presentation:** Show Vercel for the APP demo, show AWS for the DEVOPS demo (K8s, Helm live commands).

### Q: Do I need to do all of AWS or just show terraform plan?
You already have everything working locally. AWS adds:
- Live `kubectl get pods` (real running pods)
- Live `helm list` (real deployment)
- Jenkins actually deploying to real K8s

If the panel doesn't ask for live cloud demo, skip AWS entirely and save $5.

---

## PART 2: AWS FULL SETUP (Do this NOW, takes ~20 min)

### Pre-check: Confirm AWS CLI is configured
```powershell
aws sts get-caller-identity
```
**Expected:**
```json
{
    "UserId": "AIDA...",
    "Account": "918183256068",
    "Arn": "arn:aws:iam::918183256068:user/..."
}
```
If this works → proceed. If error → run `aws configure` again.

---

### Step 1: Create S3 bucket for Terraform state
```powershell
aws s3 mb s3://splitx-terraform-state-918183256068 --region us-east-1
```
**Expected:** `make_bucket: splitx-terraform-state-918183256068`

---

### Step 2: Switch Terraform to S3 backend
Open `terraform\backend.tf` and swap:
```hcl
# Comment out local backend:
# terraform {
#   backend "local" { path = "terraform.tfstate" }
# }

# Uncomment S3 backend:
terraform {
  backend "s3" {
    bucket       = "splitx-terraform-state-918183256068"
    key          = "splitx/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
    encrypt      = true
  }
}
```

---

### Step 3: Deploy Infrastructure with Terraform (~15 min)
```powershell
cd C:\Users\Sayan\Desktop\Projects\SplitX\terraform

terraform init -reconfigure
```
**Expected:**
```
Successfully configured the backend "s3"!
Terraform has been successfully initialized!
```

```powershell
terraform plan
```
**Expected:**
```
Plan: 23 to add, 0 to change, 0 to destroy.
  + module.ecr.aws_ecr_repository.app
  + module.eks.aws_eks_cluster.main
  + module.vpc.aws_vpc.main
  ... (23 resources total)
```

```powershell
terraform apply
```
Type `yes` when prompted. Wait ~15 minutes.

**Expected at end:**
```
Apply complete! Resources: 23 added, 0 changed, 0 destroyed.

Outputs:
ecr_repository_url = "918183256068.dkr.ecr.us-east-1.amazonaws.com/splitx-app"
eks_cluster_name   = "splitx-eks"
vpc_id             = "vpc-0abc123..."
```
Save these output values — you'll need them.

---

### Step 4: Connect kubectl to EKS
```powershell
cd C:\Users\Sayan\Desktop\Projects\SplitX

aws eks update-kubeconfig --name splitx-eks --region us-east-1
```
**Expected:**
```
Added new context arn:aws:eks:us-east-1:918183256068:cluster/splitx-eks to C:\Users\Sayan\.kube\config
```

Verify connection:
```powershell
kubectl get nodes
```
**Expected:**
```
NAME                         STATUS   ROLES    AGE   VERSION
ip-10-0-1-45.ec2.internal    Ready    <none>   2m    v1.31.x
ip-10-0-2-78.ec2.internal    Ready    <none>   2m    v1.31.x
```

---

### Step 5: Push Docker image to ECR (AWS's Docker registry)
```powershell
# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 918183256068.dkr.ecr.us-east-1.amazonaws.com

# Tag the image
docker tag splitx:local 918183256068.dkr.ecr.us-east-1.amazonaws.com/splitx-app:latest
docker tag splitx:local 918183256068.dkr.ecr.us-east-1.amazonaws.com/splitx-app:1.0.0

# Push to ECR
docker push 918183256068.dkr.ecr.us-east-1.amazonaws.com/splitx-app:latest
docker push 918183256068.dkr.ecr.us-east-1.amazonaws.com/splitx-app:1.0.0
```
**Expected:** Layer push lines ending with `latest: digest: sha256:...`

---

### Step 6: Deploy SplitX to Kubernetes with Helm
```powershell
cd C:\Users\Sayan\Desktop\Projects\SplitX

# Update image in helm values to point to ECR
helm install splitx ./helm/splitx `
  --namespace splitx `
  --create-namespace `
  --set image.repository=918183256068.dkr.ecr.us-east-1.amazonaws.com/splitx-app `
  --set image.tag=latest
```
**Expected:**
```
NAME: splitx
LAST DEPLOYED: Sun May 11 ...
NAMESPACE: splitx
STATUS: deployed
REVISION: 1
```

Wait 1 minute then verify:
```powershell
kubectl get pods -n splitx
```
**Expected:**
```
NAME                      READY   STATUS    RESTARTS   AGE
splitx-7d4b9f-x2kpq       1/1     Running   0          45s
splitx-7d4b9f-r8mnt       1/1     Running   0          45s
```

---

### Step 7: Verify everything
```powershell
kubectl get all -n splitx
helm list -n splitx
kubectl get hpa -n splitx
```

---

## PART 3: COMPLETE PRESENTATION SCRIPT
### (Everything you run in front of the panel)

---

### STARTUP — Before presentation begins
```powershell
# Start local Docker stack
cd C:\Users\Sayan\Desktop\Projects\SplitX
docker compose --profile monitoring --profile ci up -d
```
Wait 2 minutes. Open browser tabs:
- http://localhost:3000 (App)
- http://localhost:9090 (Prometheus)
- http://localhost:3001 (Grafana)
- http://localhost:8080 (Jenkins)
- http://localhost:9000 (SonarQube)
- http://localhost:8081 (Nexus)
- https://github.com/Sayandip-Jana-1018/SplitX (GitHub)
- https://splitsj.vercel.app (Vercel Production)

---

### TOOL 1 — Git + GitHub
**[BROWSER]** Open: https://github.com/Sayandip-Jana-1018/SplitX
- Show: Repository structure, 300+ commits, branches

```powershell
git log --oneline -10
```
**Expected output:**
```
96c624c fix: two-ref graph centering - outerRef measures, containerRef draws
38e1cba feat: Jenkinsfile actually pushes Docker image to Nexus registry
22765bb fix: two-ref approach to center graph
...
```

```powershell
git branch -a
```
**Expected:** `* main` and remote tracking branches

**Say:** *"Every line of code is tracked. We use Conventional Commits: feat:, fix:, chore:. This format is enforced by Husky — my next tool."*

---

### TOOL 2 — Husky
**[TERMINAL]** Show Git hooks

```powershell
type .husky\pre-commit
```
**Expected:**
```
npx eslint --max-warnings 0 .
```

```powershell
type .husky\commit-msg
```
**Expected:**
```
npx --no -- commitlint --edit $1
```

**DEMO — Bad commit gets REJECTED:**
```powershell
git commit --allow-empty -m "updated stuff"
```
**Expected output:**
```
⧗   input: updated stuff
✖   subject may not be empty [subject-empty]
✖   type may not be empty [type-empty]
✖   found 2 problems, 0 warnings
husky - commit-msg script failed (code 1)
```

**Good commit passes:**
```powershell
git commit --allow-empty -m "chore: demo commit for presentation"
git reset HEAD~1
```

**Say:** *"Husky runs before every commit. No developer can push bad code or bad messages."*

---

### TOOL 3 — Commitlint
**[TERMINAL]** Show config

```powershell
type commitlint.config.js
```
**Expected:**
```js
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 100],
    'type-enum': [2, 'always', ['feat','fix','chore','docs',...]]
  }
}
```

**Say:** *"Commitlint enforces the format type(scope): message. Enables automatic changelogs."*

---

### TOOL 4 — ESLint
**[TERMINAL]** Show config and run

```powershell
type eslint.config.mjs
npm run lint
```
**Expected:**
```
> splitx@0.1.0 lint
> next lint
✔ No ESLint warnings or errors
```

**Say:** *"ESLint enforces TypeScript code quality. Zero warnings allowed. Also runs in Jenkins."*

---

### TOOL 5 — GitHub Actions
**[BROWSER]** Open: https://github.com/Sayandip-Jana-1018/SplitX/actions
- Show: All green workflow runs ✅
- Click any run → show 4 steps with green ticks

```powershell
type .github\workflows\ci.yml
```

**Say:** *"Every push triggers our cloud CI pipeline — checkout, test, lint, build. All runs green."*

---

### TOOL 6 — Docker
**[TERMINAL]** Show Dockerfile and image

```powershell
type Dockerfile
```
Point at the 3 stages: `FROM ... AS deps`, `FROM ... AS builder`, `FROM ... AS runner`

```powershell
docker images splitx
```
**Expected:**
```
REPOSITORY   TAG     IMAGE ID       CREATED        SIZE
splitx       local   abc123def456   2 days ago     ~250MB
```

```powershell
docker inspect splitx-app --format "Status: {{.State.Status}} | Image: {{.Config.Image}}"
```
**Expected:** `Status: running | Image: splitx:local`

**Say:** *"3-stage multi-stage build reduces image from 1.5GB to 250MB. Runs as non-root user for security."*

---

### TOOL 7 — Docker Compose
**[TERMINAL]** Show all running services

```powershell
docker compose --profile monitoring --profile ci ps
```
**Expected:**
```
NAME                STATUS     PORTS
splitx-app          running    0.0.0.0:3000->3000/tcp
splitx-postgres     running    0.0.0.0:5432->5432/tcp
splitx-redis        running    0.0.0.0:6379->6379/tcp
splitx-prometheus   running    0.0.0.0:9090->9090/tcp
splitx-grafana      running    0.0.0.0:3001->3000/tcp
splitx-jenkins      running    0.0.0.0:8080->8080/tcp
splitx-sonarqube    running    0.0.0.0:9000->9000/tcp
splitx-nexus        running    0.0.0.0:8081->8081/tcp
```

```powershell
docker network ls | findstr splitx
```
**Expected:** `splitx_splitx-network   bridge`

**Say:** *"One command starts 8 services. All connected on a private network. Health checks ensure correct startup order."*

---

### TOOL 8 — Jenkins
**[BROWSER]** Open: http://localhost:8080

1. Click **SplitX-Pipeline**
2. Show **Stage View** — all 8 stages green ✅
3. Click last build number → click **Security Scan** stage → show Trivy output in console

```powershell
type jenkins\Jenkinsfile
```
Point at each stage name.

**Say:** *"Jenkins is our self-hosted CI/CD. 8 stages: Checkout, Install, Lint, SonarQube, Docker Build, Trivy, Nexus Push, Deploy. Everything automated on one push."*

**TRIGGER A NEW BUILD LIVE:**
- In browser: Click **Build Now**
- Watch the stage view animate in real time ✅

---

### TOOL 9 — SonarQube
**[BROWSER]** Open: http://localhost:9000

Login: admin / admin
- Show Dashboard → Project: splitx
- Show: **Quality Gate: PASSED** ✅
- Show: Security Rating: **A** ✅
- Show: 36,000+ lines analyzed

**Say:** *"SonarQube analyzes every line for bugs and vulnerabilities. Security A rating. Quality Gate passed — pipeline was allowed to continue."*

---

### TOOL 10 — Trivy
**[TERMINAL]** Run live scan

```powershell
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock `
  aquasec/trivy:latest image --no-progress --severity HIGH,CRITICAL splitx:local
```
**Expected output (what you saw):**
```
splitx:local (alpine 3.19.4)
============================
Total: 4 (HIGH: 4, CRITICAL: 0)

┌────────────┬────────────────┬──────────┬────────┐
│  Library   │ Vulnerability  │ Severity │ Status │
├────────────┼────────────────┼──────────┼────────┤
│ musl       │ CVE-2025-26519 │ HIGH     │ fixed  │
│ musl-utils │ CVE-2025-26519 │ HIGH     │ fixed  │
└────────────┴────────────────┴──────────┴────────┘

Node.js: 12 HIGH, 0 CRITICAL (cross-spawn, tar, minimatch)

TOTAL: 16 HIGH, 0 CRITICAL ← pipeline CONTINUES ✅
```

**Say:** *"Trivy found 16 HIGH vulnerabilities, ZERO CRITICAL. Our pipeline is configured: HIGH = log and continue, CRITICAL = block deployment. Zero critical means the image is cleared for deployment. This is DevSecOps — security automated into every build."*

---

### TOOL 11 — Nexus
**[BROWSER]** Open: http://localhost:8081

Login: admin / adminsj2003
- Left sidebar → Browse → `splitx-docker`
- Show: `v2/splitx/tags/latest` ✅ and `v2/splitx/tags/1.0.0` ✅

**Say:** *"Nexus is our private Docker registry. Jenkins pushes every built image here with version tags. Full history, instant rollback to any version."*

---

### TOOL 12 — Prometheus
**[BROWSER]** Open: http://localhost:9090

**Step 1:** Status → Targets → show both targets UP ✅
```
splitx-app    UP    http://splitx:3000/api/metrics
prometheus    UP    http://localhost:9090/metrics
```

**Step 2:** Query tab — run these one by one, click **Graph** each time:
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

**Say:** *"Prometheus scrapes 38 metrics every 15 seconds. Standard Node.js metrics plus custom business metrics we defined ourselves. Both targets up with zero errors. We have 4 alert rules for high error rate, latency, downtime, and DDoS."*

---

### TOOL 13 — Grafana
**[BROWSER]** Open: http://localhost:3001

Login: admin / splitx_grafana
- Dashboards → SplitX Overview
- Show live panels: memory usage, request rate, error rate, active groups

**Say:** *"Grafana visualizes Prometheus metrics as live dashboards. Auto-provisioned from JSON — no manual setup. In production this is on a big screen in the ops room."*

---

### TOOL 14 — Terraform
**[TERMINAL]** Show IaC files and plan

```powershell
cd C:\Users\Sayan\Desktop\Projects\SplitX
type terraform\main.tf
```
**Expected:**
```hcl
module "vpc" { source = "./modules/vpc" ... }
module "ecr" { source = "./modules/ecr" ... }
module "eks" { source = "./modules/eks" ... }
```

```powershell
ls terraform\modules\
```
**Expected:** `ecr    eks    vpc`

```powershell
cd terraform
terraform plan
```
**Expected (partial):**
```
Terraform will perform the following actions:
  + module.ecr.aws_ecr_repository.app
  + module.eks.aws_eks_cluster.main
  + module.vpc.aws_vpc.main
  ...
Plan: 23 to add, 0 to change, 0 to destroy.
```

**[IF ON AWS — show real output:]**
```powershell
terraform output
```
**Expected:**
```
ecr_repository_url = "918183256068.dkr.ecr.us-east-1.amazonaws.com/splitx-app"
eks_cluster_name   = "splitx-eks"
vpc_id             = "vpc-0abc..."
```

**Say:** *"Terraform defines 23 AWS resources across 3 modules as code. VPC for networking, ECR for Docker images, EKS for Kubernetes. One command creates everything. One command destroys it all. Zero AWS console clicking."*

---

### TOOL 15 — Ansible
**[TERMINAL]** Show playbook

```powershell
cd C:\Users\Sayan\Desktop\Projects\SplitX
type ansible\playbooks\setup-node.yml
```

```powershell
Select-String -Path "ansible\playbooks\setup-node.yml" -Pattern "- name:" | Measure-Object
```
**Expected:** `Count : 14`

```powershell
type ansible\ansible.cfg
```

**Validate syntax (WSL):**
```powershell
wsl ansible-playbook ansible/playbooks/setup-node.yml --syntax-check
```
**Expected:**
```
playbook: ansible/playbooks/setup-node.yml
```

**Say:** *"Ansible configures EC2 servers automatically. 14 tasks: Docker, kubectl, Helm, AWS CLI, firewall with deny-by-default. After Terraform creates instances, Ansible provisions them. 10 servers configured simultaneously, identically, in 2 minutes."*

---

### TOOL 16 — Kubernetes
**[TERMINAL]** Show manifests

```powershell
ls k8s\base\
```
**Expected:** `configmap.yaml  deployment.yaml  hpa.yaml  ingress.yaml  namespace.yaml  network-policy.yaml  secret.yaml  service.yaml`

```powershell
type k8s\base\deployment.yaml
```
Point at:
```yaml
replicas: 2                      ← high availability
livenessProbe: /api/health       ← auto-restart crashed pods
readinessProbe: /api/health      ← only route traffic when ready
cpu: "500m"                      ← resource limits
```

```powershell
type k8s\base\hpa.yaml
```
Point at:
```yaml
minReplicas: 2
maxReplicas: 5
targetCPUUtilizationPercentage: 70
```

**[IF ON AWS — show LIVE:]**
```powershell
kubectl get pods -n splitx
```
**Expected:**
```
NAME                      READY   STATUS    RESTARTS   AGE
splitx-7d4b9f-x2kpq       1/1     Running   0          12m
splitx-7d4b9f-r8mnt       1/1     Running   0          12m
```

```powershell
kubectl get hpa -n splitx
```
**Expected:**
```
NAME      REFERENCE            TARGETS   MINPODS   MAXPODS   REPLICAS
splitx    Deployment/splitx    8%/70%    2         5         2
```

```powershell
kubectl describe deployment splitx -n splitx
```

**Say:** *"Kubernetes runs 2 replicas for high availability. If one crashes, K8s restarts it automatically. HPA monitors CPU — exceeds 70% and K8s adds more pods automatically. This runs on EKS provisioned by Terraform."*

---

### TOOL 17 — Helm
**[TERMINAL]** Show chart files

```powershell
type helm\splitx\Chart.yaml
```
**Expected:**
```yaml
apiVersion: v2
name: splitx
version: 1.0.0
appVersion: "0.1.0"
```

```powershell
type helm\splitx\values.yaml
```
Point at:
```yaml
replicaCount: 2
autoscaling:
  minReplicas: 2
  maxReplicas: 5
  targetCPUUtilization: 70
```

```powershell
type helm\splitx\templates\deployment.yaml
```
Point at:
```yaml
image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
```

```powershell
ls helm\splitx\templates\
```
**Expected:** `_helpers.tpl  deployment.yaml  hpa.yaml  service.yaml`

**[IF ON AWS — show LIVE:]**
```powershell
helm list -n splitx
```
**Expected:**
```
NAME    NAMESPACE  REVISION  STATUS    CHART         APP VERSION
splitx  splitx     1         deployed  splitx-1.0.0  0.1.0
```

```powershell
helm history splitx -n splitx
```
**Expected:**
```
REVISION  STATUS     CHART         DESCRIPTION
1         deployed   splitx-1.0.0  Install complete
```

**Say:** *"Helm is npm for Kubernetes. All K8s YAMLs are templated. Deploy: `helm install`. Update image version: `helm upgrade --set image.tag=v2.0`. Rollback: `helm rollback splitx 1`. Jenkins Stage 8 runs this after every successful build."*

---

## PART 4: COST SUMMARY

| Scenario | Duration | Cost |
|----------|----------|------|
| Keep running 24 hrs for presentation | 24 hours | ~$5.25 |
| Forget to destroy for 1 week | 168 hours | ~$37 |
| Forget to destroy for 2 weeks | 336 hours | ~$74 |
| **$100 credit exhausted in** | **~21 days** | $100 |

**Decision: Keep it running. Don't destroy. Presentation is tomorrow.**

---

## PART 5: AFTER PRESENTATION — CLEANUP

```powershell
# Remove Helm deployment
helm uninstall splitx -n splitx

# Destroy all AWS infrastructure
cd C:\Users\Sayan\Desktop\Projects\SplitX\terraform
terraform destroy
# Type "yes" when prompted

# Verify nothing is left (should show no EKS clusters)
aws eks list-clusters --region us-east-1
```

**Expected after destroy:**
```
Destroy complete! Resources: 23 destroyed.
```

---

## PART 6: QUICK REFERENCE CARD

### Credentials
| Tool | URL | User | Pass |
|------|-----|------|------|
| App | localhost:3000 | — | — |
| Grafana | localhost:3001 | admin | splitx_grafana |
| Jenkins | localhost:8080 | admin | admin |
| SonarQube | localhost:9000 | admin | admin |
| Nexus | localhost:8081 | admin | adminsj2003 |
| Prometheus | localhost:9090 | — | — |

### Prometheus Queries (copy-paste ready)
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

### Emergency Restart (if something crashes)
```powershell
docker compose --profile monitoring --profile ci restart
```
