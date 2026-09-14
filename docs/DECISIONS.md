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

## Phase 1 — A backend that holds up under real load

### D-018 · A real test suite that CI can fail on
**2026-09-13** · ✅ done

`npm test` was 65 lines of regular expressions over source files (B-013).

- **Vitest 4.1.11** with two projects: `unit` and `integration`. Vitest 5 was
  rejected because it needs Node ≥ 22.12, and Jenkins and the Dockerfile run
  Node 20.
- The **integration** project runs against a real Redis and **fails instead of
  skipping** when `REDIS_URL` is missing. CI starts a Redis service container for it.
- Property-based tests use a seeded PRNG, so any failure reproduces exactly.
- Every change was **mutation-checked**: the bug was put back on purpose and the
  suite had to fail. Examples: a per-bundle metrics registry, the old rounding in
  the rate-limit script, a planner that never counts a zero-sum group
  (338 failures), a dropped `receiptUrl`, an avatar upload with `upsert: true`.
  Two planner mutations first survived (no pairing of opposites, no triple
  search). Tests aimed at exactly those paths were added and now catch them.
- One planner mutation made the solver loop forever and hung the test run. That
  code path is unreachable when the table is consistent, but it now throws
  instead of spinning, so a bug can never pin a pod's CPU.
- `postinstall: prisma generate` (a clean `npm ci` otherwise type-checks against
  an empty Prisma client) and a type-check step in CI.
- **Now:** 671 unit tests, 9 integration tests, 5 hardening checks.

### D-019 · Receipts are kept; only SplitX storage URLs are accepted
**2026-09-13** · ✅ done

- `POST /api/transactions` now saves `receiptUrl` (B-003). Receipts attached in
  the composer used to be dropped.
- A receipt URL must be an object on the configured Supabase storage origin.
  Anything else (a phishing link, a tracking pixel, `javascript:`) is refused on
  write and removed on read from rows saved before the check existed.
- Two silent data bugs found on the way: a member listed twice in a custom
  split, and a non-equal split with no amounts, which saved an expense nobody
  owed. Both are now 400s.

### D-020 · The orphaned from-receipt endpoint is removed
**2026-09-13** · ✅ done

`POST /api/transactions/from-receipt` (B-004) had no callers since V1.5. It let
a caller record debts for people outside the group, and its rounding was wrong.
Validating an endpoint nothing calls would only have kept attack surface alive.

### D-021 · One request ID, from the proxy to every log line
**2026-09-13** · ✅ done

- The proxy starts a W3C `traceparent` for each request. Next.js joins the route
  handler's span to it, so the ID in `X-Request-Id` is the `requestId` on the
  access log line and on any error that handler logs.
  **Verified** for a 401, a 404 and a proxy redirect.
- A client-supplied `traceparent`, `tracestate` or `x-request-id` is replaced,
  so a client can't choose or collide IDs.
- Logs are JSON lines (info to stdout, warnings and errors to stderr) with
  `service`, `pod`, `version` and `requestId`, which is what Promtail and Loki
  need. `X-Served-By` names the pod when `POD_NAME` is set.
- 55 `console.*` calls were converted, and **13 catch blocks that returned a 5xx
  without logging anything** now log. The receipt scanner logs the size of the
  model's response, not its content.

### D-022 · Rate limiting: a sliding window in Redis, keyed by verified identity, failing open
**2026-09-13** · ✅ done (B-001, B-002)

- **Atomic:** one Lua script (a sliding-window counter) runs inside Redis.
  **Proof:** 200 concurrent requests against a limit of 25 admit **exactly 25**. A
  naive GET-then-INCR limiter, tested the same way, admitted **200 of 200**.
- **Backends:** `REDIS_URL` (ioredis over TCP) for Kubernetes and Compose wins
  over Upstash REST (Vercel). With neither configured, the limiter is disabled
  loudly: a warning is logged and `splitx_rate_limiter_info{backend="disabled"}` is set.
  - **Changed from the plan:** B-001 proposed an Upstash-compatible REST proxy in
    front of Redis on Kubernetes. The Next.js proxy already runs on the Node.js
    runtime, so a direct TCP client is one component fewer and much faster:
    local Redis p50 ≤ 2.5 ms and p95 ≤ 10 ms, against 79–170 ms to Upstash from here.
- **Identity:** a signed-in user is keyed by the session token after it is
  **decrypted and verified** (`getToken`, 0.29 ms, cached for at most 60 s and
  never past expiry). Anyone else is keyed by IP, read from the right of
  `X-Forwarded-For` by `TRUSTED_PROXY_HOPS`, so a forged left-hand entry changes
  nothing (verified live). IPv6 is bucketed per /64, and keys are hashed.
- **Policies:** `auth` 10/min per IP (login, registration, password-reset email);
  `preview` 60/min; `api` 120/min. Probes, scrapes and NextAuth session polling
  are never limited. `GET /api/health` pings the database, so it *is* limited.
- **Fails open:** a backend error or a 300 ms timeout lets the request through,
  counted as `splitx_rate_limit_checks_total{outcome="error"}`, with at most one
  warning every 30 s. **Verified** with Redis stopped: requests were served in
  6–10 ms, one warning was logged, and limiting resumed after reconnect.
- 429s carry `Retry-After`, `X-RateLimit-*` and the request ID.
- **Four bugs found by testing live, all fixed with regression tests:**
  1. Rounding the previous window's weight **down** let one extra request
     through at a window boundary. It now rounds up.
  2. **Cold start:** the first requests reached the limiter before ioredis had
     connected and were let through. Under autoscaling that would happen on
     every new pod. The connection now opens at server start and is shared
     process-wide. **Verified:** first 7 requests → 5 allowed, 2 denied, 0 errors, 1 connection.
  3. **Upstash cold start:** the first request paid for TLS plus a script cache
     miss and exceeded the timeout. The script is now loaded at startup.
     **Verified:** 10 allowed, 4 denied, 0 errors.
  4. **Found in the Docker image:** opening the connection at start-up was not
     enough. In a container, the server was ready in 110 ms, but Redis (via
     `host.docker.internal`) took about 0.5 s to connect, so the first request
     was let through unchecked. Until the first connection (or 5 s after
     start-up), a request now waits for it, still bounded by the 300 ms timeout.
     After that, a lost connection fails fast as before.
     **Verified in the container:** the first request, 37 ms after the server
     answered, was counted (`X-RateLimit-Remaining: 119`), with no warnings logged.
- **Correction:** I first blamed the "6 allowed out of 5" observation on a
  minute boundary. The metric arithmetic (13 errors where 12 were expected)
  showed it was bug 2. Both fixes stand.
- Compose Redis now requires a password, keeps no data on disk (`--save ""`,
  no AOF) and evicts with `allkeys-lru`. The rate-limit state is disposable by design.

### D-023 · The settle-up plan is the fewest payments
**2026-09-13** · ✅ done

Every settle-up screen, the settlement list and balance history used a
largest-first greedy plan (`simplifyGroupBalances`). A plan is a split of the
group into zero-sum groups, and a group of k people settles in k − 1 payments,
so the fewest payments means the most zero-sum groups. That is a subset-sum
problem. `lib/settlementPlanner.ts`:

1. pairs exact opposites first, which provably never costs optimality;
2. solves up to **16** remaining people **exactly**, by dynamic programming over
   subsets;
3. in larger groups, finds zero-sum triples within a fixed work budget, then
   settles the rest largest-first;
4. **returns the greedy plan unchanged unless that plan needs more payments**, so
   a group's plan only ever changes to save a payment.

| Exact solver cost (no pairs, worst case) | 12 people | 16 people | 18 people | 20 people |
|---|---|---|---|---|
| per plan | 0.09 ms | **0.66 ms** | 2.4 ms | 10.5 ms + 9 MB |

The limit is 16 because balance history plans two routes for each entry it
returns. At that limit, a full 250-entry page for a group with 16 people left
after pairing costs about 0.3 s. A 10-person group costs about 10 ms for the
default 120 entries.

- **Verified:** plans match an exhaustive search on 400 random groups. On 600
  random group histories, the only differences from the greedy plan were one plan
  one payment shorter and 3 of 861 route summaries.
- **Honest scale of the gain:** in simulated trips of 3–15 people, greedy was
  already optimal at least 99.7% of the time. For real friend groups the planner
  adds a guarantee, not visible savings. Large groups save real payments:
  a 2,000-person event needs 1,818 instead of 1,999.

### D-024 · Balance history plans routes only for the page it returns
**2026-09-13** · ✅ done

`buildBalanceHistory` computed two settle-up plans for **every** change in a
group's whole history, and only then filtered and returned one page. It now
plans only the entries it returns. The refactor was checked before the planner
was switched on: outputs for 600 random histories (including edits, deletes,
filters and cursors) were recorded first and came back **identical**. A mutation
of the refactor was caught by that comparison.

`src/lib/settlement.ts` is gone. The app never imported it, so 1,500 of the
previous 1,629 test cases were exercising dead code. That is why the test count
went down while real coverage went up.

### D-025 · `POST /api/settlements/preview` is the autoscaling load target — and a real feature
**2026-09-13** · ✅ done

The Horizontal Pod Autoscaler needs an endpoint whose cost is **CPU in the pod**.
This one plans supplied balances, or a trip simulated deterministically from a
seed, with the **same planner as the settle-up screens**.

- **Rejected — a `/api/bench` endpoint behind a flag:** it would do fake work,
  and an examiner would rightly call it fake.
- **Rejected — previewing a stored group:** the load would land on Neon, not on
  the pods, and the autoscaler would see a database bottleneck instead of CPU.
- The simulated trip exists for the demo, k6 and benchmarks. Its expenses use
  the same split code as real ones (`lib/splits.ts`), and the same request with
  the same seed returns the same plan.
- **Validation:** whole paise, at most 2,000 people, unique ids, a zero sum. The
  body is capped at 256 KB **even without a Content-Length**, so it can't be
  streamed into memory.
- No sign-in, no database; rate limited per identity by D-022.

**CPU per request** (one production-build process, i7-13700HX; `scripts/load-preview.mjs --sizes`):

| people | expenses | payments: greedy → planned | direct IOUs | compute p50 | server CPU / request |
|---:|---:|---|---:|---:|---:|
| 100 | 300 | 99 → 99 | 964 | 0.6 ms | 1.9 ms |
| 500 | 1,500 | 499 → 494 | 5,631 | 3.1 ms | 3.1 ms |
| 1,000 | 3,000 | 999 → 961 | 11,808 | 17 ms | 24 ms |
| 2,000 | 6,000 | 1,999 → 1,822 | 23,602 | 45 ms | 57 ms |

**Under load**, 1,000 people, 10 s per step:

| concurrency | ok/s | p50 | p95 | shed (503) | CPU cores |
|---:|---:|---:|---:|---:|---:|
| 1 | 52 | 16 ms | 32 ms | 0 | 0.68 |
| 4 | 43 | 90 ms | 142 ms | 0 | 1.01 |
| 16 | 58 | 282 ms | 410 ms | 0 | 1.02 |
| 32 | 54 | 616 ms | 763 ms | 0 | 1.00 |
| 64 | 73 | 728 ms | 1,178 ms | 12 of 752 | 0.94 |

At 2,000 people and 96 concurrent clients: 183 served, 315 shed, **0 failed**.

**What this shows:** one Node.js process tops out at one core. Beyond that,
more traffic only lengthens the queue, so the only way to serve more is more
pods. That is exactly what phase 4 must demonstrate. The group size is the knob
for per-request cost on the demo hardware, which is slower than this laptop.

### D-026 · Load shedding by queue time
**2026-09-13** · ✅ done

A pod whose CPU is saturated keeps accepting work. Kubernetes probes wait behind
that work, time out, and the pod is restarted while it was only busy, which
pushes its load onto the others.

- The proxy stamps `x-request-start` on arrival, replacing any client value. A
  preview that has already waited longer than `PREVIEW_MAX_QUEUE_MS` (1 s) gets
  **503 with `Retry-After: 1`** before any planning is done.
- **Rejected — event-loop lag as the signal (measured):** Node's
  `monitorEventLoopDelay` shows how long one loop iteration blocks, not how much
  work is queued. Twenty 50 ms tasks queued back to back read p99 = 50 ms, the
  same as a single task. It would never see a backlog.
- Metrics: `splitx_settlement_previews_total{mode,outcome}`,
  `…_compute_seconds{mode,algorithm}` and `…_queue_seconds`.
- **Limit found (B-016):** the stamp starts when the proxy runs, and a saturated
  process also delays getting there. At 96 concurrent 2,000-person requests,
  accepted requests still reached p99 ≈ 2.2–2.5 s.

### D-027 · Storage: signed upload URLs, no anonymous writes, no silent fallbacks
**2026-09-13** · ✅ code done · ⏳ live check waits on B-014

**Before:**
- The browser uploaded receipts with the public anon key and `upsert: true`.
  Storage writes depended on permissive anon policies, and an existing object
  could be overwritten.
- The avatar upload fell back from the service role key to the anon key. If
  storage still failed, it saved the photo as a **base64 `data:` URL in the users
  table**.
- Avatar file names contained the user's **email address**, in a public URL.

**Now:**
- **Receipts:** `POST /api/receipts/upload-url` signs a one-time upload, with the
  service role key, for a path the server chooses: `<userId>/<uuid>.<ext>`, no
  overwrite, valid for 2 hours. The browser uploads straight to storage, so
  photos never pass through the pods. A new expense only accepts a receipt from
  its author's folder.
- **Avatars:** the service role key is required (503 without it). A failed upload
  is a 502 the user sees. The type is read from the file's bytes, so SVG or HTML
  renamed to `.png` is refused. The path is `avatars/<userId>/<uuid>`, with no overwrite.
- **Rejected — sending receipt bytes through the API:** Vercel caps request
  bodies at 4.5 MB, and phone photos are often 3–6 MB. It would also spend pod
  bandwidth and memory on bytes the app never reads.
- The bucket's own MIME-type and size limits are the final check on what a signed
  URL can upload; they are configured in Supabase, not in code.

---

## Open problems

| ID | Problem | Why it matters | Status / planned fix |
|---|---|---|---|
| B-001 | Rate limiter vs. load: 50/min per IP, every call to Upstash, no error handling. | k6 and a classroom NAT would see 429s, not load; an Upstash outage became a 500 on every call. | ✅ Resolved — D-022. |
| B-002 | The Compose `redis` service was used by nothing. | A health-checked service nobody uses is theatre. | ✅ Resolved — it is the rate-limit backend (D-022). |
| B-003 | `POST /api/transactions` accepted `receiptUrl` but never saved it. | Receipts attached through the composer were lost. | ✅ Resolved — D-019. |
| B-004 | `POST /api/transactions/from-receipt` had no input validation. | Floats, negatives or strings as amounts. | ✅ Resolved — endpoint removed (D-020). |
| B-005 | Readiness depends on the shared database. | A full DB outage removes every pod from the Service. Accepted for now: nearly every page needs the DB, and 3 failures × 10 s rides out Neon cold starts. | Revisit when tuning probes in phase 3. |
| B-006 | Jenkins admin password is still the leaked one (user no longer knows it; it is in `jenkins/create-job.sh` history). | Jenkins becomes internet-reachable when the webhook tunnel opens. | Phase 6: Jenkins Configuration-as-Code with the admin password from `.env`. |
| B-007 | Committed avatars may still be referenced by production profiles. | Removing them could change what real users see. | Run on production Neon: `SELECT count(*) FROM "User" WHERE image LIKE '/uploads/%';` — if 0, untrack `public/uploads/`. |
| B-008 | Jenkinsfile stages are still theatre (`docker images` as "build", `|| echo` after Sonar). Only the secrets were removed in phase 0. | Examiner-visible. | Phase 6 rewrite. |
| B-009 | `DEMO_GUIDE.html`, `AWS_SETUP_GUIDE.md` describe removed or wrong things (Ansible, t3.small, 23 resources). | Misleading docs. | Phase 8. |
| B-010 | Prisma pool size across up to 12 pods is unset. | Connection exhaustion under autoscaling. | Phase 3: `connection_limit` in `DATABASE_URL`. |
| B-011 | `/api/metrics` and `/api/health/ready` will be reachable through CloudFront. | Metrics are token-protected, but readiness pings the DB per request. | Phase 7: block at the edge; Prometheus scrapes in-cluster. |
| B-012 | Supabase access policies not reviewed. SplitX's database is Neon; Supabase only stores files. | Since D-027 the app never writes with the anon key, so any anon write policy on the `receipts` bucket is now pure risk. | User: remove anon INSERT/UPDATE/DELETE policies on the bucket; set allowed types (JPEG, PNG, WebP, GIF) and a 10 MB limit. |
| B-013 | `npm test` was 65 lines of source-regex assertions. | CI "passed tests" that exercised no behaviour. | ✅ Resolved — D-018. |
| B-014 | The Supabase project URL in the local `.env` did not resolve. | Storage couldn't be exercised, and uploads on the live site were failing. | ✅ Resolved 2026-09-14 — the free-tier project had been **paused**; the user resumed it. URL and publishable key verified against it. The service role (secret) key is still missing from `.env`, so D-027 is not yet verified live. |
| B-015 | Anonymous preview requests from one network share an IP bucket (60/min). | A classroom behind one NAT would be rate limited as one person during the demo. | Phase 4: a per-device guest identity or a demo-window limit, decided with measurements. |
| B-016 | Queue-time shedding can't see the time a request waits before the proxy runs (D-026). | Accepted requests reached p99 ≈ 2.2–2.5 s at 96 concurrent 2,000-person previews on one process. | Phase 4, on the cluster: tune `PREVIEW_MAX_QUEUE_MS` with pods behind a Service; compare with load-balancer timing. |
| B-017 | Deliberately shed 503s are logged at error level by the access log. | 365 error lines in one load test, all intended. Noise hides real errors. | Phase 5: alert from metrics; consider warn level for shed responses. |
| B-019 | **Anyone can list the `receipts` bucket.** Found 2026-09-14: an anonymous request with the public key listed its contents. | A public bucket serves files by URL without any policy; listing needs a SELECT policy, and one exists. Anyone can enumerate every receipt photo. | User, after D-027 is deployed (the old browser upload with `upsert: true` needs SELECT/UPDATE): delete the bucket's anon policies. Later: consider a private bucket with signed read URLs. |
| B-020 | The Docker image's browser code has no Supabase URL or key. `NEXT_PUBLIC_*` values are compiled in at build time, and `.env*` is excluded from the build context (verified: 0 browser chunks in the image contain the project URL). | Receipt uploads cannot work from the container, or later from Kubernetes. | Phase 2: upload with the full signed URL the server returns, so the browser needs no Supabase configuration and one image runs in every environment. Verify it once the service role key is available. |
| B-018 | Old uploads keep their old names: receipts at the bucket root, avatars named after email addresses, and any avatar saved as a `data:` URL. | Email addresses remain in public URLs until those files are replaced. | After B-014: `SELECT count(*) FROM "User" WHERE image LIKE 'data:%' OR image LIKE '%@%';` then a one-off migration. |

## Environment notes (this machine)

- Native PostgreSQL 17 (`postgresql-x64-17`) listens on 5432; another process on
  127.0.0.1:6379. Compose uses 5433/6380 to coexist.
- The user-level npm config uses plain HTTP with an auth token configured. Fix
  with `npm config set registry https://registry.npmjs.org/` and consider
  rotating that npm token.
- 15.7 GB of physical RAM. Docker Desktop runs on WSL 2, which by default takes half
  (about 7.8 GB). The planned 12–16 GB is not possible on this machine: 16 GB is all
  of it, and 12 GB would starve Windows. Plan: `memory=10GB` and `swap=8GB` in
  `%UserProfile%.wslconfig`. The Kind cluster and the CI stack (Jenkins,
  SonarQube, Nexus) should not run at full size at the same time.
- Installed: kind 0.31.0, kubectl 1.34.1 (Kustomize 5.7.1 built in), Helm 4.1.4,
  Terraform 1.14.9, AWS CLI 2.34, Docker Buildx 0.33. Not installed: Trivy, k6,
  hadolint. Phases 2 and 4 run their official container images instead.
- Image baseline before phase 2: `splitx:local` is 430 MB, and `splitx_app_info`
  reports `git_sha="unknown"` (no build provenance yet).
- Loki receives the container logs (a response's `X-Request-Id` was found in
  Loki), but they are labelled only `job`, `stream` and `filename`: no container
  or service label (phase 5).
- Loki occupies host port 3100, so ad-hoc app servers for tests use 3200.
- The user-level npm registry is HTTPS now.
