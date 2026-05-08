# SplitX DevOps — Pre-Implementation Briefing

> Answers to all your questions, decisions made, cost estimates, and tool breakdown — before we write a single line of code.

---

## 1. What Do You Need to Install on Your Machine?

Since this is a **demo/showcase** (not production), we run the heavy services inside Docker containers locally. You only need CLI tools installed natively.

### Must Install (on Windows)

| Tool | Install Method | Why |
|------|---------------|-----|
| **Docker Desktop** | [docker.com/desktop](https://www.docker.com/products/docker-desktop/) | Runs everything — Jenkins, Prometheus, Grafana, SonarQube, Postgres, the app itself. This is the backbone. |
| **kubectl** | `winget install Kubernetes.kubectl` | CLI to interact with Kubernetes clusters (local minikube + AWS EKS) |
| **minikube** | `winget install minikube` | Runs a real single-node Kubernetes cluster locally inside Docker. Free, zero AWS cost. |
| **Terraform** | `winget install HashiCorp.Terraform` | CLI to provision AWS infrastructure from code |
| **AWS CLI v2** | `winget install Amazon.AWSCLI` | CLI to authenticate with AWS, push Docker images to ECR, manage EKS |
| **Helm** | `winget install Helm.Helm` | Kubernetes package manager — deploys our app chart to K8s |

### Optional but Recommended

| Tool | Install Method | Why |
|------|---------------|-----|
| **Ansible** | Install via WSL (Ubuntu): `sudo apt install ansible` | Can't run natively on Windows. Use WSL2 (Ubuntu) for Ansible playbooks |
| **Lens Desktop** | [k8slens.dev](https://k8slens.dev/) | Beautiful GUI for Kubernetes — great for demo screenshots |

### You Do NOT Need to Install Separately

| Tool | Why Not |
|------|---------|
| **Jenkins** | Runs as a Docker container via `docker-compose` |
| **Prometheus** | Runs as a Docker container / K8s pod |
| **Grafana** | Runs as a Docker container / K8s pod |
| **SonarQube** | Runs as a Docker container |
| **Trivy** | Runs inside Jenkins pipeline (Docker image) |
| **Nexus** | Skipping — ECR serves the same purpose and is already in scope with AWS. Adding Nexus would be redundant. |

---

## 2. How This Is Designed (Demo-First, Not Production)

```
┌──────────────────────────────────────────────────────────────┐
│                YOUR LAPTOP (Docker Desktop)                  │
│                                                              │
│  ┌─────────┐ ┌───────────┐ ┌────────────┐ ┌──────────────┐  │
│  │ Jenkins │ │ SonarQube │ │ Prometheus │ │   Grafana    │  │
│  │  :8080  │ │   :9000   │ │   :9090    │ │    :3001     │  │
│  └────┬────┘ └───────────┘ └────────────┘ └──────────────┘  │
│       │                                                      │
│  ┌────▼──────────────────────────────────────────────────┐   │
│  │              minikube (Local Kubernetes)               │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐              │   │
│  │  │ SplitX   │ │ SplitX   │ │ SplitX   │   (HPA)     │   │
│  │  │ Pod 1    │ │ Pod 2    │ │ Pod N    │              │   │
│  │  └──────────┘ └──────────┘ └──────────┘              │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────┐                                                │
│  │Terraform │──── provisions ───▶  AWS (EKS, ECR, VPC, S3) │
│  └──────────┘                                                │
└──────────────────────────────────────────────────────────────┘
```

**Day-to-day practice & development** → Everything runs locally via Docker + minikube (zero cost).

**University demo day** → Spin up AWS infra with `terraform apply`, deploy to EKS, show live dashboards, then tear down with `terraform destroy` (costs ~$8–12 for a 2-day demo).

---

## 3. Every Tool — What, Why, and How

### Core 8 (University Required)

| # | Tool | What It Is | Why We Use It | How It's Used in SplitX |
|---|------|-----------|---------------|------------------------|
| 1 | **Git** | Distributed version control | Track every code change, enable collaboration, branching, PRs | Conventional commits, feature branches (`feat/`, `fix/`), pre-commit hooks via Husky, PR template |
| 2 | **Docker** | Container packaging | Package the app + all dependencies into a portable image that runs identically everywhere | Multi-stage Dockerfile (build → run), `docker-compose.yml` for full local stack, health checks, non-root user |
| 3 | **Jenkins** | CI/CD automation server | Automate the entire build→test→scan→deploy pipeline on every push | Declarative `Jenkinsfile` with 6 stages: Checkout → Test → Lint → Build → Docker Push → Deploy to K8s |
| 4 | **Terraform** | Infrastructure as Code | Provision cloud infrastructure reproducibly from `.tf` files instead of clicking in AWS console | Modules for VPC, EKS cluster, ECR registry, S3 bucket. `terraform apply` creates everything, `terraform destroy` tears it down |
| 5 | **Kubernetes** | Container orchestration | Run multiple replicas of SplitX, auto-scale, self-heal crashed pods, rolling updates with zero downtime | Deployment, Service, Ingress, HPA (auto-scale 2→5 pods at 70% CPU), liveness/readiness probes hitting `/api/health` |
| 6 | **AWS** | Cloud platform | Real cloud infrastructure — EKS for K8s, ECR for Docker images, S3 for Terraform state, VPC for networking | Terraform provisions all AWS resources. Jenkins pushes images to ECR. Helm deploys to EKS. |
| 7 | **Prometheus** | Metrics collection & alerting | Scrape application metrics every 15s, store time-series data, fire alerts on anomalies | Custom `/api/metrics` endpoint exposes request rates, latencies, DB health, business metrics (transactions/hr). Alert rules for high error rate / latency |
| 8 | **Grafana** | Metrics visualization | Beautiful real-time dashboards showing app health, performance, and business KPIs | Two dashboards: **Operations** (request rate, error %, latency p95, pod CPU) and **Business** (transactions/hr, active groups, AI usage) |

### Bonus Tools (Differentiators)

| # | Tool | What It Is | Why It Stands Out | How It's Used |
|---|------|-----------|-------------------|---------------|
| 9 | **Helm** | Kubernetes package manager | Shows you understand templated, reusable K8s deployments — not just raw YAML | `helm/splitx/` chart with `values-dev.yaml` and `values-prod.yaml` for environment-specific configs |
| 10 | **Ansible** | Configuration management | Automates server setup — shows you can configure infrastructure, not just provision it | Playbook that installs Docker, kubectl, configures firewall, and sets up k3s on an EC2 instance |
| 11 | **SonarQube** | Code quality analysis | Static analysis: finds bugs, code smells, security vulnerabilities, measures test coverage | Runs in Docker locally. Jenkins pipeline sends code for analysis. Quality gate blocks deploy if critical issues found |
| 12 | **Trivy** | Container security scanner | Scans Docker images for known CVEs (vulnerabilities) before deployment | Jenkins pipeline stage: scans the built image, fails the build on CRITICAL/HIGH CVEs, generates an HTML report |

---

## 4. Decisions Made (Your Open Questions)

| Question | Decision | Reasoning |
|----------|----------|-----------|
| **AWS account** | ✅ Use your $100 free tier credit | Sufficient. We'll use a **spin-up-for-demo, tear-down-after** strategy to stay well within budget |
| **Jenkins hosting** | 🏠 **Run locally in Docker** | Free. No EC2 cost. Jenkins is just the pipeline engine — it doesn't need to be in the cloud for a demo |
| **Domain name** | 🚫 **Skip it** — use EKS load balancer URL | A custom domain adds Route53 cost and DNS complexity for zero academic benefit. The LB URL proves it works |
| **Database** | 🔗 **Use existing Neon PostgreSQL** | Free, already has your data. Adding RDS would cost ~$15/month and duplicate your data for no demo benefit. The K8s pods connect to Neon just like Vercel does |
| **Scope priority** | 📋 All 8 core tools + 4 bonus | Your $100 credit and local Docker approach gives enough runway for everything |

---

## 5. Estimated AWS Cost Breakdown

### Strategy: Local-First, Cloud-For-Demo

| Usage Pattern | Monthly Cost |
|--------------|-------------|
| **Day-to-day (local Docker + minikube)** | **$0.00** |
| **Demo day (2-day EKS spin-up)** | **~$10–15** |
| **Total for a month of practice + 2 demos** | **~$15–25** |

### Detailed Per-Service Estimate (for a 48-hour demo window)

| AWS Service | Spec | Rate | 48hr Cost |
|-------------|------|------|-----------|
| **EKS Control Plane** | 1 cluster | $0.10/hr | **$4.80** |
| **EC2 Node Group** | 2× `t3.small` | $0.0208/hr each | **$2.00** |
| **ECR** | ~500MB images | Free tier (500MB/month) | **$0.00** |
| **S3** | Terraform state (~1KB) | Free tier (5GB) | **$0.00** |
| **NAT Gateway** | 1 (for private subnets) | $0.045/hr + data | **$2.50** |
| **Load Balancer** | 1 ALB | $0.0225/hr | **$1.08** |
| **Data Transfer** | Minimal demo traffic | Free tier (1GB/month) | **$0.00** |
| | | **48hr Total** | **~$10.38** |

> [!TIP]
> **With $100 credit, you can comfortably run 6–8 full demo sessions** before hitting the limit. After each demo, run `terraform destroy` to stop all charges immediately.

### Cost Safety Measures We'll Set Up
1. **AWS Budget Alert** at $20 and $50 thresholds (email notification)
2. **Terraform destroy** script for one-command teardown
3. **Auto-shutdown** tag on EC2 nodes

---

## 6. What Nexus? What About More Tools?

| Tool | Include? | Reason |
|------|----------|--------|
| **Nexus Repository** | ❌ Skip | ECR (AWS) already serves as our Docker registry. Nexus would duplicate that role. Adding it would feel forced, not organic |
| **Ansible** | ✅ Yes | Naturally fits — configures the EC2 nodes that Terraform provisions. Shows the Terraform→Ansible handoff pattern |
| **SonarQube** | ✅ Yes | Adds a code quality dimension no other tool covers. Jenkins pipeline sends analysis, quality gate blocks bad code |
| **Trivy** | ✅ Yes | 30-second addition to Jenkins pipeline, massive security credibility |
| **ArgoCD** | ❌ Skip | Beautiful tool but adds K8s complexity that could eat debugging time. Not worth the risk for a demo |
| **Loki** | ❌ Skip | Prometheus + Grafana already covers observability. Loki adds log aggregation but is complex to configure correctly |

**Final tool count: 12 tools** (8 required + Helm + Ansible + SonarQube + Trivy)

---

## 7. Demo Flow (What You'll Show the University)

```
Step 1: "Here's my Git workflow"
  → Show branching strategy, conventional commits, PR template, pre-commit hooks

Step 2: "I containerized the app with Docker"
  → Show multi-stage Dockerfile, docker-compose with full stack,
    run `docker compose up` → everything starts

Step 3: "Jenkins automates my CI/CD pipeline"
  → Open Jenkins at localhost:8080
  → Trigger a build → watch Test → Lint → SonarQube → Docker Build → Trivy Scan → Deploy
  → Show the pipeline visualization (Blue Ocean UI)

Step 4: "SonarQube analyzes code quality"
  → Open SonarQube at localhost:9000
  → Show the quality gate, bugs, code smells, coverage metrics

Step 5: "Trivy scans for container vulnerabilities"
  → Show the scan results in Jenkins build artifacts

Step 6: "Terraform provisions my AWS infrastructure"
  → Show the .tf files
  → Run `terraform plan` → show what WILL be created
  → (If live demo) Run `terraform apply` → show resources appearing in AWS console

Step 7: "Ansible configures the servers"
  → Show the playbook YAML
  → Explain the Terraform→Ansible handoff

Step 8: "Kubernetes orchestrates the deployment"
  → Show K8s manifests + Helm chart
  → `kubectl get pods` → show multiple replicas running
  → `kubectl get hpa` → show auto-scaling config
  → Kill a pod → watch K8s auto-restart it (self-healing demo)

Step 9: "Prometheus + Grafana monitor everything"
  → Open Grafana at localhost:3001
  → Show the Operations dashboard (request rates, latency, errors)
  → Show the Business dashboard (transactions/hr, active users)
  → Show alert rules in Prometheus
```

---

## 8. Summary Checklist Before We Start

- [ ] Install Docker Desktop and make sure it's running
- [ ] Install kubectl, minikube, Terraform, AWS CLI, Helm via `winget`
- [ ] Install WSL2 + Ubuntu (for Ansible)
- [ ] Configure AWS CLI with your account (`aws configure`)
- [ ] Set up an AWS Budget alert at $20 threshold
- [ ] Confirm you're ready → I'll start building Phase 1

> [!IMPORTANT]
> **Say "proceed" when you're ready**, and I'll begin implementing Phase 1 (Git + Docker hardening) immediately. No more planning — pure execution.
