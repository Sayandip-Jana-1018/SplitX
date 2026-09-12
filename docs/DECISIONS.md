# SplitX — Engineering Decision Log

Every decision that shapes the platform, why it was made, what was rejected,
and how it was verified. Newest phase last. Open problems discovered along the
way are tracked at the bottom so none of them get lost between phases.

Status key: ✅ done and verified · 🚧 in progress · 📋 planned

---

## Phase 0 — Baseline, safety and a verification harness

### D-001 · Two tracks: local Kubernetes for rehearsal, AWS EKS for the live demo
**2026-09-12** · ✅ decided

The classroom demo (real traffic driving the autoscaler) runs on **AWS EKS**
behind an ALB and CloudFront, with the Cluster Autoscaler adding nodes. A local
Kind cluster runs the same components for unlimited, free rehearsal and is the
fallback if AWS or the network fails on the day.

- **Rejected — local only:** Kind cannot add nodes, so node-level autoscaling
  can't be shown, and a laptop serving a whole classroom is fragile.
- **Rejected — AWS only:** every rehearsal would cost money and depend on the network.
- **Cost:** ≈ $6.10/day on AWS (EKS control plane $2.40, 2× t3.medium ≈ $2.00,
  NAT $1.08, ALB $0.54, EBS $0.10) — about $1.60 for a 6-hour demo window.

### D-002 · Ansible is removed
**2026-09-12** · ✅ done

The playbook targeted Ubuntu with `ufw` over SSH, but EKS managed nodes run
Amazon Linux 2023 in private subnets with no SSH access, and the inventory was
entirely commented out. It could never have run. Node configuration is handled
by immutable container images and EKS managed node groups; there is no honest
job for Ansible in this architecture, so it is gone rather than kept for show.

### D-003 · Leaked secrets are rotated, not scrubbed from history
**2026-09-12** · ✅ decided, rotation partly pending

A public repo contained a SonarQube token, Nexus/SonarQube/Jenkins admin
passwords (Jenkinsfile, `jenkins/create-job.sh`), ArgoCD and Grafana passwords
(README, AWS setup guide) and a hard-coded dev database password
(docker-compose.yml).

- **Decision:** rotate every value, remove all literals from the working tree,
  and prevent recurrence with gitleaks. History is not rewritten.
- **Rejected — `git filter-repo` + force push:** rewrites every commit SHA,
  breaks clones and PR references, and does not un-leak anything already cloned.
  Rotation is what actually neutralises a leak.
- **Rotated (user, 2026-09-13):** SonarQube token (old token no longer listed),
  Nexus and SonarQube admin, Grafana admin. ArgoCD's password died with its cluster.
- **Pending:** Jenkins admin password — see B-006.

### D-004 · Secret scanning: gitleaks with a custom rule and a fingerprint baseline
**2026-09-13** · ✅ done

- `gitleaks` 8.30.1 runs in the pre-commit hook (staged changes) and in CI over
  the **full history** (`secret-scan` job, archive verified against the release
  SHA-256 checksums — a tampered archive was confirmed to be rejected).
- The default ruleset found the Sonar token and the `curl -u` credentials but
  **missed every plain password literal** that leaked here. `.gitleaks.toml`
  adds `infra-password-literal`, scoped to CI/infra/docs file types.
- Three false-positive shapes are allow-listed by **line pattern**, not by file,
  so a real secret added to those files is still caught.
- The 28 findings in historical commits are baselined by fingerprint in
  `.gitleaksignore`. A fingerprint includes its commit, so re-adding any of
  those secrets in a new commit still fails.
- **Verified:** working tree → *no leaks found*; full history with baseline →
  *no leaks found*.

### D-005 · The bootstrap IAM identity lives outside Terraform
**2026-09-12** · ✅ done

AWS was being operated as the **root user with long-lived access keys**. An IAM
user `splitx-devops` now runs all automation with `splitx-devops-policy`.

- **Least privilege that holds up:** IAM role/policy actions only on names
  matching `splitx-*`; S3 only on `splitx-*` buckets. A leaked key cannot create
  an admin role for itself.
- **Why not Terraform-managed:** Terraform needs these credentials before it can
  create anything; a bad apply could revoke the permissions needed to repair it,
  and a destroy would delete the identity running it. The policy document is
  versioned in `terraform/bootstrap/` instead.
- **Verified:** `aws sts get-caller-identity` → `user/splitx-devops`;
  `ec2:DescribeVpcs` and the state bucket allowed; `iam:ListUsers` **denied**.

### D-006 · One metrics registry per process, on `globalThis`
**2026-09-12** · ✅ done

**Problem, verified empirically:** after 30 API requests, `/api/metrics`
returned `splitx_http_requests_total` with **zero series**. Next.js 16 compiles
`src/lib/metrics.ts` separately into every server entry point — the proxy and
each route handler got their own prom-client `Registry`. The proxy wrote to one;
`/api/metrics` served another. It was *not* an Edge-vs-Node problem:
`functions-config-manifest.json` shows the proxy already runs on `nodejs`.

- **Decision:** the whole metric set is created once and stored on `globalThis`;
  `prom-client` and the OpenTelemetry packages are also listed in
  `serverExternalPackages` so they load from `node_modules` once per process.
- **Rejected — `export const runtime = 'nodejs'` on the proxy:** a no-op; it
  already was.

### D-007 · HTTP metrics come from Next.js's request span, not the proxy
**2026-09-12** · ✅ done

Even with a shared registry, measuring in the proxy is wrong: the proxy returns
`NextResponse.next()` *before* the route handler runs, so it measured only its
own time and could only ever report status 200 or 429 — never a real 4xx/5xx.
The `HighErrorRate` alert could never have fired.

- **Decision:** register an OpenTelemetry `NodeTracerProvider` in
  `src/instrumentation.ts` with a span processor that converts Next's
  `BaseServer.handleRequest` span into metrics. That span carries the **final**
  status code, the matched **route pattern** (`/api/groups/[groupId]` — bounded
  cardinality), and the true duration. Nothing is exported or retained.
- `AlwaysOnSampler`, so a client sending an unsampled `traceparent` cannot turn
  counting off. `provider.register()` installs the AsyncLocalStorage context
  manager Next needs to attach the route to the span.
- **Rejected — wrapping all 38 route handlers:** invasive, easy to forget on new
  routes, and blind to page renders.
- **Rejected — a custom Node server:** diverges from `next start`/standalone
  and from Vercel.

### D-008 · Every response counted exactly once; proxy time measured separately
**2026-09-13** · ✅ done

**Found while verifying D-007:** each request produced *two* request spans.
Next runs the proxy by passing the request through `handleRequest` once with
`middlewareInvoke`; that pass ends by throwing a bubbled result, so its span is
tagged `next.bubble=true` and carries a meaningless status 200. Captured spans:

```
proxy pass:    bubble=true  status=200 (meaningless)  no route   170 ms
real request:  route=/api/me  status=401                         17 ms
```

A request the proxy answers itself (a login redirect, a 429) produces **only**
the bubble span — no route span at all.

- Bubble spans feed **`splitx_proxy_duration_seconds`** and are not counted as
  requests. The 170 ms vs 17 ms above is the Upstash rate-limit round trip —
  the single largest latency cost on the API, now visible instead of hidden.
- Requests the proxy terminates are counted **by the proxy** into
  `splitx_http_requests_total{route="(proxy)"}` with their real status, plus
  `splitx_proxy_decisions_total{decision}`.
- **Verified** (`scripts/verify-metrics.mjs`, 15/15 on a production build):
  40 requests + 1 scrape moved the counter by exactly **+41**; `/api/me` 401,
  unknown-route 404 and the `/dashboard` 307 each counted exactly 10 times.

### D-009 · Business metrics record real events with bounded labels
**2026-09-12** · ✅ done

The five business metrics on the Grafana dashboard were declared but
**incremented nowhere** — permanently zero.

| Metric | Recorded in | Labels |
|---|---|---|
| `splitx_transactions_created_total`, `…_value_paise_total` | `POST /api/transactions`, `/from-receipt` | `source`, `category` |
| `splitx_settlements_completed_total`, `…_value_paise_total` | `/approve`, `/confirm-by-receiver` (cash) | `method` |
| `splitx_ai_chat_requests_total` | `/api/ai/chat` | `provider` (gemini/local), `outcome` |
| `splitx_receipt_scans_total` | `/api/receipt-scan` | `outcome` |
| `splitx_voice_parses_total` | `/api/ai/parse-voice` | `provider` (gemini/gemini_fallback/local) |
| `splitx_active_groups` | refreshed at scrape time, ≤ every 30 s | — |

- Categories are user-definable, so unknown values are folded into `custom`;
  methods outside the known set become `other`. No user input can create
  unbounded time series.
- `callGemini` used to return an apology string on failure, indistinguishable
  from success. It now reports `ok`, so Gemini failures and silent fallbacks
  are measurable.

### D-010 · `/api/metrics` fails closed in production
**2026-09-12** · ✅ done

The endpoint only checked the token *if one was configured*. `METRICS_TOKEN`
was unset on Vercel, so **production metrics were publicly readable** (verified:
HTTP 200, 84 series, no auth). Now closed (verified 401 with no token and with
a wrong token).

- In production an unset token returns **503**, never the metrics.
- The token comparison hashes both sides and uses `timingSafeEqual`, so it is
  constant-time including for length.

### D-011 · Liveness and readiness are separate endpoints
**2026-09-12** · ✅ done

Both Kubernetes probes pointed at `/api/health`, which pings the database. One
Neon cold start would have failed liveness on every pod and restarted them all.

- `GET /api/health/live` — no dependencies; process uptime and pod name.
- `GET /api/health/ready` — `SELECT 1` with a 2 s timeout; 503 when unreachable.
- `GET /api/health` is unchanged; the browser keep-alive still uses it.
- Probes and scrapes skip the rate limiter: they arrive every few seconds from
  inside the cluster and must never wait on Redis.
- Both endpoints are `force-dynamic`, so a response can't be frozen at build time.
- **Tradeoff (B-005):** readiness depends on a database every pod shares.
- **Verified on first run:** readiness correctly reported a real misconfiguration
  in 60 ms — see D-013.

### D-012 · The rate limiter is built once per process
**2026-09-12** · ✅ done

`getRatelimit()` constructed a new Redis client and `Ratelimit` on every API
request, discarding the limiter's in-memory cache each time. It is now memoised.
The deeper limiter problems are B-001.

### D-013 · Local Compose stack: loopback-only admin ports, no colliding host ports
**2026-09-13** · ✅ done

- Every published port except the app now binds to `127.0.0.1`. Jenkins,
  SonarQube, Nexus, Grafana, Prometheus, Loki, Postgres and Redis were reachable
  from any shared network (campus wifi) with passwords that had been public.
- **Found by the new readiness probe:** a native Windows PostgreSQL 17 service
  owns `0.0.0.0:5432`, and another process owns `127.0.0.1:6379`. Host tools
  connecting to `localhost:5432` were reaching the wrong database ("authentication
  failed for user splitx"). Compose Postgres and Redis now publish on host ports
  **5433** and **6380**.
- Password defaults removed: `POSTGRES_PASSWORD`, `METRICS_TOKEN` and
  `GF_ADMIN_PASSWORD` are required (`${VAR:?…}`) — Compose now refuses to start
  with a missing secret instead of silently using a public default.
- SonarQube and Nexus pinned to the exact versions their volumes were created
  with (`10.7.0-community`, `3.92.0`) so an image pull can't trigger an unplanned
  data migration.
- The container healthcheck uses `/api/health/live`.

### D-014 · Prometheus reads the scrape token from a file
**2026-09-13** · ✅ done

`prometheus.yml` had the token as a literal. Prometheus doesn't expand
environment variables in its config, so Compose now passes `METRICS_TOKEN` as a
**secret** mounted at `/run/secrets/metrics_token`, read via `credentials_file`.
On Kubernetes the equivalent is a ServiceMonitor `bearerTokenSecret`.

### D-015 · Repository hygiene
**2026-09-13** · ✅ done

- **Line endings:** `core.autocrlf=true` with no `.gitattributes` left the working
  tree mixed CRLF/LF. A CRLF shell script fails inside a Linux container.
  `.gitattributes` now normalises to LF (CRLF only for `.ps1/.bat/.cmd`).
- **npm over HTTPS:** the machine's user config set the registry to plain
  `http://`, alongside an npm auth token. A project `.npmrc` pins
  `https://registry.npmjs.org/` (project config overrides user config). New
  packages were checked against HTTPS registry integrity hashes — all matched.
- **`.gitignore`:** every `.env*` variant is ignored except `.env.example` (a
  plain `.env` rule had left `.env.bak.*` and `.env.local.docker` committable).
  `.env.local.docker` is untracked.
- **Terraform lock file:** it was already tracked, but `.gitignore` carried a rule
  claiming otherwise (ignore rules don't apply to tracked files). The misleading
  rule is gone; the lock file stays committed, pinning provider checksums.
- **`.env.example` documents every variable** the app reads, including the
  previously undocumented `SUPABASE_SERVICE_ROLE_KEY`.

### D-016 · Terraform: one cluster name feeds both the subnets and the cluster
**2026-09-13** · ✅ done

Subnets were tagged `kubernetes.io/cluster/splitx-eks` while the cluster is
named `splitx-eks-dev`. The AWS Load Balancer Controller ignores subnets tagged
for a different cluster, so ALB provisioning would have failed. A single
`local.cluster_name` now feeds both modules.
**Verified by plan:** `+ "kubernetes.io/cluster/splitx-eks-dev" = "shared"` and
`+ name = "splitx-eks-dev"`.

### D-017 · User uploads never ship in the image
**2026-09-13** · 🚧 image done, git removal pending

Eleven avatar photos with real email addresses in their filenames were committed
under `public/uploads/avatars/` and are publicly served by the live site. Uploads
have gone to Supabase Storage for months. They are now excluded from the Docker
image and ignored going forward. Removing them from git waits for a production
check (B-007), because a profile still pointing at one would fall back to
initials on the next deploy.

---

## Open problems

| ID | Problem | Why it matters | Planned fix |
|---|---|---|---|
| B-001 | **Rate limiter vs. load.** Per-IP limit of 50/min; every call hits Upstash (free quota); `limiter.limit()` has no error handling. | k6 runs from one IP and a classroom shares one NAT IP → the autoscaler sees 429s, not load. Exhausting Upstash turns every API call into a 500. | Phase 1: fail open with a metric; per-user keys for signed-in users; configurable limits; in-cluster Redis through an Upstash-compatible REST proxy on Kubernetes. |
| B-002 | The Compose `redis` service is used by nothing — the app only talks to Upstash over REST. | A health-checked service the app waits for and never uses is theatre. | Phase 1: becomes the limiter backend (B-001), or is removed. |
| B-003 | `POST /api/transactions` accepts `receiptUrl` but never saves it. | Receipts attached through the composer are silently lost. | Phase 1, with a test. |
| B-004 | `POST /api/transactions/from-receipt` has no input validation (`body as {…}`). | `amount` can be a float, negative or a string. | Phase 1: zod schema like the main route. |
| B-005 | Readiness depends on the shared database. | A full DB outage removes every pod from the Service. Accepted for now: nearly every page needs the DB, and 3 failures × 10 s rides out Neon cold starts. | Revisit when tuning probes in phase 3. |
| B-006 | Jenkins admin password is still the leaked one (user no longer knows it; it is in `jenkins/create-job.sh` history). | Jenkins becomes internet-reachable when the webhook tunnel opens. | Phase 6: Jenkins Configuration-as-Code with the admin password from `.env`. |
| B-007 | Committed avatars may still be referenced by production profiles. | Removing them could change what real users see. | Run on production Neon: `SELECT count(*) FROM "User" WHERE image LIKE '/uploads/%';` — if 0, untrack `public/uploads/`. |
| B-008 | Jenkinsfile stages are still theatre (`docker images` as "build", `|| echo` after Sonar). Only the secrets were removed in phase 0. | Examiner-visible. | Phase 6 rewrite. |
| B-009 | `DEMO_GUIDE.html`, `AWS_SETUP_GUIDE.md` describe removed or wrong things (Ansible, t3.small, 23 resources). | Misleading docs. | Phase 8. |
| B-010 | Prisma pool size across up to 12 pods is unset. | Connection exhaustion under autoscaling. | Phase 3: `connection_limit` in `DATABASE_URL`. |
| B-011 | `/api/metrics` and `/api/health/ready` will be reachable through CloudFront. | Metrics are token-protected, but readiness pings the DB per request. | Phase 7: block at the edge; Prometheus scrapes in-cluster. |
| B-012 | Supabase Row Level Security not reviewed. | The anon key is public by design; safety depends on RLS. | Phase 1 backend review. |
| B-013 | `npm test` is 65 lines of source-regex assertions. | CI "passes tests" that exercise no behaviour. | Phase 1: real unit tests for the settlement engine and new endpoints. |

## Environment notes (this machine)

- Native PostgreSQL 17 (`postgresql-x64-17`) listens on 5432; another process on
  127.0.0.1:6379. Compose uses 5433/6380 to coexist.
- The user-level npm config uses plain HTTP with an auth token configured. Fix
  with `npm config set registry https://registry.npmjs.org/` and consider
  rotating that npm token.
- Docker Desktop has 7.6 GiB; raise to 12–16 GiB before the Kind phase.
