# ============================================================
#   SplitX - DevOps Tools Demonstration Guide
#   University Presentation Cheat Sheet
#   Total Tools: 13
#   Estimated Demo Time: 30-35 minutes
# ============================================================

---

## PRE-DEMO CHECKLIST (Do this 15 minutes before)

### Step 1: Start Docker Desktop
- Open Docker Desktop from Windows Start Menu
- Wait until the bottom-left says "Docker Desktop is running" (green icon)
- If you see "Docker Desktop starting...", wait 1-2 minutes

### Step 2: Start All Services
```powershell
cd C:\Users\Sayan\Desktop\Projects\SplitX
docker compose --profile monitoring --profile ci up -d
```

**Expected output:**
```
[+] Running 8/8
 - Container splitx-postgres    Started
 - Container splitx-redis       Started
 - Container splitx-app         Started
 - Container splitx-prometheus  Started
 - Container splitx-grafana     Started
 - Container splitx-jenkins     Started
 - Container splitx-sonarqube   Started
 - Container splitx-nexus       Started
```

### Step 3: Wait for services to initialize
- Jenkins: ~2 minutes to fully start
- SonarQube: ~3 minutes to fully start
- Nexus: ~2-3 minutes to fully start
- Prometheus/Grafana: ~30 seconds

### Step 4: Verify all containers are running
```powershell
docker compose --profile monitoring --profile ci ps
```

**Expected output:**
All containers should show "running" or "healthy" status.

### Step 5: Open all URLs in browser tabs (keep ready)
```
App:        http://localhost:3000
Prometheus: http://localhost:9090
Grafana:    http://localhost:3001  (login: admin / splitx_grafana)
Jenkins:    http://localhost:8080
SonarQube:  http://localhost:9000  (login: admin / admin)
Nexus:      http://localhost:8081
```

---

## TOOL-BY-TOOL DEMONSTRATION

============================================================

## TOOL 1: Git + GitHub (Version Control)
## Category: Source Code Management
============================================================

### What it does in SplitX:
Tracks every code change, enables collaboration, maintains full
project history. Every feature and bugfix is versioned.

### File Location:
- Repository: https://github.com/Sayandip-Jana-1018/SplitX
- Local: .git/ directory (hidden)

### Demo Commands:
```powershell
# Show recent commit history
git log --oneline -15

# Show all branches
git branch -a

# Show last commit details
git show --stat HEAD
```

### Expected Output:
```
7486102 feat: add receiver-approved settlement flow
60f8456 Fix README screenshot links
c95d942 Update README.md
f555006 Add README screenshot gallery
...
```

### What to say:
"Git is our version control system. Every change to SplitX is
tracked with meaningful commit messages following the Conventional
Commits standard. You can see feat: for features, fix: for bug
fixes, chore: for maintenance. This is enforced automatically
by our next tool - Husky."

### What to show:
1. GitHub repo main page - show the code structure
2. GitHub commits tab - show the commit history
3. Terminal - run git log to show local history


============================================================

## TOOL 2: Husky (Git Hooks - Code Quality Gates)
## Category: Developer Workflow Automation
============================================================

### What it does in SplitX:
Runs automated quality checks BEFORE code is committed.
Two hooks:
  - pre-commit: Runs ESLint (zero warnings allowed)
  - commit-msg: Enforces conventional commit format

### File Locations:
- .husky/pre-commit     --> runs: npx eslint --max-warnings 0 .
- .husky/commit-msg     --> runs: npx --no -- commitlint --edit $1

### Demo Commands:
```powershell
# Show the hook files
type .husky\pre-commit
type .husky\commit-msg

# DEMO: Try a BAD commit message (will be REJECTED)
git commit --allow-empty -m "updated stuff"
```

### Expected Output (for bad commit):
```
input: updated stuff
subject may not be empty [subject-empty]
type may not be empty [type-empty]
Found 2 problems, 0 warnings
husky - commit-msg script failed (code 1)
```

### Then show a GOOD commit:
```powershell
git commit --allow-empty -m "chore: demo conventional commits"
```

### Expected Output (for good commit):
```
[main abc1234] chore: demo conventional commits
```

### Cleanup (after demo):
```powershell
git reset HEAD~1
```

### What to say:
"Husky acts as a gatekeeper. No developer can push code with lint
errors or non-standard commit messages. This ensures code quality
at the very first checkpoint - the developer's own machine."


============================================================

## TOOL 3: GitHub Actions (Cloud CI Pipeline)
## Category: Continuous Integration
============================================================

### What it does in SplitX:
Runs an automated 4-step pipeline on every push to main:
  Step 1: Checkout code
  Step 2: Run tests (npm test)
  Step 3: Run linter (npm run lint)
  Step 4: Build production bundle (npm run build)

### File Location:
- .github/workflows/ci.yml

### Demo Commands:
```powershell
# Show the workflow file
type .github\workflows\ci.yml
```

### What to show:
1. Open GitHub -> Actions tab
   URL: https://github.com/Sayandip-Jana-1018/SplitX/actions
2. Show the list of workflow runs (all green checks)
3. Click into any run -> show the step-by-step logs
4. Show the ci.yml file and walk through each step

### What to say:
"GitHub Actions is our cloud-based CI pipeline. Every time code is
pushed to the main branch, it automatically runs tests, linting,
and a production build. If ANY step fails, the push is flagged.
You can see here all 8+ runs have passed successfully. This is
our FIRST line of defense in the cloud."


============================================================

## TOOL 4: Docker (Containerization)
## Category: Application Packaging
============================================================

### What it does in SplitX:
Packages the entire Next.js application into a lightweight,
portable container. Uses a 3-stage multi-stage build:
  Stage 1 (deps):    Install npm dependencies
  Stage 2 (builder): Build the Next.js app + Prisma
  Stage 3 (runner):  Minimal production image with non-root user

### File Location:
- Dockerfile (root)

### Security features:
- Non-root user (nextjs:nodejs, UID 1001)
- Alpine Linux base (minimal attack surface)
- HEALTHCHECK for Kubernetes probes
- OCI metadata labels

### Demo Commands:
```powershell
# Show the Dockerfile
type Dockerfile

# Build the Docker image
docker build -t splitx:demo .

# Check image size (should be ~200-300MB, not 1GB+)
docker images splitx

# Run the container
docker run -d --name splitx-demo -p 3001:3000 --env-file .env splitx:demo

# Check health
docker ps --filter name=splitx-demo

# Cleanup
docker stop splitx-demo && docker rm splitx-demo
```

### Expected output for docker images:
```
REPOSITORY   TAG    IMAGE ID       CREATED          SIZE
splitx       demo   abc123def456   10 seconds ago   ~250MB
```

### What to say:
"Docker containerizes our application. We use a multi-stage build -
3 stages. The first installs dependencies, the second builds the app,
and the third creates a minimal production image. The final image runs
as a non-root user for security and includes a HEALTHCHECK that
Kubernetes uses to know if the app is alive. The multi-stage approach
reduces our image from ~1.5GB to ~250MB."


============================================================

## TOOL 5: Docker Compose (Multi-Container Orchestration)
## Category: Local Development & Service Orchestration
============================================================

### What it does in SplitX:
Defines and runs 8 interconnected services with one command.
Uses profiles to optionally enable monitoring and CI tools.

### Services:
| Service    | Port  | Profile     | Purpose                    |
|------------|-------|-------------|----------------------------|
| splitx     | 3000  | default     | Main application           |
| postgres   | 5432  | default     | Database                   |
| redis      | 6379  | default     | Cache / Rate limiting      |
| prometheus | 9090  | monitoring  | Metrics collection         |
| grafana    | 3001  | monitoring  | Dashboard visualization    |
| jenkins    | 8080  | ci          | CI/CD pipeline             |
| sonarqube  | 9000  | ci          | Code quality analysis      |
| nexus      | 8081  | ci          | Artifact repository        |

### File Location:
- docker-compose.yml (root)

### Demo Commands:
```powershell
# Show the compose file
type docker-compose.yml

# Show running containers
docker compose --profile monitoring --profile ci ps

# Show container logs for a specific service
docker compose logs splitx-app --tail 20

# Show the network
docker network ls | findstr splitx
```

### Expected output for ps:
```
NAME                STATUS          PORTS
splitx-app          running         0.0.0.0:3000->3000/tcp
splitx-postgres     running         0.0.0.0:5432->5432/tcp
splitx-redis        running         0.0.0.0:6379->6379/tcp
splitx-prometheus   running         0.0.0.0:9090->9090/tcp
splitx-grafana      running         0.0.0.0:3001->3000/tcp
splitx-jenkins      running         0.0.0.0:8080->8080/tcp
splitx-sonarqube    running         0.0.0.0:9000->9000/tcp
splitx-nexus        running         0.0.0.0:8081->8081/tcp
```

### What to say:
"Docker Compose orchestrates our entire stack. With one command,
we spin up 8 services - the app, database, cache, monitoring, and
CI tools - all connected on a private network called splitx-network.
We use profiles so you can run just the app, or add monitoring,
or add CI tools as needed. Health checks ensure services start
in the correct order."


============================================================

## TOOL 6: Prometheus (Metrics Collection & Alerting)
## Category: Observability - Metrics
============================================================

### What it does in SplitX:
Collects real-time metrics from the application every 15 seconds.
Tracks HTTP requests, response times, error rates, and custom
business metrics (transactions, settlements, AI chats).

### File Locations:
- src/lib/metrics.ts                          --> Custom metric definitions
- src/proxy.ts                                --> HTTP request instrumentation
- src/app/api/metrics/route.ts                --> /api/metrics endpoint
- monitoring/prometheus/prometheus.yml        --> Scrape config
- monitoring/prometheus/alert-rules.yml       --> 4 alert rules

### Custom Metrics Defined:
| Metric Name                              | Type      | Purpose                    |
|------------------------------------------|-----------|----------------------------|
| splitx_http_requests_total               | Counter   | Total HTTP requests        |
| splitx_http_request_duration_seconds     | Histogram | Request latency            |
| splitx_transactions_created_total        | Counter   | Business: transactions     |
| splitx_settlements_completed_total       | Counter   | Business: settlements      |
| splitx_ai_chat_requests_total            | Counter   | Business: AI usage         |
| splitx_active_groups                     | Gauge     | Current active groups      |
| splitx_app_info                          | Gauge     | App version metadata       |

### Alert Rules (monitoring/prometheus/alert-rules.yml):
1. HighErrorRate   - Fires when >5% of requests return 5xx errors
2. HighLatency     - Fires when p95 latency exceeds 2 seconds
3. ApplicationDown - Fires when app is unreachable for 1 minute
4. HighRequestRate - Fires when >100 req/s (possible DDoS)

### Demo - Open Prometheus UI:
```
URL: http://localhost:9090
```

### Demo Commands in Prometheus UI:
1. Go to Graph tab
2. Type: splitx_http_requests_total -> Click Execute
   - Shows total request count broken down by method, route, status
3. Type: rate(splitx_http_requests_total[5m]) -> Execute
   - Shows request rate per second over last 5 minutes
4. Type: splitx_http_request_duration_seconds_bucket -> Execute
   - Shows latency distribution
5. Go to Alerts tab
   - Shows all 4 configured alert rules and their current state

### Alternative: Raw metrics endpoint
```powershell
# Hit the metrics endpoint directly (secured with bearer token)
curl -H "Authorization: Bearer splitx-metrics-secret" http://localhost:3000/api/metrics
```

### Expected Output (partial):
```
# HELP splitx_http_requests_total Total number of HTTP requests
# TYPE splitx_http_requests_total counter
splitx_http_requests_total{method="GET",route="/api/health",status_code="200"} 42
splitx_http_requests_total{method="GET",route="/dashboard",status_code="200"} 15
...
```

### What to say:
"Prometheus is our metrics backbone. Every HTTP request to SplitX is
instrumented in the middleware (proxy.ts). We track method, route,
status code, and response time. We also have custom business metrics -
how many transactions were created, settlements completed, AI chats used.
Prometheus scrapes our /api/metrics endpoint every 15 seconds, secured
with a bearer token. We have 4 alert rules - for example, if more than
5% of requests fail, it triggers a critical alert."


============================================================

## TOOL 7: Grafana (Dashboards & Visualization)
## Category: Observability - Visualization
============================================================

### What it does in SplitX:
Visualizes Prometheus metrics on beautiful, auto-provisioned dashboards.
Shows request rates, latency percentiles, error rates, and business
metrics in real-time graphs.

### File Locations:
- monitoring/grafana/dashboards/splitx-overview.json  --> Dashboard definition
- monitoring/grafana/provisioning/                     --> Auto-provisioning config

### Demo - Open Grafana:
```
URL:      http://localhost:3001
Login:    admin
Password: splitx_grafana
```

### Navigation:
1. Left sidebar -> Dashboards
2. Click "SplitX Overview"
3. You should see panels with:
   - HTTP Request Rate (requests/second)
   - HTTP Error Rate (% of 5xx responses)
   - Response Time Distribution (p50, p95, p99)
   - Active Groups gauge
   - Business Metrics (transactions, settlements)

### What to say:
"Grafana turns raw Prometheus metrics into actionable dashboards.
This SplitX Overview dashboard is auto-provisioned - it loads
automatically from a JSON file, no manual setup needed. You can see
real-time request rates, latency percentiles, and error rates. In
production, this would be on a big monitor in the ops room."


============================================================

## TOOL 8: Jenkins (Self-Hosted CI/CD Pipeline)
## Category: Continuous Integration / Continuous Deployment
============================================================

### What it does in SplitX:
Enterprise-grade 8-stage CI/CD pipeline. Unlike GitHub Actions
which runs in the cloud, Jenkins runs on your own infrastructure
giving full control.

### The 8 Pipeline Stages:
| Stage | Name              | What it does                              |
|-------|-------------------|-------------------------------------------|
| 1     | Checkout          | Clones the repo from GitHub               |
| 2     | Install           | Runs npm ci to install dependencies       |
| 3     | Quality Checks    | Runs Test + Lint IN PARALLEL              |
| 4     | SonarQube Analysis| Static code analysis for bugs/smells      |
| 5     | Docker Build      | Builds the production container image     |
| 6     | Trivy Scan        | Scans image for security vulnerabilities  |
| 7     | Nexus Push        | Pushes image to private artifact registry |
| 8     | Deploy to K8s     | Deploys to Kubernetes via Helm            |

### File Locations:
- jenkins/Jenkinsfile           --> Pipeline definition (8 stages)
- jenkins/Dockerfile.jenkins    --> Custom Jenkins image with tools
- jenkins/plugins.txt           --> Required Jenkins plugins

### Custom Jenkins Image includes:
- Docker CLI (to build images)
- kubectl (to deploy to Kubernetes)
- Helm (package manager for K8s)
- Trivy (security scanner)
- AWS CLI (cloud operations)
- Node.js 20 (for npm commands)

### Demo - Open Jenkins:
```
URL: http://localhost:8080
```

### First-time setup (if needed):
```powershell
# Get the initial admin password
docker compose exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

### Demo Commands:
```powershell
# Show the Jenkinsfile
type jenkins\Jenkinsfile

# Show the custom Docker image
type jenkins\Dockerfile.jenkins

# Show installed plugins
type jenkins\plugins.txt
```

### What to say:
"Jenkins is our self-hosted CI/CD engine. While GitHub Actions runs
simple checks in the cloud, Jenkins runs our full 8-stage enterprise
pipeline. Stage 3 runs tests and linting IN PARALLEL for speed.
Stage 4 sends code to SonarQube for deep analysis. Stage 5 builds
a Docker image. Stage 6 scans it with Trivy for CVEs. Stage 7 pushes
to our private Nexus registry. Stage 8 deploys to Kubernetes using Helm.
We even built a CUSTOM Jenkins Docker image that comes pre-installed
with Docker CLI, kubectl, Helm, Trivy, and AWS CLI."


============================================================

## TOOL 9: SonarQube (Code Quality Analysis)
## Category: Static Analysis / Code Quality
============================================================

### What it does in SplitX:
Deep static code analysis - finds bugs, code smells, security
vulnerabilities, code duplications. Calculates code coverage.
Integrated into Jenkins pipeline Stage 4.

### File Locations:
- docker-compose.yml (lines 138-153)   --> Service definition
- jenkins/Jenkinsfile (Stage 4)        --> Pipeline integration

### Demo - Open SonarQube:
```
URL:      http://localhost:9000
Login:    admin
Password: admin (you'll be asked to change on first login)
```

### What to show:
1. SonarQube Dashboard - shows the main landing page
2. Show the Jenkinsfile Stage 4 code:
   - sonar-scanner sends code to SonarQube
   - It analyzes src/ folder
   - It reads coverage from coverage/lcov.info

### What to say:
"SonarQube performs deep static analysis on every build. It checks
for bugs, security vulnerabilities, code smells, and duplication.
It also enforces Quality Gates - for example, if code coverage drops
below a threshold or new critical bugs are introduced, the pipeline
fails and the deployment is blocked. This is Stage 4 in our Jenkins
pipeline."


============================================================

## TOOL 10: Nexus (Artifact Repository)
## Category: Artifact Management
============================================================

### What it does in SplitX:
Private Docker image registry. After Jenkins builds and scans a
Docker image, it pushes it to Nexus for versioned storage.
Like a private Docker Hub for the organization.

### File Locations:
- docker-compose.yml (lines 155-167)   --> Service definition
- jenkins/Jenkinsfile (Stage 7)        --> Push step

### Demo - Open Nexus:
```
URL: http://localhost:8081
```

### First-time setup:
```powershell
# Get the initial admin password
docker compose exec nexus cat /nexus-data/admin.password
```

### What to show:
1. Nexus web UI - repository browser
2. Jenkinsfile Stage 7: docker tag + docker push commands
3. Explain image versioning: each build gets tagged with git commit hash

### What to say:
"Nexus is our private artifact repository. Instead of pushing Docker
images to public Docker Hub, we push to our own Nexus instance.
Each image is tagged with the git commit hash for traceability.
In Stage 7 of our Jenkins pipeline, both a commit-specific tag and
a 'latest' tag are pushed. This means we can always roll back to
any previous version."


============================================================

## TOOL 11: Trivy (Container Security Scanning)
## Category: Security / DevSecOps
============================================================

### What it does in SplitX:
Scans Docker images for known CVEs (Common Vulnerabilities and
Exposures). Integrated into Jenkins pipeline Stage 6.
Blocks deployments with CRITICAL vulnerabilities.

### File Locations:
- jenkins/Jenkinsfile (Stage 6)           --> Scan step
- jenkins/Dockerfile.jenkins (line 33-35) --> Trivy installation

### Demo Commands:
```powershell
# Build the app image first (if not already built)
docker build -t splitx:demo .

# Run Trivy scan
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy image splitx:demo
```

### Expected Output:
```
splitx:demo (alpine 3.19)
=========================
Total: 5 (UNKNOWN: 0, LOW: 3, MEDIUM: 2, HIGH: 0, CRITICAL: 0)

+-----------+------------------+----------+-------------------+
| LIBRARY   | VULNERABILITY    | SEVERITY | INSTALLED VERSION |
+-----------+------------------+----------+-------------------+
| libssl3   | CVE-2024-XXXXX   | MEDIUM   | 3.1.4-r0          |
| libcrypto | CVE-2024-XXXXX   | LOW      | 3.1.4-r0          |
...
```

### What to say:
"Trivy is our security scanner. In Stage 6 of the Jenkins pipeline,
every Docker image is scanned for known vulnerabilities before it can
be pushed to Nexus or deployed. We use --exit-code 1 --severity CRITICAL
which means the pipeline FAILS if any critical CVE is found. It also
generates an HTML report that's archived as a build artifact. This is
our DevSecOps layer - security is built into the pipeline, not an
afterthought."


============================================================

## TOOL 12: Terraform (Infrastructure as Code)
## Category: Cloud Infrastructure Provisioning
============================================================

### What it does in SplitX:
Defines the entire AWS cloud infrastructure as code:
  - VPC (Virtual Private Cloud) with public/private subnets
  - ECR (Elastic Container Registry) for Docker images
  - EKS (Elastic Kubernetes Service) for container orchestration

### File Locations:
- terraform/main.tf          --> Root config (composes 3 modules)
- terraform/variables.tf     --> Input variables
- terraform/outputs.tf       --> Output values
- terraform/backend.tf       --> State storage config (S3)
- terraform/versions.tf      --> Provider versions
- terraform/terraform.tfvars --> Variable values
- terraform/modules/vpc/     --> VPC module
- terraform/modules/ecr/     --> ECR module
- terraform/modules/eks/     --> EKS module

### Demo Commands:
```powershell
cd terraform

# Show the root config
type main.tf

# Show variables
type variables.tf

# Initialize Terraform (downloads providers)
terraform init

# DRY RUN - show what WOULD be created (NO cost, NO changes)
terraform plan
```

### Expected output for terraform plan:
```
Plan: 23 to add, 0 to change, 0 to destroy.

Changes to Outputs:
  + ecr_repository_url = (known after apply)
  + eks_cluster_name   = (known after apply)
  + vpc_id             = (known after apply)
```

### IMPORTANT: DO NOT run terraform apply during demo!
It creates real AWS resources and costs money.
terraform plan is safe - it only shows what WOULD happen.

### What to say:
"Terraform is our Infrastructure as Code tool. Instead of clicking
through the AWS console to create VPCs, container registries, and
Kubernetes clusters, we define everything in code. This main.tf
composes 3 modules - VPC for networking, ECR for Docker image storage,
and EKS for Kubernetes. The terraform plan command shows exactly what
would be created - 23 resources - without actually creating anything.
This is version-controlled, reviewable, and reproducible. If we need
to tear everything down, one command: terraform destroy."


============================================================

## TOOL 13: Ansible (Configuration Management)
## Category: Server Provisioning & Automation
============================================================

### What it does in SplitX:
Automates the setup of fresh EC2 server instances. Installs Docker,
kubectl, Helm, AWS CLI, and configures firewall rules - all with
a single playbook (14 automated tasks).

### File Locations:
- ansible/ansible.cfg                     --> Configuration
- ansible/inventory/                      --> Target hosts
- ansible/playbooks/setup-node.yml        --> Main playbook (147 lines, 14 tasks)

### Playbook Tasks (14 steps):
 1. Update apt cache and upgrade packages
 2. Install system packages (curl, wget, jq, htop, etc.)
 3. Add Docker GPG key
 4. Add Docker repository
 5. Install Docker Engine
 6. Start and enable Docker service
 7. Add user to docker group
 8. Download and install kubectl
 9. Verify kubectl installation
10. Install Helm
11. Download and install AWS CLI v2
12. Configure UFW firewall (SSH, HTTP, HTTPS, K8s API)
13. Enable UFW with deny-by-default policy
14. Verify all tools and print versions

### Demo Commands:
```powershell
# Show the playbook
type ansible\playbooks\setup-node.yml

# Show ansible config
type ansible\ansible.cfg

# Syntax check (validates YAML without running)
# Note: Requires ansible installed in WSL
wsl -d Ubuntu -- ansible-playbook ansible/playbooks/setup-node.yml --syntax-check
```

### Expected Output for syntax-check:
```
playbook: ansible/playbooks/setup-node.yml
```

### What to say:
"Ansible automates server configuration. Instead of SSH-ing into
each EC2 instance and running 14 commands manually, this single
playbook does everything. It installs Docker, kubectl, Helm, AWS CLI,
and even configures the firewall with a deny-by-default policy.
The verification task at the end prints all installed tool versions
to confirm success. If we had 10 servers, this playbook would
configure all 10 simultaneously."


============================================================

## BONUS TOOLS (Mentioned in synopsis but integrated into above)

### Helm (Kubernetes Package Manager)
- Location: helm/splitx/Chart.yaml, helm/splitx/values.yaml
- Used in: Jenkins Stage 8 (Deploy to K8s)
- Demo: type helm\splitx\Chart.yaml
- What it does: Templates Kubernetes manifests with configurable values

### Kubernetes (Container Orchestration)
- Used through: EKS (Terraform module), Helm charts, kubectl
- Not a separate tool to demo - it's the target platform
- The entire pipeline deploys TO Kubernetes

============================================================

## ARCHITECTURE SUMMARY

```
Developer Machine                    Cloud (AWS)
+-------------------+               +------------------+
| Code Editor       |               | VPC              |
| Git + Husky       |----push--->   |   ECR (images)   |
| (pre-commit,      |               |   EKS (K8s)      |
|  commit-msg)      |               +------------------+
+-------------------+                      ^
         |                                 |
         v                                 |
+-------------------+               +------+-------+
| GitHub            |               | Jenkins      |
|  Actions (CI)     |               |  8 Stages:   |
|  - test           |               |  1.Checkout   |
|  - lint           |               |  2.Install    |
|  - build          |               |  3.Test+Lint  |
+-------------------+               |  4.SonarQube  |
                                    |  5.Docker     |
         Monitoring                 |  6.Trivy      |
+-------------------+               |  7.Nexus Push |
| Prometheus        |               |  8.K8s Deploy |
|  -> scrapes app   |               +--------------+
|  -> alert rules   |
|       |           |
|       v           |
| Grafana           |
|  -> dashboards    |
+-------------------+

Infrastructure (defined as code):
  Terraform -> VPC + ECR + EKS
  Ansible   -> Server setup automation
```

============================================================

## SHUTDOWN COMMANDS (After demo)

```powershell
# Stop all containers
docker compose --profile monitoring --profile ci down

# Stop and remove volumes (clean slate)
docker compose --profile monitoring --profile ci down -v

# Remove built images
docker rmi splitx:demo splitx:local 2>$null
```

============================================================

## TROUBLESHOOTING

### "unable to get image" / "cannot find dockerDesktopLinuxEngine"
- Docker Desktop is NOT running
- Fix: Open Docker Desktop from Start Menu, wait for green icon

### Jenkins shows blank page
- It's still starting up (takes 2-3 minutes)
- Fix: Wait and refresh

### SonarQube shows "SonarQube is starting"
- It needs 3-5 minutes to initialize
- Fix: Wait and refresh

### Prometheus shows "no data"
- The app container might not be healthy yet
- Fix: Check with: docker compose ps
- Wait for splitx-app to show "healthy"

### Grafana login fails
- Credentials: admin / splitx_grafana
- If changed previously, try: admin / admin

### Port conflicts
- Another app is using the same port
- Fix: Stop the conflicting app, or change ports in docker-compose.yml

============================================================
## END OF DEMO GUIDE
============================================================
