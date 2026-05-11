# ☁️ SplitX — AWS Full Setup Guide
# From Scratch to Production-Grade DevOps Pipeline
# You have $100 AWS Credit — This guide costs ~$6 for a 24hr demo

> **Prerequisite tools already installed on your machine:**
> `aws`, `terraform`, `kubectl`, `helm`, `docker` — all confirmed working locally.

---

## 💰 Cost Estimate (with $100 credit)

| Resource | Per Hour | Per Day | Notes |
|---|---|---|---|
| EKS Control Plane | $0.10 | $2.40 | 1 cluster |
| 2× t3.medium EC2 nodes | $0.083 | $2.00 | Worker nodes |
| ALB Load Balancer | $0.025 | $0.60 | App traffic |
| ECR Storage | ~$0.01 | $0.24 | Docker images |
| **TOTAL** | **~$0.22** | **~$5.25** | |

> **$100 credit = ~19 days** even if you forget to destroy. But always run `terraform destroy` after the presentation.

---

## 📋 Phase 0 — AWS Account & CLI Setup

### Step 1: Configure AWS CLI with your credentials

Go to **AWS Console → IAM → Users → Your User → Security Credentials → Create Access Key**

```bash
aws configure
# AWS Access Key ID: <paste from console>
# AWS Secret Access Key: <paste from console>
# Default region: us-east-1
# Default output format: json
```

Verify it works:
```bash
aws sts get-caller-identity
```

Expected output:
```json
{
    "UserId": "AIDAXXXXXXXXXXXXXXXXX",
    "Account": "918183256068",
    "Arn": "arn:aws:iam::918183256068:user/your-username"
}
```

### Step 2: Install eksctl (needed for EKS nodegroup management)

```powershell
# Windows — download eksctl
curl -L "https://github.com/weaveworks/eksctl/releases/latest/download/eksctl_Windows_amd64.zip" -o eksctl.zip
Expand-Archive eksctl.zip -DestinationPath C:\tools\
# Add C:\tools to your PATH
```

---

## 📦 Phase 1 — ECR (Elastic Container Registry)

Create the Docker image registry where Jenkins will push your built images.

### Step 1: Create ECR Repository

```bash
aws ecr create-repository \
    --repository-name splitx-app \
    --region us-east-1 \
    --image-scanning-configuration scanOnPush=true
```

Expected output (save the `repositoryUri`):
```json
{
    "repository": {
        "repositoryUri": "918183256068.dkr.ecr.us-east-1.amazonaws.com/splitx-app",
        "repositoryName": "splitx-app"
    }
}
```

### Step 2: Login Docker to ECR

```bash
aws ecr get-login-password --region us-east-1 | \
    docker login --username AWS --password-stdin \
    918183256068.dkr.ecr.us-east-1.amazonaws.com
```

Expected: `Login Succeeded`

### Step 3: Build and Push Your Image to ECR

```bash
# Build (from SplitX project root)
docker build -t splitx-app:latest .

# Tag for ECR
docker tag splitx-app:latest \
    918183256068.dkr.ecr.us-east-1.amazonaws.com/splitx-app:latest

# Push
docker push 918183256068.dkr.ecr.us-east-1.amazonaws.com/splitx-app:latest
```

---

## 🏗️ Phase 2 — Terraform (Infrastructure as Code)

Terraform creates your entire AWS infrastructure: VPC, subnets, EKS cluster, EC2 nodes, IAM roles, security groups.

### Step 1: Create S3 bucket for Terraform remote state

```bash
aws s3 mb s3://splitx-terraform-state-918183256068 --region us-east-1

# Enable versioning (important for state recovery)
aws s3api put-bucket-versioning \
    --bucket splitx-terraform-state-918183256068 \
    --versioning-configuration Status=Enabled
```

### Step 2: Update terraform/backend.tf to use S3

Open `terraform/backend.tf` and change to:
```hcl
terraform {
  backend "s3" {
    bucket = "splitx-terraform-state-918183256068"
    key    = "splitx/terraform.tfstate"
    region = "us-east-1"
  }
}
```

### Step 3: Initialize and Plan

```bash
cd terraform
terraform init -reconfigure
terraform plan
```

Expected: `Plan: 23 to add, 0 to change, 0 to destroy.`

Key resources Terraform creates:
- VPC with public + private subnets across 2 AZs
- Internet Gateway + NAT Gateway
- EKS cluster (`splitx-eks`)
- EKS managed node group (2× t3.medium)
- ECR repository (if not created in Phase 1)
- IAM roles for EKS + nodes + ALB controller
- Security groups

### Step 4: Apply (takes ~15 minutes)

```bash
terraform apply
# Type: yes
```

Expected final output:
```
Apply complete! Resources: 23 added, 0 changed, 0 destroyed.

Outputs:
  eks_cluster_name   = "splitx-eks"
  eks_cluster_endpoint = "https://XXXXX.gr7.us-east-1.eks.amazonaws.com"
  ecr_repository_url = "918183256068.dkr.ecr.us-east-1.amazonaws.com/splitx-app"
```

---

## ⚙️ Phase 3 — Ansible (EC2 Node Configuration)

Ansible configures the EC2 worker nodes with required software (Docker, kubectl, aws-cli, monitoring agents).

### Step 1: Get EC2 node IPs from AWS

```bash
aws ec2 describe-instances \
    --filters "Name=tag:kubernetes.io/cluster/splitx-eks,Values=owned" \
    --query "Reservations[*].Instances[*].PublicIpAddress" \
    --output text
```

### Step 2: Update inventory file

Edit `ansible/inventory/hosts.ini`:
```ini
[k8s_workers]
<NODE_1_IP> ansible_user=ec2-user ansible_ssh_private_key_file=~/.ssh/splitx-key.pem
<NODE_2_IP> ansible_user=ec2-user ansible_ssh_private_key_file=~/.ssh/splitx-key.pem
```

### Step 3: Create SSH key pair (if not done)

```bash
aws ec2 create-key-pair \
    --key-name splitx-key \
    --query 'KeyMaterial' \
    --output text > ~/.ssh/splitx-key.pem
chmod 400 ~/.ssh/splitx-key.pem
```

### Step 4: Run the playbook

```bash
cd ansible
ansible-playbook -i inventory/hosts.ini playbooks/setup-node.yml
```

Expected: All tasks complete with `ok` or `changed`, no failures.

---

## ☸️ Phase 4 — Kubernetes + kubectl

### Step 1: Connect kubectl to your EKS cluster

```bash
aws eks update-kubeconfig \
    --name splitx-eks \
    --region us-east-1
```

### Step 2: Verify cluster is running

```bash
kubectl get nodes
```

Expected:
```
NAME                          STATUS   ROLES    AGE   VERSION
ip-10-0-1-xx.ec2.internal     Ready    <none>   5m    v1.32.x
ip-10-0-2-xx.ec2.internal     Ready    <none>   5m    v1.32.x
```

### Step 3: Create namespaces

```bash
kubectl create namespace splitx
kubectl create namespace monitoring
kubectl create namespace argocd
```

### Step 4: Create secret for database connection

```bash
kubectl create secret generic splitx-env \
    --namespace splitx \
    --from-literal=DATABASE_URL="postgresql://user:pass@host/db?sslmode=require" \
    --from-literal=NEXTAUTH_SECRET="your-secret" \
    --from-literal=NEXTAUTH_URL="http://<ALB_DNS_NAME>"
```

---

## 🪖 Phase 5 — Helm (Deploy SplitX App)

### Step 1: Install AWS Load Balancer Controller (required for ALB)

```bash
# Add EKS Helm repo
helm repo add eks https://aws.github.io/eks-charts
helm repo update

# Install ALB controller
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
    --namespace kube-system \
    --set clusterName=splitx-eks \
    --set serviceAccount.create=true
```

### Step 2: Deploy SplitX with Helm

```bash
cd /path/to/SplitX

helm install splitx ./helm/splitx \
    --namespace splitx \
    --create-namespace \
    --set image.repository=918183256068.dkr.ecr.us-east-1.amazonaws.com/splitx-app \
    --set image.tag=latest \
    --set image.pullPolicy=Always \
    --set ingress.enabled=true \
    --set ingress.className=alb
```

### Step 3: Verify deployment

```bash
# Watch pods come up
kubectl get pods -n splitx -w

# Check HPA (auto-scaling)
kubectl get hpa -n splitx

# Get the ALB DNS name (your app's public URL)
kubectl get ingress -n splitx
```

Expected pod output:
```
NAME                              READY   STATUS    RESTARTS   AGE
splitx-app-7d9f8b-xxxxx           1/1     Running   0          2m
splitx-app-7d9f8b-yyyyy           1/1     Running   0          2m
```

### Step 4: Verify Helm release

```bash
helm list -n splitx
helm history splitx -n splitx
```

---

## 📊 Phase 6 — Monitoring on EKS (Prometheus + Grafana + Loki)

### Deploy Prometheus Stack to EKS

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

helm install monitoring prometheus-community/kube-prometheus-stack \
    --namespace monitoring \
    --create-namespace \
    --set grafana.adminPassword=splitx_grafana \
    --set prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues=false
```

### Deploy Loki Stack to EKS

```bash
helm repo add grafana https://grafana.github.io/helm-charts

helm install loki grafana/loki-stack \
    --namespace monitoring \
    --set grafana.enabled=false \
    --set promtail.enabled=true
```

### Access Grafana on EKS

```bash
# Port-forward Grafana to localhost
kubectl port-forward svc/monitoring-grafana -n monitoring 3001:80
# Open: http://localhost:3001
# Login: admin / splitx_grafana
```

---

## 🔄 Phase 7 — ArgoCD on EKS

### Step 1: Install ArgoCD

```bash
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Wait for pods to be ready
kubectl wait --for=condition=available deployment/argocd-server -n argocd --timeout=300s
```

### Step 2: Get ArgoCD admin password

```bash
kubectl -n argocd get secret argocd-initial-admin-secret \
    -o jsonpath="{.data.password}" | base64 -d
```

### Step 3: Access ArgoCD UI

```bash
kubectl port-forward svc/argocd-server -n argocd 8090:443
# Open: https://localhost:8090
# Login: admin / <password from step 2>
```

### Step 4: Create the SplitX ArgoCD Application

```bash
kubectl apply -f argocd/splitx-app.yml
```

ArgoCD will immediately connect to GitHub and sync the Helm chart. The spiderweb tree will show all Kubernetes resources.

---

## 🔧 Phase 8 — Jenkins CI/CD Full Integration

### Update Jenkins environment variables

In Jenkins → Manage Jenkins → Environment Variables, add:
```
ECR_REGISTRY=918183256068.dkr.ecr.us-east-1.amazonaws.com
ECR_REPO=splitx-app
EKS_CLUSTER=splitx-eks
AWS_REGION=us-east-1
ARGOCD_SERVER=<your-argocd-server-address>
ARGOCD_TOKEN=<generated from ArgoCD UI → Settings → Accounts → Generate Token>
```

### Jenkins pipeline will now run all 9 stages automatically:

1. ✅ Checkout from GitHub
2. ✅ npm ci
3. ✅ ESLint
4. ✅ SonarQube quality gate
5. ✅ `docker build` → tag for ECR
6. ✅ Trivy CVE scan
7. ✅ `docker push` → ECR
8. ✅ `helm upgrade` on EKS
9. ✅ Update `values-dev.yaml` → git push → ArgoCD auto-syncs

---

## 🔍 Phase 9 — Verification Checklist

Run these commands to confirm everything is working:

```bash
# 1. EKS nodes healthy
kubectl get nodes

# 2. SplitX pods running
kubectl get pods -n splitx

# 3. App publicly accessible
kubectl get ingress -n splitx
# Open the ADDRESS in browser

# 4. HPA configured
kubectl get hpa -n splitx

# 5. Helm release healthy
helm status splitx -n splitx

# 6. ArgoCD synced
kubectl get application splitx -n argocd

# 7. Loki receiving logs
kubectl port-forward svc/loki -n monitoring 3100:3100 &
curl http://localhost:3100/loki/api/v1/labels

# 8. ECR image present
aws ecr list-images --repository-name splitx-app --region us-east-1
```

---

## 🛑 IMPORTANT: Destroy After Presentation

**Run this the moment your presentation ends to stop all charges:**

```bash
# 1. Delete Helm releases first
helm uninstall splitx -n splitx
helm uninstall monitoring -n monitoring
helm uninstall loki -n monitoring

# 2. Destroy all Terraform resources (~10 min)
cd terraform
terraform destroy
# Type: yes

# 3. Delete ECR images (optional, ECR has tiny cost)
aws ecr delete-repository \
    --repository-name splitx-app \
    --region us-east-1 \
    --force

# 4. Delete S3 state bucket (optional)
aws s3 rb s3://splitx-terraform-state-918183256068 --force
```

Verify no resources remain:
```bash
aws eks list-clusters --region us-east-1
# Expected: { "clusters": [] }

aws ec2 describe-instances \
    --filters "Name=instance-state-name,Values=running" \
    --query "Reservations[*].Instances[*].InstanceId" \
    --output text
# Expected: (empty)
```

---

## 📌 Quick Reference Card

| Action | Command |
|---|---|
| Verify AWS login | `aws sts get-caller-identity` |
| Deploy infrastructure | `cd terraform && terraform apply` |
| Connect kubectl to EKS | `aws eks update-kubeconfig --name splitx-eks --region us-east-1` |
| ECR login | `aws ecr get-login-password --region us-east-1 \| docker login --username AWS --password-stdin 918183256068.dkr.ecr.us-east-1.amazonaws.com` |
| Push image to ECR | `docker push 918183256068.dkr.ecr.us-east-1.amazonaws.com/splitx-app:latest` |
| Deploy app | `helm install splitx ./helm/splitx -n splitx --create-namespace` |
| Update app | `helm upgrade splitx ./helm/splitx -n splitx --set image.tag=v2` |
| Rollback app | `helm rollback splitx 1 -n splitx` |
| ArgoCD UI | `kubectl port-forward svc/argocd-server -n argocd 8090:443` |
| Grafana UI | `kubectl port-forward svc/monitoring-grafana -n monitoring 3001:80` |
| View app logs | `kubectl logs -n splitx -l app=splitx --tail=50` |
| **DESTROY EVERYTHING** | `cd terraform && terraform destroy` |

---

*SplitX AWS Setup Guide — Account: 918183256068 | Region: us-east-1*
*Estimated cost for 24hr full demo: ~$6 of your $100 credit*
