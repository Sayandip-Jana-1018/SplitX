# Demo day: the runbook

SplitX's demo platform runs on AWS only on the two days that need it: the **rehearsal** and the
**demo**. `aws-up` builds it that morning, and `aws-down` removes it that evening, or at 23:30 IST by
itself. On any other day, `splitsj.vercel.app` serves the app, and the CloudFront address shows an
offline page.

Each step below says what to click, what should happen, and what to do if it doesn't. The design
behind each part is in [DECISIONS.md](DECISIONS.md): D-087 to D-103.

| Day | How long | About |
|---|---|---|
| Rehearsal | about 6 hours (§7) | about $3 |
| Demo | from T-120 to the evening's teardown | about $3 |

The budget alarm (`splitx-guardrails`) emails at $15 a month.

---

## 1. Once: before the first AWS day

These are done once, and stay done.

1. **The two CloudFormation stacks exist:** `splitx-bootstrap` and `splitx-guardrails`
   (`npm run aws:bootstrap`, D-087).
2. **The edge exists.**
   - GitHub → Actions → **AWS edge** → Run workflow, then approve `aws-demo`. It makes the CloudFront
     distribution, which costs nothing while idle.
   - Commit its domain as `NEXTAUTH_URL=https://<domain>` in `k8s/overlays/aws/kustomization.yaml`,
     the one place it is written down.
3. **Sign-in works on the edge.** `/ops` admits operators by their GitHub or Google account.
   - A second GitHub OAuth App, with the callback `https://<domain>/api/auth/callback/github`. Its ID
     and secret go in `.env` as `AWS_GITHUB_ID` and `AWS_GITHUB_SECRET`.
   - The redirect URI `https://<domain>/api/auth/callback/google` in Google's console.
4. **GitHub can reach Jenkins on EKS.** Add a second repository webhook (Settings → Webhooks → Add):
   - **Payload URL:** `https://<domain>/generic-webhook-trigger/invoke?token=<JENKINS_TRIGGER_TOKEN>`
   - **Content type:** `application/json`
   - **Secret:** the same as the first webhook (`GITHUB_WEBHOOK_SECRET` in `.env`)
   - **Events:** Deployments only
5. **The demo database exists.** Create a Neon branch named `demo`, **schema only**, so the classroom's
   accounts never mix with real users'. Put its pooled URL in `.env` as `DEMO_DATABASE_URL`.

## 2. The day before each AWS day

1. **`.env` has everything:** `npm run aws:secrets -- --check` names every key it would write, and
   anything missing. The required keys:
   - `DEMO_DATABASE_URL`, `NEXTAUTH_SECRET`, `METRICS_TOKEN`, `REDIS_PASSWORD`;
   - `GF_ADMIN_PASSWORD`;
   - `JENKINS_ADMIN_PASSWORD`, `GITHUB_WEBHOOK_SECRET`, `JENKINS_TRIGGER_TOKEN`;
   - the Nexus passwords and `ORIGIN_VERIFY_SECRET`, which the script generates if they're missing.

   For `/ops` on EKS, also `OPS_ADMINS`, `OPS_GITHUB_TOKEN` and `SONAR_PROJECT_KEY`. For alert emails,
   `ALERT_SMTP_USERNAME`, `ALERT_SMTP_PASSWORD` and `ALERT_EMAIL_TO`.
2. **Copy them to AWS:** `npm run aws:secrets`. It writes `splitx/demo/app` and `splitx/demo/platform`
   in Secrets Manager and prints key names only. `aws-down` deletes both that evening; `.env` keeps
   the originals.
3. **The Kind rehearsal is green.** GitHub → Actions → **Kind end-to-end**: the newest run, nightly or
   after a push, passed every check. It runs the same platform on a GitHub runner.
4. **Nothing is up already.** The last **AWS down** run is green. A platform left up costs money
   every hour.

## 3. The morning

**T-120: start the platform.** GitHub → Actions → **AWS up** → Run workflow.
- `rehearse_rollback`: tick it on the rehearsal day. On the demo day, choose: ticked, `/ops` and the
  Delivery dashboard show a failed release that Jenkins rolled back that morning; unticked, they
  don't.
- Approve `aws-demo` when GitHub asks.

What `aws-up` does, and roughly how long each step takes:

| Step | Takes | What should happen |
|---|---|---|
| Quota check | seconds | 8 vCPUs available for four nodes |
| Terraform: the platform | 20–25 min | the network, EKS, add-ons, three nodes in two zones |
| The platform checked | 2 min | nodes, zones, add-ons, the policy agent, gp3, metrics-server, teardown access |
| `cluster-up --target eks` | 15–20 min | Secrets from Secrets Manager, the charts, the newest signed release, Jenkins, Nexus, ops-api |
| The load balancer's alarms | 2 min | a second apply, once the ALB exists |
| The edge, online | 5–15 min | CloudFront points at the ALB; `/api/health/live` 200 and `/api/metrics` 403 through it |
| The release, through Jenkins | 2–5 min | a GitHub deployment for `eks`; GitHub's webhook reaches Jenkins through CloudFront |
| **Verify the platform** | about 15 min | `k8s:verify` and `cd:verify --target eks` (D-103): every line PASS or SKIP |

The run's summary page shows each step's table, and the last step shows both verifiers' results. The
reports are kept as the artifact `eks-verify-<run>`.

**T-30: pre-flight.**
1. Open `https://<domain>/ops` and sign in.
2. The **Pre-flight** list at the top must be all green. Each red item names what to fix.
3. On a phone, scan the QR code on the **Join the demo** card: `/scale` must open on the phone.

**T-20: a live release, if the story has one.** Merge a small change to `main` now. CI, the release
and Jenkins' deploy take 15 to 20 minutes, so it lands during the talk.

## 4. The story, through `/ops`

About 15 minutes. Each section on the page is one tool, read live from its own source.

1. **The release on main:** its commit, CI passed, the image scanned, signed (cosign, keyless) and
   attested (SBOM and vulnerabilities), with the digest.
2. **Join the demo:** the room scans the QR code. Every phone plans trips on `/scale`, and each
   answer names the pod that served it.
3. **Tools:** GitHub Actions, CodeQL, Trivy, Dependabot and SonarQube Cloud, each with its own
   verdict. Then Jenkins, Vercel, and the platform.
4. **Pipeline and deliveries:**
   - the release's jobs;
   - each environment's newest deployment: `kind` from the nightly run, `eks` from Jenkins on EKS,
     Production from Vercel.
5. **The cluster:**
   - the nodes across two zones, and the pods with their digests;
   - the autoscaler;
   - Kyverno's admissions: an image the release workflow didn't sign never runs.
6. **The traffic lab.** Start 30 plans a second for 180 seconds.
   - Watch the requests, p95 and errors, and the pods going from 2 towards 10.
   - When pods can't be placed, the Cluster Autoscaler adds the fourth node.
   - The room's phones add to the load.
7. **Alerts, logs and evidence:**
   - alerts: none firing, apart from Watchdog;
   - the application's log, with request IDs;
   - each deployment's evidence in Nexus: its SBOM, the vulnerability report and the deployment
     record, each checked with cosign before it was stored.
8. **AWS:** the CloudFormation stacks and their drift, EKS and its add-ons, CloudFront, and the budget.

**Grafana, if you want it.** It isn't published on the edge. From the laptop:
```bash
aws eks update-kubeconfig --name splitx --region ap-south-1 --alias splitx
```
```bash
kubectl --context splitx -n monitoring port-forward svc/kube-prometheus-stack-grafana 3000:80
```
Then open http://localhost:3000 and sign in as `admin`, with `GF_ADMIN_PASSWORD`.

## 5. When something goes wrong

- **A red pre-flight item:** its text names the fix. After fixing it, GitHub → Actions → **AWS
  verify** runs both verifiers again, without rebuilding anything.
- **`aws-up` failed.** Read the failed step. It stops with the reason:
  - a missing secret: run `npm run aws:secrets`;
  - a missing webhook: see §1.4; the delivery step waits 15 minutes, then says so;
  - too little vCPU quota: raise it in Service Quotas.

  The platform built so far stays up. Fix, then run **AWS up** again: every step picks up where the
  platform is.
- **AWS is unavailable, or the platform won't come up in time.**
  - **First fallback:** the newest green **Kind end-to-end** run. Its summary page has every
    verifier's table (the same platform, its delivery through GitHub's webhook, the traffic lab and
    the autoscaler), and its artifact keeps the reports.
  - **Second fallback:** the screen recording of the rehearsal.
  - **Either way,** the app stays on `splitsj.vercel.app`, and `/ops` there shows the pipeline half.
- **The venue's network fails:** play the recording.

## 6. The evening: take it down

1. GitHub → Actions → **AWS down** → Run workflow. It needs no approval, and it can only remove.
   - It takes the edge offline, then deletes the load balancer and the volumes, then destroys the
     platform, then sweeps anything left by SplitX's tags.
   - Its last step lists everything the platform makes, and fails unless it is all gone.
2. If nobody runs it, it runs itself at 23:30 IST. Budget data lags 8 to 12 hours, so don't count on
   the budget alarm to notice a platform left up.
3. Check the budget email over the next day.

## 7. The rehearsal day

1. **The first hour: the platform alone, then the teardown.**
   - Run **AWS up**, and cancel it once "Check the platform" has passed.
   - Then run **AWS down**, and see it end green with nothing left.
   - This proves Terraform's apply and destroy, and the teardown role, before anything else is
     built on them (B-031).
2. **Then the full run:** `aws-up` with `rehearse_rollback` ticked (§3), then the story (§4) with
   light traffic from a few phones. Record the screen.
3. **Everything that failed:** fix it, push, then run **AWS verify**, not `aws-up`, while the platform
   is up.
4. **The last 90 minutes: take it down** (§6), and confirm the sweep found nothing.
5. **Record what the day proved** in DECISIONS. B-031 lists what only a real day could prove.
