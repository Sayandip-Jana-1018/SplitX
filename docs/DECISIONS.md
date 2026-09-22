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
**2026-09-13** · ✅ done (untracked 2026-09-14)

Eleven avatar photos with real email addresses in their filenames were committed
under `public/uploads/avatars/` and are publicly served by the live site. Uploads
have gone to Supabase Storage for months. They are now excluded from the Docker
image and ignored going forward. Removing them from git waits for a production
check (B-007), because a profile still pointing at one would fall back to
initials on the next deploy. **2026-09-14:** production Neon returned 0 profiles
pointing at `/uploads/`, so the 11 files are no longer tracked. They remain in git
history (D-003: history is not rewritten).

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
**2026-09-13** · ✅ done · verified live 2026-09-14

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
- **Verified live against the production bucket (2026-09-14), after the user deleted
  every storage policy:**
  - the secret key has storage admin rights;
  - a server-signed upload succeeds and is readable byte for byte at its public URL;
  - the same token cannot overwrite it ("The resource already exists");
  - the server-side avatar upload works;
  - with the public key alone, uploading is refused by row-level security, listing
    shows nothing, and deleting removes nothing.
  - Three 68-byte probe images were left under `_e2e/` and `avatars/_e2e/`.

---

---

## Phase 2 — One image, and only what the server runs

### D-028 · The browser uploads with a signed URL alone, so one image runs everywhere
**2026-09-14** · ✅ done · verified live

B-020: `NEXT_PUBLIC_*` values are compiled into browser code at build time, and
`.env*` is excluded from the build context. The image therefore contained no
Supabase URL or key, and a receipt upload from a container could only fail
(verified: **no** browser chunk in the image contained the project URL).

- **Fix:** `POST /api/receipts/upload-url` now returns the full signed upload
  URL, which carries its own one-time token. The browser `PUT`s the photo
  there with no key and no Supabase client at all.
- **Verified against the production bucket:** a plain `PUT` with no key
  succeeds and the photo reads back byte for byte; the browser preflight from
  `https://splitsj.vercel.app` is allowed for `content-type`, `cache-control`
  and `x-upsert`.
- The Supabase client is gone from browser code, and the app no longer needs
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` anywhere.
- **Rejected — passing `NEXT_PUBLIC_*` as build arguments:** that bakes one
  environment into the image, so the artifact tested locally could not be the
  artifact promoted to Kubernetes and to production.

### D-029 · The image carries only what the server runs
**2026-09-14** · ✅ done

Everything below was measured inside the image, then removed and re-measured —
see `docs/evidence/image-comparison.md`.

- **Node 24 on Alpine 3.24, both pinned by digest.** Node 20 reached end of
  life in April 2026, so the old base no longer receives security fixes.
- **The runtime stage is Alpine plus the `node` binary** (and `libstdc++`).
  npm, npx, yarn and corepack are never used by a running server and carry a
  large share of the base image's vulnerabilities.
- **Removed from the traced output**, after checking what actually loads it:
  | Removed | Size | Why it was there |
  |---|---|---|
  | `typescript` | 19 MB | compiles `next.config.ts` at build time only |
  | `@img/sharp-*-linux-x64` | 16 MB | glibc builds of the image library; this image is musl |
  | `@prisma/client/runtime/*.wasm-base64.*` | 50 MB | WebAssembly engines for edge runtimes and for MySQL, SQLite, SQL Server and CockroachDB |
  | `.prisma/client/*.wasm` | 2 MB | the same engine for the edge client |
- Application files stay owned by root and the server runs as uid 1001, so a
  compromised process cannot rewrite the code it runs. Only `.next/cache`
  (optimized images) is writable.
- `HOSTNAME=0.0.0.0` is baked in: Next binds `$HOSTNAME`, and Kubernetes sets
  that variable to the pod name, which would bind a single interface and break
  `kubectl port-forward` and any localhost probe. Verified that the image value
  survives `docker run`.
**Measured against the naive build** (full table in `docs/evidence/image-comparison.md`):

| | Naive | Production |
|---|---|---|
| Download size | 1091 MB | 81 MB |
| Unpacked size | 2960 MB | 217 MB |
| Vulnerabilities | 4139: 35 critical · 636 high · 2124 medium · 1321 low | 0: 0 critical · 0 high · 0 medium · 0 low |
| Runs as | root | nextjs |
| `docker run` to healthy | 2.6 s | 0.9 s |

- **Rejected — deleting npm in a later layer:** layers are additive, so the
  files still ship; only the file listing looks cleaner.
- **Rejected — Debian-slim or distroless:** the Prisma engine and sharp both
  ship musl builds that match Alpine, and distroless (glibc) starts larger than
  the entire Alpine runtime stage here.

### D-030 · No init process in the image
**2026-09-14** · ✅ decided

The usual advice is to add `tini` or `dumb-init` as PID 1. Checked instead:
Next.js registers its own `SIGTERM` handler, which stops accepting connections,
lets in-flight requests finish and then closes — so signals are handled, and
the server spawns no child processes that could be orphaned. `docker stop` and
the in-flight requests during it are measured in the evidence file.

### D-031 · A naive image, built and measured next to the real one
**2026-09-14** · ✅ done

`Dockerfile.naive` is the same app containerised without any care: one stage,
the full Debian Node image, every dev dependency, the build toolchain, and root.
It exists only so the production image's claims are comparative and checkable —
`npm run image:report` builds both, measures both and writes
`docs/evidence/image-comparison.md`. `docker-bake.hcl` builds them, with
`GIT_SHA`, `APP_VERSION` and `BUILD_DATE` from git and `package.json`, so a
running pod can be traced to the commit it came from
(`splitx_app_info{version, git_sha}` and the OCI labels).

Trivy runs as a **container pinned by digest**: the project's own release
pipeline was compromised in 2026, and a scanner is exactly the tool an attacker
wants you to pull by floating tag.

### D-032 · The scanner gates the build, and it caught real problems on its first run
**2026-09-16** · ✅ done

`./scripts/scan-image.sh` fails when the image has vulnerabilities at or above
HIGH **that already have a fix** — the ones a pipeline can act on. Its first run
against the new image failed, with 18 findings:

| Package | Installed | Fixed in | What |
|---|---|---|---|
| `next` | 16.1.6 | 16.3.3 | 14 findings, including server-side request forgery through Server Actions and two denial-of-service advisories |
| `sharp` | 0.34.5 | 0.35.0 | libvips and libheif vulnerabilities |
| `libssl3`, `libcrypto3` | 3.5.7-r0 | 3.5.8-r0 | OpenSSL, newer than the pinned Alpine release carries |

- Next.js was upgraded to **16.3.5**, which requires sharp 0.35.4, so both
  application findings closed together.
- The Alpine packages are patched by `apk upgrade` during the build.
- **The framework upgrade is exactly what the phase 0 harness exists for:**
  HTTP metrics are read from Next's internal request spans, so a minor upgrade
  could silently stop them. `scripts/verify-metrics.mjs` was run against a
  container of the new image: **15/15**, with every response still counted
  exactly once. Image optimisation (sharp, musl build) was checked in the same
  container.
- The gate now passes with no fixable HIGH or CRITICAL findings.

## Phase 3 — Kubernetes: a cluster that can be broken on purpose

### D-033 · The rehearsal cluster runs the same Kubernetes as the demo, pinned by digest
**2026-09-16** · ✅ done

`k8s/kind/cluster.yaml` builds one control plane and two workers on
`kindest/node:v1.35.0`, pinned by digest. Two workers, not one: pod placement
is only meaningful if there is somewhere else to place a pod, and a spread
constraint on a single node proves nothing.

Choosing the version turned up a real problem. The Terraform EKS module was
pinned to **1.31**, which left AWS standard support on 2025-11-26:

```
aws eks describe-cluster-versions --include-all
1.36  STANDARD_SUPPORT     1.33  EXTENDED_SUPPORT
1.35  STANDARD_SUPPORT     1.32  EXTENDED_SUPPORT
1.34  STANDARD_SUPPORT     1.31  EXTENDED_SUPPORT (ends 2026-11-26)
```

A cluster on extended support keeps running, but AWS bills the control plane at
six times the standard rate while it does — so a stale version pin is a cost
decision as well as a security one, and this one would have expired during the
project. The module now takes a `kubernetes_version` variable defaulting to
**1.35**, with a validation listing the versions in standard support on the day
it was written, so a stale pin fails `terraform plan` with a dated message
rather than passing a regex.

- 1.35 rather than 1.36: it is what Kind 0.31 ships as its default node image,
  so the rehearsal cluster needs no extra download and cannot drift from EKS.
- **Rejected — whatever Kind installs by default, EKS on whatever is newest:**
  the whole point of a rehearsal is that it rehearses the same thing.

### D-034 · Kustomize for our manifests, Helm for other people's
**2026-09-16** · ✅ done

There was a `helm/splitx` chart in the repository and a `k8s/` directory of raw
manifests, describing the same application differently. Nothing installed the
chart — the ArgoCD instance that once referenced it is gone, and its password
died with it (D-003). Keeping both means two sources of truth that drift, and
the drift was already there: the chart had no network policy, no disruption
budget, no security context and a liveness probe that would have restarted every
pod during a database outage.

**The chart is deleted.** The application is described once, in
`k8s/base`, and varied by overlay.

Helm is still here, doing the job it is actually good at: installing software we
did not write. `helm/platform/charts.json` pins ingress-nginx 4.15.1 and
metrics-server 3.14.0 by chart version, each with its own values file, and
`scripts/cluster-up.mjs` installs them from that file. Phase 5 adds the
monitoring charts to the same list.

- **Rejected — keep the chart for the sake of having Helm on the CV:** an
  unused chart that contradicts the manifests is worse than no chart. The
  honest version is that Helm packages third-party components here, and
  `helm list -A` on the cluster shows exactly that.
- **Rejected — Helm for everything, drop Kustomize:** templating YAML with
  string interpolation to express "the same thing, with two proxies in front
  instead of one" is how `values.yaml` files grow to 400 lines. The overlays
  are patches against a rendered base, so the difference between environments
  is reviewable as a diff.

### D-035 · One base, two overlays, two optional components
**2026-09-16** · ✅ done

```
k8s/base                 namespace, deployment, service, HPA, PDB,
                         ingress, network policy, service account
k8s/components/postgres  StatefulSet + schema Job   (local only)
k8s/components/redis     rate-limit backend         (both)
k8s/overlays/local       base + both components, image splitx:local
k8s/overlays/aws         base + redis, ECR image, ALB, IRSA, 2 proxy hops
```

The local overlay renders 19 objects and the AWS one 14; both are validated
against the Kubernetes 1.35 schemas in CI (`kubeconform`, pinned by digest),
and CI also fails if any manifest ever deploys a `:latest` tag — a moving tag
makes a rollback meaningless, because the same manifest deploys different code
tomorrow.

The differences between the two overlays are the interesting part, and each one
is a decision, not a setting:

| | Local | AWS | Why they differ |
|---|---|---|---|
| Database | a Postgres pod with its own PVC | Neon | The rehearsal must work with no network and no account. The demo should exercise the real connection path — TLS, pooling, latency — which a pod next door does not. |
| `TRUSTED_PROXY_HOPS` | 1 | 2 | ingress-nginx is one proxy; CloudFront in front of an ALB is two. Get it wrong and the rate limiter buckets the load balancer instead of the visitor, or trusts an address the visitor chose. |
| Ingress | nginx, host ports 80/443 | ALB via the AWS Load Balancer Controller | Kind has no cloud load balancer; EKS should not run a second one in a pod. |
| Service account | no token mounted | the same, plus an IRSA role | The app never calls the Kubernetes API. On AWS it needs AWS credentials, and IRSA issues short-lived ones instead of storing a key. |

### D-036 · The pod is locked down, and the namespace enforces it
**2026-09-16** · ✅ done

Every application pod runs as uid 1001 with a read-only root filesystem, all
Linux capabilities dropped, `allowPrivilegeEscalation: false`, the
`RuntimeDefault` seccomp profile, and no service account token mounted — the
app never calls the Kubernetes API, so a token in the pod is only useful to
someone who should not have one. `/tmp` and the Next.js cache are `emptyDir`
mounts, the only writable paths.

Asking for that is not the same as getting it, so the namespace carries
`pod-security.kubernetes.io/enforce: restricted`. A pod that does not comply is
refused at admission — including the database and Redis components, which is why
both run as their own non-root users (70 and 999) with the same restrictions.

Verified: `kubectl run --privileged --dry-run=server` in the namespace is
rejected by PodSecurity admission rather than created.

### D-037 · Readiness removes a pod; liveness restarts it. Tested by taking the database away.
**2026-09-16** · ✅ done, B-005 closed

The probes were written in phase 0 with an argument attached: readiness pings
the database, liveness never touches it, because a database outage must take
pods out of the Service without restarting them. That was a claim. Now it is a
measurement — `scripts/cluster-verify.mjs` scales the Postgres StatefulSet to
zero with the application running:

| | Before | During the outage | After |
|---|---|---|---|
| Ready replicas | 2 | 0 | 2 |
| Ready endpoints behind the Service | 2 | 0 | 2 |
| Container restarts | 0 | 0 | 0 |
| `GET /` through the ingress | 200 | 503 | 200 |
| `GET /api/health/live` | 200 | 200 | 200 |

Both replicas left the Service within one probe cycle, the ingress answered 503
instead of a half-broken page, **no pod was restarted**, and the same two pods
served again when the database came back. With liveness pointed at the database
— the arrangement the deleted Helm chart had — every pod in the deployment would
have entered a restart loop during an outage it could do nothing about, and the
recovery would have been slower than the outage.

B-005 asked whether readiness should depend on the database at all. It should:
the cost is a 503 from the ingress during a database outage, which is honest,
and the alternative is serving errors from pods that Kubernetes believes are
healthy.

### D-038 · A release must not drop a request, and that is now a measurement
**2026-09-16** · ✅ done

`maxSurge: 1, maxUnavailable: 0` means a new pod passes its readiness probe
before an old one is taken away. That still leaves the classic race: a pod's
endpoint is removed and its process is told to stop at the same moment, so the
proxy can send one more request into a server that has already begun shutting
down. A `preStop` sleep of 5 seconds — using Kubernetes' own sleep action, so no
shell is needed in the image — holds the container open while ingress-nginx
notices the endpoint is gone.

Measured during `kubectl rollout restart` with four concurrent clients:

```
3090 requests in 6.9 s — 3090 OK, 0 non-200, 0 connection failures
traffic fully on the new pods 11 ms after the rollout reported complete
```

Three distinct pods answered during the release, which is what shows the traffic
actually moved rather than the test finishing before the rollout started.

**The test earned its place on its second run.** It reported 40 non-200
responses out of 2061, where earlier runs had reported none. The cause was not
the release: the check that the database had recovered from the previous test
waited for a single 200, and one pod answering is not the same as the
deployment being available again. Prisma reconnects lazily, so the other
replica was still failing readiness while the rollout began — a release into a
fleet that was still recovering. The check now waits for `readyReplicas` to
equal the desired count, and the same rollout loses nothing.

That is worth more than a green tick: **do not start a release while the fleet
is still recovering from something else**, and a deploy pipeline that only
checks "is one instance answering" will do exactly that. Phase 6's pipeline
gates on the same condition.

A second observation from the same test: for a few seconds after Kubernetes
reports the rollout complete, ingress-nginx still sends some requests to pods
that are draining. Those requests are answered normally, because the `preStop`
delay is keeping the container alive on purpose — that is the mechanism working,
not a leak. The check measures how long traffic takes to move off them (11 ms
here) rather than demanding an instant cutover that no proxy performs.

### D-039 · The autoscaler scales on CPU only
**2026-09-16** · ✅ done

The old HPA scaled on CPU *and* memory at 80%. Node.js holds heap memory after a
burst instead of returning it to the operating system, so a memory target
ratchets replicas up and then keeps them there: it looks like autoscaling and
behaves like a one-way valve. The memory metric is gone. CPU at 60% of a 250m
request is the trigger, which suits the settlement preview — the one endpoint
that is pure CPU with no database (D-025).

Scale-up is deliberately impatient and scale-down deliberately slow: no
stabilisation window going up, doubling or +4 pods per 15 s, whichever is more;
five minutes of quiet and one pod a minute coming down. A classroom arrives all
at once and leaves in waves, and a pod that is removed too eagerly has to cold
start when the next wave hits.

Verified: with metrics-server installed from its pinned chart, the HPA reports
real utilisation (2% of the 250m request at idle) instead of `<unknown>`.
Tuning the staircase under real load with k6 is phase 4.

### D-040 · Nothing in the namespace accepts a connection unless a policy names the sender
**2026-09-16** · ✅ done

A `default-deny-ingress` policy covers every pod in the namespace, and each
workload then opens exactly what it needs: the app accepts traffic from
ingress-nginx, from the monitoring namespace (phase 5) and from the node network
— the kubelet runs the probes from the node itself, and forgetting that is how a
network policy turns into a CrashLoopBackOff. Postgres accepts connections from
the app and the schema Job, and from nothing else. Redis accepts them from the
app.

Egress is restricted too, and by address rather than by wishful thinking: DNS to
kube-dns, 5432 to the Postgres pods, 6379 to Redis, and 443/5432 to the public
internet **excluding** the private ranges. A compromised pod can reach Neon,
Supabase and the Gemini API, and cannot reach the node network, the control
plane or another namespace's database.

Policies that nothing enforces are decoration, so the verification script tests
it from outside: a busybox pod in the `default` namespace tries the app, Postgres
and Redis, and all three connections time out.

```
wget: download timed out
app=1  postgres=1  redis=1      (non-zero = refused)
```

Kind's CNI (kindnetd) enforces these. On EKS the VPC CNI needs its network
policy agent enabled — phase 7, and the check above is what will prove it.

### D-041 · The schema reaches the cluster as SQL, not as a Prisma CLI in a container
**2026-09-16** · ✅ done

The runtime image has no npm and no Prisma CLI — that is what makes it 81 MB — so
a pod cannot run `prisma db push`. Adding a second, fatter image just to create
tables would give up the thing phase 2 bought.

`scripts/db-schema.mjs` renders `prisma/schema.prisma` to plain SQL with
`prisma migrate diff`, and the result is committed (18 tables, 24 indexes). A Job
applies it with `psql` from the Postgres image itself — no extra image, no
network, no CLI. The Job checks for the `User` table first, so running it again
is free, and its ConfigMap is content-hashed, so changed SQL is never silently
reused.

`node scripts/db-schema.mjs --check` runs in CI: a model added to
`schema.prisma` without regenerating fails the build, instead of reaching the
cluster as a missing table and a 500 from one endpoint hours later.

Neon — the managed database behind Vercel and, in phase 7, EKS — is still
managed with Prisma directly. This path exists so the local cluster can stand up
a database of its own with nothing but the images it already has.

**2026-09-22:** the file is now built from `prisma/migrations` instead, applying only the
migrations a database doesn't have yet, and the Job runs it on every deploy (D-072).

### D-042 · Secrets are built from `.env` and piped to kubectl; they never touch a file or a command line
**2026-09-16** · ✅ done

`scripts/cluster-up.mjs` reads `.env`, builds the Secret as JSON in memory and
writes it to `kubectl apply -f -` on stdin. No generated YAML on disk, no
`--from-literal` (which puts values in the process list and the shell history),
and the script prints key names only. The manifests reference `splitx-secrets`
by name and never contain a value; `k8s/base/secret.example.yaml` documents the
keys.

Two details that matter more than they look:

- **The cluster's database URL is built, not read.** The `DATABASE_URL` in
  `.env` points at the Compose Postgres on `localhost`, which inside a pod
  means the pod itself — and the Neon URL is sitting one comment character above
  it in the same file. A file edited in a hurry would otherwise aim the
  rehearsal cluster at the deployed site's data, including the test above that
  scales the database to zero. The script ignores whatever `DATABASE_URL`
  holds and builds an in-cluster URL from `POSTGRES_PASSWORD`.
- **Passwords are percent-encoded** into the connection URLs. A password
  containing `@` or `/` would otherwise split the URL and the pods would connect
  somewhere else entirely, or nowhere.

`connection_limit=5` is set on the URL as well, which closes B-010: ten pods
with Prisma's default pool would have exhausted a small database exactly when
the autoscaler was doing its job.

### D-043 · Operational endpoints are refused at the edge
**2026-09-16** · ✅ done, B-011 closed for the cluster

`/api/metrics` and `/api/health/ready` are matched by a second Ingress that
answers 403 for every source address outside loopback, so neither is reachable
from outside the cluster. Prometheus scrapes the pods through the Service and
the kubelet probes them directly, so nothing that needs them is affected.
Readiness queries the database on every call; published on the internet it is a
free way to make an application's database do work. Metrics also check a bearer
token — verified from inside a pod, where the request without the token is
answered 401 — and this is the second lock, not the first.

The AWS overlay does the same thing the way an ALB does it, with a
fixed-response listener rule, since nginx annotations mean nothing there.
CloudFront gets the same treatment in phase 7.

---

## Phase 4 — Real traffic, and what it takes to survive it

### D-044 · A host restart left the cluster answering 200 while unable to open a single new connection
**2026-09-17** · ✅ detected automatically · ⚠️ cause corrected in D-050

Found while preparing the load tests. Overnight, Docker Desktop's VM restarted
(every pod in the cluster showed one restart). The control plane and a worker
came back with their IP addresses swapped, and pods came back with recycled IPs.
Both application pods were Running but not Ready, and the site answered 503.

What the evidence showed, layer by layer:

| Test | Result |
|---|---|
| DNS from the app pod, and from Redis (which no policy restricts) | failed |
| TCP from a node to pods on other nodes | worked |
| Pod to pod on the same node | worked |
| Pod to pod across nodes, new connection | failed |
| Packet capture on both nodes | the app's **existing** database connection flowed both ways (`SELECT 1` answered in 0.2 ms); a **new** connection's SYN entered the sending node from the pod and never left it |

Kind nodes send new pod connections to the network-policy engine inside
kindnetd (`queue flags bypass to 101` in nftables), and established flows skip
it. Deleting every NetworkPolicy did not help, so the policies were not the
problem; restarting the `kindnet` DaemonSet did, immediately. The engine had
kept stale state across the restart and was rejecting every new flow.

> **Correction, same day (D-050):** the engine was not holding stale state. It
> was starved by the limits Kind gives it (100m CPU, 50Mi memory) and answered
> too late for any connection to survive. Restarting it only helped until it
> fell behind again, which the next restart of the laptop showed within
> minutes. The detection below was right; the explanation and the fix were not.

The dangerous part came next: **readiness recovered on its own**. Prisma
reused a connection it had managed to open, the probe passed, and the site
answered 200 — while no pod could open a new connection. The next pod the
autoscaler started would never have become ready, and the phase 4 load tests
would have failed in a way that looked like an autoscaling problem.

It also exposed a gap in phase 3's verification: a passing readiness probe was
treated as proof of connectivity, and it is not.

- `scripts/lib/cluster-network.mjs` opens fresh connections from inside every
  application pod — DNS, Postgres, Redis — with the busybox tools already in
  the image.
- `npm run k8s:up` runs it on every bring-up. When new connections fail it
  restarts kindnet and checks again, and if that does not fix it, it stops and
  says to rebuild the cluster rather than continuing with a broken one.
- `npm run k8s:verify` includes it as a check.
- EKS uses a different policy implementation (the VPC CNI's network policy
  agent), and the same check applies there.

One false lead worth recording: the first reachability test from the nodes used
`ping`, which the Kind node image does not include, so every "unreachable" it
printed was the missing binary. The capture, and TCP tests with `curl`, are
what the conclusions above rest on.

### D-045 · A classroom is many people: anonymous devices get their own limit, networks keep a ceiling
**2026-09-17** · ✅ done, B-015 closed

Anonymous requests were rate limited by address, and a classroom on campus Wi-Fi
reaches the internet through one. `load/classroom.js` recreates it with production
limits: 80 phones behind one address planning a trip every 4 to 8 seconds, plus one
device planning as fast as it can.

| Build | Student plans served | Students refused | Greedy device served | Student p95 |
|---|---|---|---|---|
| before (`f4b2dc2`) | 129 of 1,907 | **1,777 (93%)** | 66 of 623 | 25 ms |
| after (`7717816`) | **1,912 of 1,912** | **0** | 168 of 617 | 28 ms |

The proxy now gives an anonymous browser a device cookie: a random 128-bit identifier
signed with an HMAC under a key derived from the auth secret, `HttpOnly`,
`SameSite=Lax`, `Secure` over HTTPS. A request carrying a genuine cookie is limited as
that device (60 previews a minute).

Device identities cost nothing to mint, so they never replace the network limit. Once
the device is allowed, its address is checked against a ceiling sized for a room of
about a hundred phones (2,400 previews a minute). The order matters: a request the
device limit refused is never charged to the network, so one greedy phone cannot use
up everyone else's allowance. Cookie-less requests keep the per-address limit, and
signed-in users are still limited per account.

- **Found by a test:** 16 bytes in base64url leave four unused bits in the last
  character, so several different strings decode to the same signature bytes. The
  first version compared decoded bytes and accepted all of them. Signatures are now
  compared as canonical text; a test flipping only those bits guards it.
- **Verified on real Redis:** forty phones planning ten times each are all served; a
  device over its own limit is held at 60 while its neighbour is untouched; sixty
  freshly minted identities from one address are capped at the network ceiling.
- **Rejected — raising the per-address limit:** it fixes the classroom by letting any
  one person use the whole room's allowance.
- **Rejected — requiring sign-in for the demo:** the page has to work from a QR code.

### D-046 · Under sustained overload the pods were killed by their own probes
**2026-09-17** · ✅ fixed in four steps, each measured

`load/saturation.js` holds the deployment at two pods (`overlays/saturation`) and sends
2,000-person plans at 60 a second, about 70% more than two cores can compute. Nothing
scales, so the only question is what the pods do with work they cannot finish.

What happened on the phase 3 build:

1. Requests queued on the event loop, but load shedding started its clock when the
   app's proxy ran, which a busy process also delays. Waits of many seconds were
   measured as under one, so shedding rarely fired.
2. The liveness probe waited in the same queue, timed out three times, and Kubernetes
   restarted both containers. Every request they were serving failed.
3. The restarted process was flooded before its 1-second startup probe could pass.

Served p95 reached **26 seconds**, 1,264 requests timed out at the ingress, 50 more got
502, and both containers restarted. Each fix below was deployed and measured on its
own:

| Run | Change | Served | Refused (503) | 502 / 504 | Restarts | Served p95 | Liveness checks answered |
|---|---|---|---|---|---|---|---|
| before | none | 3,065 | 2,223 | 50 / 1,264 | 2 | 26.1 s | not measured |
| clock | ingress stamps arrival time | 2,984 | 4,190 | 26 / 0 | 1 | 1.9 s | not measured |
| probes | liveness 5 s × 6 failures | 3,145 | 4,005 | 51 / 0 | 0 | 1.9 s | 222 of 238, p95 9.2 s |
| front door | refuse overdue work in the proxy | 3,434 | 3,705 | 54 / 0 | 0 | 1.9 s | 227 of 241, p95 6.3 s |
| keep-alive | Node outlasts nginx's idle timeout | 3,355 | 3,846 | **0 / 0** | 0 | 1.9 s | 234 of 240, p95 1.0 s (0.98 s in the pod) |
| admission | at most 8 plans in flight per pod | **3,506** | 3,695 | **0 / 0** | **0** | **1.2 s** | **241 of 241**, p95 2.4 s (0.9 s in the pod) |

Latencies are measured by k6, so they include the client side (k6 and Docker Desktop port
forwarding on the same laptop); "in the pod" figures come from the upstream times in the
ingress-nginx access log. The raw results are in `docs/evidence/load/saturation-*.json`.

The individual fixes, and why each was needed even after the one before:

- **The clock starts at the ingress.** ingress-nginx sets `X-Request-Start: t=${msec}`
  on every request, and `proxy_set_header` overwrites any value a client sent. The app
  believes that stamp only where the deployment says the ingress writes it
  (`TRUST_UPSTREAM_REQUEST_START=true`, local overlay only), and never believes a stamp
  over a minute old or more than a second in the future. **Verified:** a forged
  "arrived 5 s ago" stamp sent through the ingress was served normally three times out
  of three, and the same stamp sent straight to a pod was refused with 503 — so the
  stamp is honoured, and the ingress replaces a forged one. The AWS overlay leaves the
  flag unset, because an ALB adds no such header.
- **Liveness tolerates a busy pod.** The endpoint is answered by the same event loop as
  the work, so an overloaded pod answers slowly, not never. Liveness now allows 5 s and
  six failures: a hung process is still restarted in about two minutes, and readiness
  has taken it out of the Service long before that. The startup probe gets 3 s instead
  of the kubelet default of 1 s.
- **Refuse at the front door.** A new measurement, liveness checks sent alongside the
  overload, showed the pods were still drowning. Served latency looked fine only
  because every request that waited too long had been refused, so it no longer counted
  as served. The nginx access log splits client time from time inside the pod: refused
  requests spent **22 s at p95 inside the pod** before being told so, and liveness
  checks 8.8 s. Refusal happened in the route handler, after routing, the rate
  limiter's Redis round trip and reading the body, and under overload those steps were
  the queue. The proxy is the first application code a request reaches and already
  holds the arrival time, so it now refuses an overdue preview itself. Those refusals
  are counted, not logged, so an overload cannot add a synchronous log write per
  refused request.
- **Keep-alive must outlast the proxy.** The remaining 502s were not restarts; nginx
  logged `recv() failed (104: Connection reset by peer)`. Next's standalone server
  closes idle connections after 5 s, and ingress-nginx keeps upstream connections for
  60 s, so nginx would reuse a connection at the moment Node closed it.
  `KEEP_ALIVE_TIMEOUT=65000` outlasts both nginx and an ALB. Changed on its own: 502s
  went **54 → 0**, and liveness p95 went 6.3 s → 1.0 s.
- **Cap accepted work, not just waiting time.** Refusals still spent 10.7 s at p95 inside
  the pod. Queue-time shedding looks at how long a request has already waited. When a
  busy loop briefly catches up, a burst of requests passes that check together, each
  then holds the CPU for 57 ms, and the loop stalls for seconds before anything else
  can be refused. The proxy now admits a preview only while fewer than
  `PREVIEW_MAX_IN_FLIGHT` (8) are unfinished in the process; eight 2,000-person plans
  are under half a second of CPU. The route releases the slot however it finishes, an
  admission never released expires after a minute, and the proxy strips any admission
  header a client sends. Refusals inside the pod: **10.7 s → 1.3 s at p95**.

What is left: 155 of 7,442 requests in the final run spent over 3 s inside a pod, all
between 30 and 50 seconds into the overload, split across both pods, with none after.
That looks like freshly started pods growing their heap under sudden load. It is
tracked as B-024 for phase 5, when in-cluster metrics can show memory and GC.

- **Rejected — raising the probe timeout alone:** it stops the restarts and leaves
  refusals taking 22 s, which is its own outage.
- **Rejected — more replicas as the fix:** the autoscaler's maximum is exactly the point
  where this happens, and a classroom can get there.

### D-047 · A deploy that does not change the pods is not a deploy
**2026-09-17** · ✅ done

Two ways the cluster reported success while running the wrong thing, both found
during the load tests:

- **Configuration.** Pods read environment variables once, at start-up. With a plain
  ConfigMap, changing a setting and re-applying did nothing to running pods until
  something else restarted them. Settings now live in `k8s/base/config.env`, and
  Kustomize generates the ConfigMap with a hash of its contents in its name, so any
  change is a new object and a rollout. The AWS overlay merges its two differences into
  the same generator.
- **Images.** The local overlay deploys `splitx:local`, and every build is loaded under
  that tag. The Deployment does not change, so no pod is replaced: a fix was "deployed"
  and the old build kept serving, which only showed because the pods report their
  commit. `k8s:up` now compares the image ID the node's containerd holds for the tag
  with the IDs the running pods report (the same scheme on both sides, unlike Docker's)
  and rolls the deployment when they differ. A second run finds nothing to do.

The pipeline in phase 6 deploys an immutable commit tag, which removes the second
problem at its source. The local overlay keeps a stable tag so rehearsals need no
manifest edits, and `k8s:up` compensates for it.

### D-048 · A page to generate real classroom traffic
**2026-09-17** · ✅ done

The graded demo is autoscaling under real classroom traffic, and nothing in the app
generated any: the settlement preview had no page. `/scale` is public, needs no
sign-in and is built for phones. Pick a group size and plan a trip: it shows the fewest
payments that settle everyone, how many IOUs that replaces, and which pod did the work.
"Keep planning" repeats it, and the list of servers that answered grows as the
autoscaler adds pods.

A page a whole room opens at once must not turn into its own load test, so the pacing
logic lives in `lib/scaleDemo.ts` with its own tests. Plans come about every four
seconds, with a second of random jitter either way. A busy answer (503) backs off
exponentially, up to eight times the wait. A rate-limit answer (429) waits exactly as
long as `Retry-After` says. Nothing runs while the page is hidden.

Checked in a browser at desktop and phone width: a 1,000-person trip settles in 960
payments instead of 11,682 IOUs, and the device cookie is set once and then reused.

### D-049 · Load tests are code, with the cluster watched as they run
**2026-09-17** · ✅ done

- k6 2.2.0 runs in its official container, pinned by digest, against the ingress from
  one address. Scenarios live in `load/`.
- Each test declares the setup it needs: production limits for the classroom, limits
  lifted for the others (`components/loadtest-limits`), and two fixed pods for
  saturation (`components/fixed-replicas`). Nothing is changed by hand.
- `scripts/load-run.mjs` applies that overlay, waits for the deployment to be at rest
  and able to open new connections (D-044), runs k6, samples the autoscaler every 5 s
  during the test and after it, restores the local overlay, and writes the raw result
  to `docs/evidence/load/`. `scripts/load-report.mjs` renders
  [docs/evidence/load-tests.md](evidence/load-tests.md) from those files.
- Time series are aligned by elapsed time, never wall clock, because the Docker VM clock
  can drift a minute from Windows after the laptop sleeps.
- **Found in the harness:** the first saturation run recorded 19 rate-limit refusals
  with the limits lifted. They came from old pods still draining the previous
  configuration, so the runner now waits out that drain after every rollout.
- **Found by accident, battery power:** a staircase attempt ran with the charger
  disconnected. One minute into the 30-plans-a-second step it had ten pods at 219% of
  their CPU request, about 5.5 cores; the run on the charger had six pods at 66%, about
  1 core, at the same moment of the same step. A throttled laptop measures its power
  plan, not the application. The runner now checks the power source before touching
  the cluster, stops on battery unless given `--allow-battery`, and records the source
  at the start and end of every result. Windows logs every change of power source: the
  charger was connected from 23:55 to 01:52, which covers all eight earlier runs
  (00:34 to 01:47), so no comparison in D-045 or D-046 mixes the two.

### D-050 · kindnet was starved by the limits Kind gives it
**2026-09-17** · ✅ fixed in `k8s:up`, checked by `k8s:verify` · corrects D-044

The first autoscaling run ended when the laptop restarted at 01:54 (Windows logged a
restart started from the desktop). After the next boot, `k8s:up` passed every check,
including fresh connections from every pod, at 16:18. By 16:23 every application pod
was unready with `Can't reach database server`, and the load runner's own connection
check refused to start the test (D-049). D-044 said kindnet had kept stale state across
a restart. A fault that appears five minutes after a clean check is not stale state, so
this time the engine itself was measured, on every node:

| Node | Memory used of limit | Times the limit was hit | CPU periods throttled | New flows waiting for a verdict |
|---|---|---|---|---|
| `splitx-worker` | 52.1 of 52.4 MB | 1,221 | 5,773 of 5,776 | 80 of the 83 queued |
| `splitx-worker2` | 52.1 of 52.4 MB | 7,015 | 5,791 of 5,793 | 126 of the 231 queued |
| `splitx-control-plane` | 52.1 of 52.4 MB | 5,241 | 5,118 of 5,189 | 0 of 0 (no application pods) |

Kind installs kindnet with a 100m CPU limit and 50Mi of memory. With network policies in
place, the first packet of every new pod connection waits in netfilter queue 101 until
kindnet has checked it against the policies. Without the limit, the kindnetd process
uses **47 MB** resident right after it starts. Under the limit, which also has to hold
the kernel memory charged to the container, it was held to **17 MB**. The container
hit its memory limit thousands of times; reclaim runs on the CPU time of whoever asks
for the memory, so it came out of the same 100m quota; the quota ran out in 99.9% of
scheduling periods; and verdicts arrived after the connections had already given up.
Established connections never pass through the queue, which is why readiness kept
flickering green. Restarting kindnet helped D-044 only until it fell behind again.

`k8s:up` now gives kindnet a 256Mi memory limit and no CPU limit, and keeps its requests
(100m, 50Mi) so the scheduler still reserves them. A component in the path of every new
connection should not have a quota: any burst of its own work becomes latency for every
pod on the node. The memory limit stays so a leak restarts kindnet instead of starving
the node. The step is idempotent; a second run reports the resources as already set.

After the change: no throttling, memory at 36 to 39 MiB with a peak of 41, no limit
hits, and nothing waiting in the queue. `k8s:verify` now reads the same counters on
every node, and fails if a CPU quota returns, the memory limit is hit, a packet is
dropped, or verdicts start piling up.

- **Not separated:** whether raising memory alone would have been enough. Both limits
  were pinned, and a quota on this component is the wrong trade on its own terms.
- **Rejected — restarting kindnet as the fix:** that is what D-044 did, and it hides the
  fault until the next pod the autoscaler starts, which is the worst moment. `k8s:up`
  still restarts kindnet if the connection check fails, as a recovery step, and stops
  if that does not help.
- **Rejected — removing the network policies from the local overlay:** the rehearsal
  would stop exercising the layer EKS enforces.
- **On EKS** the VPC CNI's network policy agent does this job, with its own resource
  settings. Phase 7 checks them, and the connection check applies unchanged.

### D-051 · The autoscaler, measured under a staircase of traffic: configuration kept
**2026-09-17** · ✅ measured

`load/staircase.js` sends 1,000-person plans at 10, 30, 60 and 100 a second, two
minutes each with rate limits lifted, then the runner watches the cluster for 15
minutes. Build `570fcf1`, on the charger at the start and the end:

| Step | Pods | CPU vs request, last minute | CPU per plan | Latency p50 / p95 / p99 | Planning p95, timed by the server |
|---|---|---|---|---|---|
| 10 a second | 2 → 3 | 45% | 34 ms | 22 / 33 / 39 ms | 20 ms |
| 30 a second | 3 → 7 | 67% | 35 ms | 22 / 34 / 67 ms | 20 ms |
| 60 a second | 10, the maximum | 90% | 38 ms | 24 / 39 / 80 ms | 24 ms |
| 100 a second | 10, the maximum | 158% | 39 ms | 26 / 74 / 113 ms | 33 ms |

All **30,029 plans were answered 200**: nothing shed, nothing rate limited, no container
restarted. CPU per plan is the autoscaler's own utilisation reading × the 250m request ×
ready pods ÷ the arrival rate k6 achieved, over the last minute of each step.

What the autoscaler did, from the samples taken every 5 s:

- **Scaling up.** Each decision came within 30 s of a new rate arriving, which is
  metrics-server's 15 s window plus the autoscaler's 15 s cycle, and the new pods were
  serving 5 to 16 s after it. For example, 30 a second arrived at 180 s, the autoscaler
  asked for 6 pods at 192 s, and 6 were ready at 208 s.
- **Sizing.** Pod counts follow the arithmetic. At 35 ms of CPU a plan, the target of
  150m per pod is about 4 plans a second per pod.
- **Past the maximum.** Pods ran above their request, 158% or about 395m each at 100 a
  second, inside their 1-CPU limit. The cost was p95 latency going from 39 to 74 ms.
- **Scaling down.** Exactly as configured: ten pods through the 300 s stabilisation
  window, then one pod a minute, back to two pods 719 s after the load stopped. The
  pods were split five and five across the workers at the peak.
- **Networking.** kindnet had judged 1,042 new flows by the peak, including the startup
  connections of every pod the autoscaler added, with none waiting, none dropped and a
  memory peak of 79 MiB (D-050).

D-025 measured 24 ms of CPU per request for one process on the host, 17 ms of it
planning. In the cluster, planning costs about the same (p50 13 to 16 ms), and the rest
of the request costs about 20 ms instead of 7. That remainder was not broken down here;
phase 5's in-cluster metrics can, alongside B-024.

**Kept:** 2 to 10 pods, a 60% target on a 250m request, a 1-CPU limit, scale-up without
a stabilisation window, scale-down after five minutes at one pod a minute.

- A class is inside the range where the scaling shows. Eighty phones on `/scale`, each
  planning a 1,000-person trip every four seconds, is 20 plans a second: about 5 pods.
- **Rejected — raising the maximum on Kind:** beyond 10 pods the limit is the laptop's
  cores, not the replica count. On EKS it is node capacity, which is the Cluster
  Autoscaler's job in phase 7.
- **Rejected — a lower target or a larger request:** pods already scale out at 4 plans a
  second while one pod can compute about 25. Scaling earlier would only add idle pods.
- **Rejected — a shorter scale-down window for a livelier demo:** a class pauses between
  rounds, and five minutes keeps the deployment from shrinking and regrowing at every
  pause.
- **For phase 7:** a 1-CPU limit on burstable EC2 instances spends CPU credits, so node
  types and limits are measured again on EKS.

---

## Phase 5 — Monitoring that is checked, not assumed

### D-052 · Monitoring moves into the cluster, and every part of it is checked
**2026-09-18** · ✅ done, the alert email proven with a real outage

The demo runs on Kubernetes, so the monitoring does too. Everything is a pinned chart in
`helm/platform/charts.json`, installed by `npm run k8s:up`:

| Component | Chart | What it does here |
|---|---|---|
| Prometheus Operator, Prometheus 3.14, Alertmanager 0.34, Grafana 13.2, kube-state-metrics, node-exporter | kube-prometheus-stack 91.4.1 | Scrapes the app, the ingress, the nodes and Kubernetes; evaluates the rules; routes alerts; draws the dashboards |
| Loki 3.6.12 | loki 7.3.0 | Stores logs for three days, on one process |
| Grafana Alloy 1.19.2 | alloy 1.12.1 | Reads the app and ingress logs through the Kubernetes API and sends them to Loki |

Everything runs in the namespace `monitoring`, which enforces the same `restricted` Pod
Security level as the application: every chart workload passed a server-side dry run against
it before installing, and the Prometheus and Alertmanager pods the operator creates were
admitted under it. node-exporter needs the host's `/proc`, `/sys`, network and PIDs, so it
alone gets a privileged namespace of its own instead of loosening `monitoring`.

**The application brings its own monitoring.** `k8s/base` now holds a ServiceMonitor, which
scrapes every pod with the metrics token from the app's own Secret, and a PrometheusRule. CI
validates both against the Prometheus Operator's JSON schemas, pinned to a commit of the
CRDs catalog, so a misspelled field fails the build.

**Six SplitX alerts**, each with its reason next to it in `k8s/base/prometheusrule.yaml`:

| Alert | Fires when | Why that threshold |
|---|---|---|
| SplitXDown (critical) | No available pod for 1 minute | Also what a database outage looks like, because readiness removes the pods |
| SplitXServerErrors (critical) | Over 2% unintended 5xx for 5 minutes, and at least 5 | Deliberate refusals (D-046) are subtracted; health checks are left out |
| SplitXSheddingLoad (warning) | Over 5% of previews refused for 10 minutes | A burst of refusals is the design working; ten minutes is missing capacity |
| SplitXSlowResponses (warning) | p95 over 1 s for 10 minutes, with at least 60 requests | D-051 served p95 54 ms up to 100 plans a second |
| SplitXEventLoopBlocked (warning) | One pod's event-loop p99 over 500 ms for 2 minutes | What made busy pods fail their probes (D-046), and the B-024 stall |
| SplitXRateLimiterUnavailable (warning) | Rate-limit checks failing for 2 minutes | Redis is down and the limiter fails open |

Kubernetes-level alerts (crash loops, stuck rollouts, an autoscaler held at its maximum) come
from the chart's default rules. `npm run test:alerts` runs 16 promtool unit tests in CI, a
case that must fire and cases built from normal life that must not: load shedding, a
readiness check failing during a database outage, one error at 3 a.m., a short burst of
refusals, a healthy pod beside a blocked one. Seven deliberate breakages of the rules were
each caught. Four of them at first were not, and each exposed a real gap: two alerts have two
guards and the tests only ever defeated both at once, and two tests could not fail, because
`histogram_quantile` returns exactly the bucket bound 1 and `1 > 1` is false. The tests were
fixed until every breakage turned them red.

Two rules were wrong on first contact with the cluster, and the fix came from what it showed.
After a reboot, with nobody using the site, the only traffic was health checks and scrapes;
readiness waiting on a database that was still starting pushed p95 to 1.6 s and
SplitXSlowResponses went pending. Both traffic rules now count only requests from people.

**Alerts go by email.** The routing tree is committed (`monitoring/alertmanager/alertmanager.yaml`):
one email per alert name per namespace, repeated every 12 hours, "resolved" emails on, a
critical alert silencing its own warnings. `k8s:up` fills the Gmail address and App Password
from `.env` into a Secret, in memory. Watchdog, which fires all the time to prove the pipeline
is alive, goes nowhere by design. `amtool check-config` validates the template in CI.

**Proven with a real outage** on 2026-09-18: Redis was stopped at 10:59:23 while a request
arrived every 5 s. Every request was still answered, because the limiter fails open, and
SplitXRateLimiterUnavailable went pending after about a minute, fired at +170 s, and was
handed to Gmail at +199 s. Redis came back at 11:03:03, the app reconnected without a
restart, and the "resolved" email left at 11:07:59. Alertmanager counted 2 sent, 0 failed.

**Dashboards are code.** `monitoring/dashboards/splitx-service.json` (28 panels) and
`splitx-logs.json` (7) reach Grafana through its sidecar as one ConfigMap and are read-only
there. A panel that asks for a metric nobody exports draws an empty graph forever, so
`k8s:verify` runs every query and checks every metric name against what Prometheus has, plus
what the app declares: a labelled counter has no samples until its first increment.

**Logs carry the request ID end to end.** The app already logged one JSON line per request with
its `requestId`. ingress-nginx now writes JSON access lines too, whose `request_id` is the
`X-Request-Id` the app put on its response, so a client cannot choose it. Alloy parses both;
`level` becomes a label, the request ID structured metadata. `k8s:verify` makes a request and
finds its ID in Loki twice, and the ingress's upstream address must be the IP of the pod whose
line carries the same ID.

**What the cluster revealed about the laptop.** Three default alerts fired from boot to
shutdown: Alertmanager "crash looping", out-of-order samples, and rule evaluations "missed".
Alertmanager had restarted exactly once, at the reboot. Measured: the Docker VM's uptime
advanced 116.2 s while Windows advanced 120.8 s, and its wall clock is stepped back and forth
by about 0.8 s every few seconds. `process_start_time_seconds` is derived from the kernel's boot
time, which moves with every step, so every process in the cluster appeared to restart 17
times in 10 minutes; one rule group was counted as missing 52 evaluations while the slowest
group took 15 ms of its 15 s. Those three alerts and `NodeClockNotSynchronising` are disabled
in the Kind values only, with the measurements beside them; EKS nodes keep time with chrony
and keep all four. Crash loops are still caught, from kube-state-metrics' restart counts.

The same clock means durations measured inside the VM, including k6's latencies in phase 4,
may read a few percent low. No decision in D-045 to D-051 sits within a few percent of its
threshold.

- **Removed from Docker Compose:** Prometheus, Grafana, Loki and Promtail. Two copies drift,
  and the old ones had real problems: Promtail ran as root with the Docker socket mounted,
  which is root on the VM, and reached end of life in March 2026; one alert called more than
  100 requests a second a "possible DDoS", which a class is; the error alert counted
  deliberate refusals; nothing received the alerts; and the overview dashboard had no request,
  error or latency panels, with an unfilled `${DS_PROMETHEUS}` data source. Compose now runs
  the app with its database and cache, and the CI tools.
- **Rejected — collecting logs from host paths:** it needs a privileged pod on every node.
  Through the API one unprivileged Alloy covers the cluster.
- **Rejected — scraping the Service address:** each pod keeps its own counters, so it would
  read a different pod each time.
- **Seen after a reboot:** the Prometheus Operator crashed twice at boot, because it started
  before kube-proxy had programmed the route to the API server, and recovered on its own on
  the third start. Kubernetes restarts pods for exactly this; nothing to fix.
- **Caught by GitGuardian on the pull request:** `scripts/test-alerts.mjs` filled the
  Alertmanager template with a made-up 16-letter SMTP password for `amtool`, and GitGuardian
  reported it as a hardcoded password (incident 37417914). It never was a credential, but a
  literal shaped like one makes every later alert from the scanner easier to dismiss, so the
  placeholder is now generated on each run. gitleaks, on commit and in CI, had not flagged it:
  two scanners with different rules catch different things. The incident is to be marked as
  a test credential in GitGuardian, by the account owner; history is not rewritten (D-003).
- **A check that looked only once:** the first full `k8s:verify` after the email test failed
  one check, 0 of 2 pods logging to Loki. Loki does hold both pods' first lines, written about
  20 s before the check ran. But the check asked once, straight after the release test had
  replaced both pods, and threw away any error Loki gave. Alloy follows a new pod's log only
  once its container is running; over a rolling restart, the first line of each new pod reached
  Loki 3 and 8 s after its container started. What held that run up for 20 s cannot be
  recovered, because Alloy and Loki have both restarted since. The check now waits up to 60 s,
  as the scrape-target check already did, and reports Loki's error if a query fails. That
  scrape check had a blind spot of the same origin: it compared how many pods were scraped
  with how many were ready, and once reported "3 of 2". An old pod still shutting down
  counted as scraped, and could as well have stood in for a new pod that was not. It now
  matches pods by name.
- **Alloy lost its place on every restart:** it records how far it has read each log in its
  storage path, which was in the container's own filesystem. A Docker restart restarts every
  container, and Alloy then read every log again from its first line (`start_time=0001-01-01`
  in its own log). Nothing was lost or counted twice: Loki discarded no line, and for the
  ingress log, sent twice, it returned and counted 62 lines where the kubelet held 62. It was
  still work done twice. The storage path is now an `emptyDir`, which lives as long as the pod:
  after its container was restarted in place, every log resumed from the time it had reached.

### D-053 · Fresh pods stalled because of their CPU limit, not garbage collection
**2026-09-18** · ✅ CPU limit removed · B-024 narrowed, not closed

B-024 was a stall at the start of the D-046 overload: requests spending seconds inside a pod,
30 to 50 s in. The working theory was heap growth and garbage collection. With the monitoring of
D-052 on, the same overload (2,000-person plans at 60 a second on two pinned pods) was run
seven times. Prometheus refuted the theory at once: garbage collection took 0.3 to 1.2% of each
pod's time, and the heap stayed between 41 and 56 MB. What did stand out: both pods sat at their
1-CPU limit and were throttled in 77 to 100% of CFS scheduling periods.

Every run began on pods that had just been started, except one. The time each request spent
inside a pod comes from the ingress access log in Loki (`upstream_response_time`), the pods and
their limits from kube-state-metrics, the rest from k6:

| Run | Pods at the start | CPU limit | Over 3 s inside a pod | Longest inside a pod | Liveness over 5 s | Plans served |
|---|---|---|---|---|---|---|
| monitored | fresh, 16–18 s | 1 core | 214, all in the first minute | 21.5 s | 12 of 238 | 3,574 |
| cold | fresh, 19–22 s | 1 core | 179, all in the first minute | 17.9 s | 11 of 239 | 3,618 |
| warm | the same two pods, 189–192 s | 1 core | **0** | **1.8 s** | **0 of 240** | 3,908 |
| cold-warmed | fresh, after 20 plans each | 1 core | 175, all in the first minute | 16.0 s | 7 of 237 | 3,446 |
| cold-2 | fresh, 21–24 s | 1 core | 228, all in the first minute | 20.9 s | 14 of 235 | 3,400 |
| nolimit-1 | fresh, 19–22 s | none | **0** | **2.9 s** | **0 of 241** | **5,169** |
| nolimit-2 | fresh, 20–23 s | none | 89, all in the first minute | 6.3 s | 3 of 239 | **5,064** |

- **The stall belongs to fresh pods.** Four runs on fresh pods had 175 to 228 requests stuck in a
  pod for over 3 s, all in the first minute; the same two pods, run again once warm, had none.
- **Warming the planner up was not enough.** Twenty plans on each pod before the load barely
  changed it (175).
- **The CPU limit was.** Without it, fresh pods had 0 and 89 such requests, the longest 2.9 and
  6.3 s, answered every liveness check (three took over 5 s, in the second run), and served
  45% more plans. Unthrottled, the
  pods peaked at 1.4 to 1.5 cores: the extra half core is V8's compiler and garbage-collection
  threads, which a 1-CPU quota makes compete with the one thread that runs JavaScript. A fresh
  process has the most of that work to do, which is why it stalled first.

**Decided:** the application has no CPU limit. The 250m request stays, because the scheduler
reserves it and the autoscaler measures against it, and memory keeps its limit, because running
out of memory is not a slowdown. The limit's original reason, that one settlement preview should
not take a whole node, never held: JavaScript runs on one thread, so a plan cannot use more than
one core with or without a limit.

- **What stands of earlier results:** the staircase of D-051 averaged about 395m per pod at its
  busiest step, far under the limit, so it stands. The D-046 runs all had the limit, so they compare with each
  other, not with the runs above.
- **Measurement note:** in every run, the warm one included, 33 to 46 requests looked held for
  over 10 s before reaching a pod, some for 54 s while spending 0.2 s inside it. That is the
  Docker VM's clock being stepped (D-052; the kernel logs `Time jumped backwards` every 30 s),
  not B-024, and the analysis above counts only time inside a pod, where it does not appear.
- **Not tried:** a higher limit, such as 2 cores, and a warm-up much larger than 20 plans.
- **Left of B-024:** one of the two runs without a limit still had 89 slow requests on fresh pods.
  On EKS, the ALB can ramp traffic to new targets gradually (slow start), which suits exactly the
  pods the autoscaler adds under load; phase 7 measures it.
- **For phase 7:** without a limit a pod bursts onto idle cores, which on burstable EC2 instances
  spends CPU credits.
- **The harness gained what this needed:** `--keep-overlay` runs the next test on the same pods,
  `--warm-up N` plans N trips on each pod first, and every result records its pods, their
  resources and their age on the cluster's own clock. The saturation table shows both.

---

## Phase 6 — Delivery: GitHub Actions releases, Jenkins deploys

### D-054 · A release is built once on main, scanned, signed, and handed over as a deployment
**2026-09-18** · 🚧 written; first runs on the next merge to main

Each tool in the pipeline gets one real job. GitHub Actions already tests every change; it now
also turns every commit on `main` that passed those tests into a release. Jenkins, in the
cluster, deploys releases (D-055). Nothing is built twice, and nothing unsigned is deployed.

The `release` job in `.github/workflows/ci.yml` needs every other job, runs only for `main`,
and runs one at a time in commit order:

| Step | What happens | Why |
|---|---|---|
| Build and publish | The `release` bake target, the same one `npm run image:build -- release` builds, pushed as `ghcr.io/sayandip-jana-1018/splitx:<commit>` with a provenance attestation and an SBOM | One image per commit, with its origin attached; the tag is the commit, and nothing publishes a moving tag |
| Scan | Trivy 0.74.0 fails the release on any critical or high vulnerability that has a fix | Measured first: the current image has 18 Alpine and 43 npm packages and no known vulnerability at any severity, so the gate starts green and means something |
| Sign | cosign 3.1.3, keyless: Sigstore issues a short-lived certificate naming this workflow, repository and branch, and the signature goes into the public Rekor log | No signing key to store, leak or rotate, and the signature says which workflow on which branch built the image. An image that fails the scan stays published but unsigned, and is never deployed |
| Hand over | A GitHub deployment for the environment `kind`, whose payload is the image by digest | GitHub delivers it to Jenkins as a signed `deployment` webhook, keeps a history per environment, and shows the result Jenkins reports back |

- **Public image, approved by the owner:** the repository is public, and the image holds no
  secret, because configuration arrives at runtime (D-028). Anonymous pulls mean no registry
  credential in either cluster. GitHub creates every new package private; the owner switches
  it to public once, which cannot be undone.
- **Every action is pinned to a commit**, in the existing jobs too. A tag can be moved, and this
  job can publish packages and sign in the repository's name.
- **Rejected — building in Jenkins:** it would need a privileged image builder in the cluster,
  the same kind of power D-052 took away from Promtail, and the image would no longer be the
  one CI tested.
- **Rejected — a signing key in a repository secret:** it must be rotated, and D-003 shows
  how secrets in this repository have fared.
- **Rejected — deploying on push events:** a push says code changed. A deployment names the
  exact, signed image and the environment it is for, and can be answered with a status.

### D-055 · Jenkins deploys what GitHub Actions signed, and takes back what does not come up
**2026-09-20** · ✅ done, a signed release deployed and a broken one rolled back

Jenkins moved out of Docker Compose, where it mounted the Docker socket — root on the VM, the
same power D-052 took away from Promtail — and into the cluster, as a pinned chart in a namespace
at the application's own `restricted` Pod Security level. It builds nothing. Building there would
need a privileged image builder, and would produce a second image for a commit CI had already
built and tested.

**Everything is configuration as code** (`helm/platform/jenkins.values.yaml`): the security realm,
the credentials (read from Secrets `npm run k8s:up` builds from `.env`), the webhook gate, and the
job itself in Job DSL. Nothing is set by clicking, and a rebuilt cluster is the same cluster.

| Step of `splitx-deploy` | What it does | What it refuses |
|---|---|---|
| Request | Checks the parameters, then asks GitHub whether this is still the newest deployment for this environment, and whether its commit and image match what the webhook said | A replayed or superseded delivery is skipped, not deployed; a malformed one fails |
| Verify | `cosign verify`: the signature must carry this repository's CI workflow **on main**, and the same commit the deployment names | An image built from a branch, or for another commit |
| Deploy | Checks out the release commit and applies **its own** manifests, with only the image replaced by the verified digest | — |
| Roll out | Waits for Postgres, the schema Job and the deployment (150 s) | — |
| Check | Every ready pod runs that digest, and the edge answers ten times in a row from those pods, plus a real settlement preview | — |
| On failure | Rolls the deployment back to the revision recorded before applying, and waits for it to serve again | — |
| Always | Reports the outcome on the GitHub deployment | — |

The procedure comes from main; the manifests come from the release commit, so pods get the
configuration their code was written for. Builds run in an agent pod as `jenkins-deployer`, whose
Role (`jenkins/rbac.yaml`) covers the application's objects in `splitx` and nothing else: the API
server confirms it cannot read a Secret, exec into a pod, or touch another namespace. Creating a
workload always implies mounting that workload's secrets — that is what deploying is — and the
image it may deploy is limited by the signature check above.

**Measured** (`npm run cd:verify`, [docs/evidence/delivery.md](evidence/delivery.md), 13 checks):

- The signed release of `52137218e1d4` was deployed in **177 s**, and both pods ran the digest
  GitHub Actions signed.
- The same release, deployed with a fault that keeps new pods unready, failed after **210 s**,
  was rolled back automatically, and **717 of 717 requests were answered 200** while it happened:
  `maxUnavailable: 0` means a release that never becomes ready never takes traffic.
- A delivery naming an older deployment was skipped as superseded, not deployed.

- **It is on the wall too:** `monitoring/dashboards/splitx-delivery.json` (12 panels) shows the last
  deploy and how long it took, the webhook stream, deliveries by what Jenkins answered, and the relay
  and deploy logs beside the requests the application was serving at the time.
- **Pinned, all 81 of them:** the chart resolves dependencies to the *lowest* version each plugin
  allows, and that set did not fit together — JUnit, and with it the Prometheus plugin, failed to
  load. The values file now lists every plugin and dependency at the version that actually
  resolved, and a restart re-downloads exactly those.
- **It could not restart:** the chart's init container ends with `yes n | cp -i`, which answers
  "no" to every overwrite and exits 1 when there was anything to decline, under `set -e`. The
  first in-place restart of the pod — every Docker restart — left Jenkins in CrashLoopBackOff.
  A small init container now empties that volume first; proven by the next Docker restart.
- **No kubectl or cosign in an image we build:** the agent mounts the official `kubectl` and
  `cosign` images as read-only image volumes (Kubernetes 1.35), so builds run exactly what those
  projects published, with nothing downloaded at build time.
- **Rejected — Argo CD:** it would be a second deployer for the same objects, fighting Jenkins
  over them, and phase 6 is graded on Jenkins. `argocd/` is deleted (B-022); it pointed at a Helm
  chart removed in D-034.
- **Rejected — `kubectl set image` only:** it would leave the cluster's manifests behind the
  commit that was deployed.
- **Known limit:** a rollback returns the application's pods to the previous revision. Other
  objects the release changed (a Service, a NetworkPolicy) stay as the release left them, and the
  next release corrects them.

### D-056 · How GitHub's webhook reaches a Jenkins that has no address
**2026-09-20** · ✅ the path works; the first real GitHub delivery is the webhook's own ping

GitHub cannot reach a laptop. The owner chose a [smee.io](https://smee.io) channel: GitHub posts
there, and a relay inside the cluster (`jenkins/relay/relay.mjs`, no dependencies, ~150 lines)
holds that channel's event stream open and replays each delivery to Jenkins with GitHub's own
headers. The alternative, a tunnel, would put Jenkins itself on the public internet.

**The relay is a courier, not a guard.** It never holds the webhook secret. Jenkins verifies
GitHub's `X-Hub-Signature-256` before any job sees a delivery, and refuses what does not verify:

| Delivery | Answer |
|---|---|
| Not signed, signed with another secret, or changed after signing | HTTP 403, no build |
| Signed but with the wrong endpoint token | HTTP 404, no build |
| Signed `ping`, or a deployment for another environment | HTTP 200, no build |

**What smee.io does to a body, measured:** it parses the JSON and hands the relay an object, so
the body is rebuilt with `JSON.stringify`. A signature survives when GitHub's bytes are what
`JSON.stringify` writes — compact, characters unescaped, no number that changes when reparsed.
Probed with six shapes: compact JSON and literal Unicode survived; `<`-escaped characters,
spaces between tokens, a number beyond 2^53, and a form-encoded body did not. GitHub sends
compact JSON, and a signed ping of that shape went out to the channel and was accepted by
Jenkins. If a real delivery ever fails this check it fails loudly, with HTTP 403 and an alert,
never silently accepted.

Three things must be true before anything is deployed, and the webhook is only the first:
the signature, then GitHub's own record (the deployment must still be the newest, with the same
commit and image), then the image's signature (D-055). A forged or replayed delivery therefore
cannot deploy anything that GitHub Actions did not build from main.

- **What it costs:** smee.io keeps nothing for a listener that is away, so deliveries made while
  the relay is down are lost. `WebhookRelayDisconnected` fires after five minutes without the
  stream, `WebhookDeliveryRefused` on anything Jenkins did not accept, and GitHub's own
  "Recent Deliveries" page can redeliver them. Both alerts are unit-tested (`npm run test:alerts`).
- **Proven by an outage:** when the Docker VM restarted, the relay lost its stream, logged it,
  and reconnected on its own once DNS came back.
- **On AWS:** Jenkins is behind the ALB, GitHub calls it directly, and the relay is not deployed.
  The gate above does not change.
- **The first real delivery was refused, for the reason the relay gave:** GitHub's ping when the
  webhook was created (2026-09-20) arrived form-encoded, GitHub's default content type. Its body
  could not be rebuilt byte for byte, the relay logged `the webhook must send application/json`,
  and Jenkins answered 403. Found in Loki the next day. The fix is in the webhook's settings
  (content type `application/json`, the Deployments event), not in the gate.

### D-062 · The cluster gets a fixed share of the laptop, and sleeps when it is not being shown
**2026-09-21** · ✅ CPU budget and pause/resume, measured · the WSL memory cap is the user's to set

The laptop had become hard to use whenever Docker Desktop was running. Measured twenty minutes
after Docker started, with the cluster and the Compose stack up:

| Where | What |
|---|---|
| Windows | 15.7 GB of memory, about 0.3 GB available, 25.5 GB committed, 1,600 pages a second going to and from disk |
| The WSL VM | at its 10 GB cap, 3.5 GB of it paged out by Windows; inside, 4.6 GB used by processes and 5.2 GB by file cache |
| Inside the VM | tasks stalled on memory 24% of the last 10 s and 45% of the last 5 minutes (PSI `full`); load average 51 on 24 threads |
| The cold start | every pod started together when Docker did: one node at 9.2 cores, Grafana alone at 8.3 cores for minutes |
| Controllers | kube-controller-manager had restarted 17 times, kube-scheduler 16, each Kyverno admission controller 10: API calls timed out, they lost their leader lease and exited to start again. The Kyverno reports controller crash-looped on its cache sync |

Three causes:

1. **Memory.** The 10 GB cap from the phase 0 notes leaves Windows 5.7 GB, and Windows with an editor,
   a browser and this assistant uses about 9. So Windows pages the VM out, and work in the VM waits on
   Windows' disk; inside, that shows as memory stalls, API timeouts and lost leases. File cache counts
   against the cap too, and WSL 2.7 hands cache back only when the VM is idle
   (`autoMemoryReclaim=dropCache`), which a cluster never is. Dropping the cache by hand freed 2.6 GB
   inside the VM and returned under 1 GB to Windows.
2. **Every Docker start was a cluster cold start.** Kind gives its nodes the restart policy
   `on-failure`, and Docker Desktop's shutdown counts as a failure, so the cluster started with
   Docker every time, whether it was needed or not.
3. **Nothing bounded the burst.** No pod has a CPU limit, on measurement (D-050, D-053), and the
   nodes had none either.

**Decided:**
- **A CPU budget on the nodes, not the pods:** 2 CPUs for the control plane and 4 for each worker,
  10 of the laptop's 24 threads, set with `docker update --cpus` by `k8s:up` and kept by Docker
  across restarts. Inside, D-053 still holds: pods share a node by their requests, and none is
  throttled against a quota of its own. On EKS each node is a machine of its own, and this does not
  apply.
- **`npm run k8s:pause` and `npm run k8s:resume`** (`scripts/cluster-power.mjs`). Pause stops the three
  nodes. They stop on SIGRTMIN+3, so systemd stops every pod's scope rather than the pods being
  killed, and a stopped node stays stopped across Docker and Windows restarts until resume starts it.
  Resume waits for application pods whose container started *after* the resume and has passed
  readiness since, because a pod's status can still say Ready from before the stop. Then it waits for the edge.
- **The Compose copy of the app is stopped.** The cluster runs the app. The Compose Postgres and Redis
  are what `npm run dev` uses (outbound 5432 is blocked here), so they start with
  `docker compose start postgres redis` when needed.
- **WSL's memory cap should be 6 GB**, not 10. It is a setting of the machine, so the user makes it,
  not a script (Environment notes).
- Found on the way: the Kyverno reports controller's resources were set under `container:`, where the
  chart does not read them for that controller, so it ran on the chart's 64Mi request and 128Mi limit.
  They are now where the chart reads them; the pod has 128Mi and 384Mi.

**Measured after:**

| | Result |
|---|---|
| `k8s:pause` | 61–62 s. The workers stop in order in 6 to 23 s. The control plane reaches the 60 s ceiling in systemd's last step, after its pods, etcd included, have stopped within 9 s; Docker ends what is left, and the script says which |
| Windows, two minutes after pausing | available memory 0.5 → 2.4 GB, the VM 8.9 → 5.7 GB, committed 26.1 → 23.3 GB |
| `k8s:resume`, budget on | the application answering at the edge in 36 s and every pod Ready in 82 s, with no crash loop; both Kyverno admission controllers back in 74 s. The laptop's CPU was 11–55% busy throughout |
| What the budget does not fix | during the resume, available memory on Windows fell to 98 MB within 25 s, because the VM grows back into its 10 GB cap. That is what the 6 GB cap is for |

Load tests recorded before this (D-046, D-051, D-053) ran on nodes without a budget. A load test on
this laptop now meets the budget before anything else, so rerun them before quoting their numbers for
the Kind cluster. The demo itself runs on EKS (phase 7).

**Later the same day: the cluster ran unnoticed, and did not fit.** After the WSL cap went to 6 GB,
`k8s:up` woke the cluster, and it kept running with Docker Desktop in the tray while the user
believed Docker was off. An hour later its VM had about 4 GB in memory and all 8 GB of swap full. The control
plane was crash-looping (controller-manager 26 restarts, scheduler 25), the application was unready
(503 at the edge), and the API server stopped answering (TLS handshake timeouts). On Windows the
disk queue stood at 100–245 with reads taking 61 ms, and the CPU sat at 98 °C at 37% busy. Once the
nodes were stopped and Docker Desktop quit: 3–5% busy, 61–65 °C, 8.2 GB free, disk queue 0,
about 1 ms per read.
- **Decided:** `k8s:up` also gives the nodes the restart policy `no`. A cluster runs only after
  `k8s:up` or `k8s:resume` start it, never because Docker did. Docker Desktop itself should not start
  at sign-in, which is the user's setting.
- **Not understood yet (B-027):** the VM needed about 12 GB (4 in memory, 8 in swap) when, the day
  before, the same cluster used about 4.6 GB. Until that is measured, the full cluster does not fit
  in a 6 GB VM.

### D-061 · The scan at build time answers a question that ages
**2026-09-20** · ✅ done, proved against the running release

Every release is scanned before it is signed (D-054), and that answer is true for one day. A
vulnerability published tomorrow is one nobody has looked for, and the release most likely to be
running for weeks is the one that passed.

`k8s/base/release-scan.yaml` is a CronJob that asks the same question of what is *running*, daily.
It reads the image from the Deployment rather than being handed one — so it scans what the cluster
actually has, including after a rollback — and fails the Job when Trivy finds a critical or high
vulnerability that has a fix. `SplitXReleaseVulnerable` alerts on that failed Job through
kube-state-metrics: no new exporter, no pushgateway, and the alert's four unit tests each catch a
deliberate break of the rule.

- **Only the last day's scan counts.** Failed Jobs are kept for their logs, so an alert keyed on
  "a failed scan exists" would keep firing after the next release fixed it. The rule ignores scans
  that started more than a day ago; the test that proves it samples 26 hours at five-minute
  intervals, because an hourly series goes stale between samples and never satisfies `for: 5m`.
- **The first run failed honestly:** the rehearsal cluster was running `splitx:local`, which
  exists only in the nodes' containerd. Trivy cannot fetch it, and a scanner is not given the
  container runtime's socket to work around that. The job now says "not a published release:
  nothing to scan" and stops, instead of alerting about the absence of a registry.
- **Measured:** against the running release, the scan found no fixable critical or high
  vulnerability, in 61 packages, and the Job completed.
- **kubectl and Trivy are mounted, not installed:** their projects' own images as read-only image
  volumes, the same pattern as the deploy agent (D-055), so there is no hand-built tools image to
  maintain and nothing is downloaded at run time except the vulnerability database.
- **What it may read:** one Deployment, by name. Nothing else.

### D-060 · The cluster refuses an image our workflow did not sign
**2026-09-20** · ✅ done, proved by three attempts

D-055 left a hole and said so: Jenkins verifies the signature before it deploys, but that is one
path in. A `kubectl apply`, a Job, a controller with permission to create pods — each goes around
it. The check now happens at admission, where nothing can skip it.

Kyverno 1.19 (chart 3.9.1) runs in its own `restricted` namespace with two admission replicas and
the reports controller; no background or cleanup controller, because nothing here generates or
mutates existing resources. `policy/verify-release.yaml` is an **ImageValidatingPolicy** — the
older `kyverno.io/v1 ClusterPolicy` still works but is deprecated in 1.19 and warns on every
apply, which is not a thing to ship new.

The rule: any image from `ghcr.io/sayandip-jana-1018/*`, in the `splitx` namespace, must carry a
cosign signature whose certificate names **this repository's CI workflow on main**, issued by
GitHub's OIDC provider. Three attempts, each a pod that satisfies the namespace's Pod Security
level so the only thing left to refuse it is the policy:

| Asked to run | Answer |
|---|---|
| The release GitHub Actions signed | admitted |
| A tag under our name that was never published | refused |
| The same signed image, judged against a workflow that did not sign it | refused |

The third is the one that matters: the policy checks *whose* signature it is, not that a signature
exists. Jenkins then deployed that release again through the whole pipeline, and the policy
admitted it — enforcement that breaks delivery would not survive its first day.

- **Scoped to `splitx`, and `failurePolicy: Fail`:** the engine refuses what it cannot check, but
  only for the namespace the application runs in, so an outage of the policy engine cannot stop
  the rest of the cluster from starting pods. It does mean a release cannot start while Kyverno
  is down, which is the trade a security control makes.
- **Images from elsewhere are untouched:** Postgres, Redis and the locally built `splitx:local`
  are not ours to sign, and the rule does not pretend otherwise. On EKS every pod runs a signed
  release, so the same policy covers everything there.
- **Rejected — signing keys in a Secret:** the signature is keyless (D-054); an admission policy
  holding a public key would only move the trust problem.
- **Cost:** three pods, about 320Mi requested.

### D-059 · One registry for both clusters, and a rule that actually looks at all of them
**2026-09-20** · ✅ done · ⚠️ leaves the ECR module unused

The AWS overlay still pulled `ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/splitx:latest`, written
before there was a pipeline. Two things were wrong with it. A moving tag makes a rollback
meaningless — the rule that says so has been in CI since phase 3, but it only ever rendered the
*local* overlay, so it never saw this one. And the registry no longer matched reality: releases
are published to ghcr.io, signed there, and deployed from there by digest (D-054, D-055).

Both clusters now pull the same image from the same place. The tag in the overlay is the last
real release, so `npm run k8s:render` shows an image that exists; Jenkins replaces it with the
digest it verified. The CI rule now renders every overlay and rejects `:latest`, `:main` and
`:stable` in any of them.

- **Why not ECR:** it would need a second publish from CI with AWS credentials, a second digest
  for the same commit, and a second identity for the signature to name. The image is public and
  pulls from EKS without a credential, and one digest keeps the signature check meaningful.
- **What this leaves:** `terraform/modules/ecr` and the node role's ECR read policy are now
  unused. They stay until phase 7 decides whether anything needs them (a private mirror for rate
  limits is the only argument left), and this note is here so nobody assumes they are load-bearing.
- **The lesson worth keeping:** a rule that checks one of four things passes for the wrong reason.

### D-058 · Both replicas moved onto one node once Jenkins took the other
**2026-09-20** · ✅ fixed and measured

`k8s:verify` started failing its first check: both application pods on `splitx-worker2`. Nothing
about the application had changed — Jenkins had moved into the cluster and asked for 768Mi on
`splitx-worker`, and the scheduler began putting both replicas on the emptier worker. It is
allowed to: the spread constraint is `whenUnsatisfiable: ScheduleAnyway`, which makes spreading
one score among several, and node-resource scoring outweighed it. It happened on two runs in a
row, so it was not a moment during a rollout.

The constraint stays soft — a hard one would leave a replica `Pending` while a node is away, and
two nodes went away today — but the deployment now also says it in the strongest form a
preference has: `podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution` at weight 100,
keyed on the hostname. After applying it, the rollout put one pod on each worker again.

- **Why not raise Jenkins' request, or pin the application to a node:** both trade a real
  resource decision for a scheduling symptom. The deployment should say what it wants; it now does.
- **What it costs:** nothing while both workers are healthy. With one worker gone the preference
  yields and both replicas run on the survivor, which is the behaviour that was wanted.
- **Caught because a check measures placement**, not because a manifest declares an intention.

### D-057 · The edge was being killed by its own worker count
**2026-09-18** · ✅ fixed and measured

Adding the Jenkins Ingress made the ingress-nginx controller exit 137, twice, and the site went
with it: a helm upgrade was refused mid-flight because the admission webhook it serves would not
answer. Its last state was `OOMKilled` at the 384Mi limit, and Prometheus had it holding 361 MiB
the day before, so it had been running at the edge of that limit for days.

nginx starts one worker per CPU it can see, and the Docker VM shows all 24 of this laptop's:
`worker_processes 24`, and 24 worker processes at roughly 12 MiB each. A configuration change
reloads nginx, and a reload runs the new workers beside the old ones until the old ones finish
their connections, so the moment an Ingress changes is exactly when it needs twice its memory.

`worker-processes: "4"`, applied as a live reload with no restart: **82 MiB where it had been
about 300**, and the controller now survives Ingress changes. One nginx worker serves thousands
of requests a second; the heaviest test in this project sends 100.

- **Why it never showed before:** Ingresses rarely change. Phase 6 adds one, and each helm
  upgrade of the chart reloads the controller.
- **Kind only:** this values file is the rehearsal cluster's. On EKS the entry point is an ALB
  (phase 7), and node sizes there make the CPU count meaningful.
- **Still true of the limit:** 384Mi stays. With 4 workers it is roughly four times the
  steady-state need, which is the room a reload wants.

---

## Phase 7 — A money engine that holds up with real users

### D-063 · One ledger for every balance, and money that can't vanish
**2026-09-22** · ✅ written and unit-tested (770 → 844 tests) · production data is checked next (fix 9 of the plan)

An audit of the money engine found four critical faults, all in how balances were read or written:

| # | What was wrong | What a user saw |
|---|---|---|
| 1 | Removing a member re-split only *their* shares among the others, ignoring what they had paid and settled | The rest of the group owed someone who was no longer in it, and debts moved between people who never agreed to them |
| 2 | Settle Up and the Dashboard read one arbitrary active trip per group | Their suggestions disagreed with the group page once a group had two trips; paying a suggestion could leave a balance or be refused |
| 3 | Editing an expense's amount kept its old shares | Shares that no longer added up to the expense: money created or destroyed |
| 4 | An edit's `splitAmong` accepted anyone, and the same person twice | A stranger charged for a group's expense, or one person charged twice |

Found while fixing them:
- The payment check (`POST /api/settlements`) netted only the trip it was given, and a `catch {}`
  let every payment through whenever the check itself failed.
- Five places computed balances, each slightly differently: one trip or all trips, current members
  only or everyone, ±1 paisa counted as settled or not.
- Deleting a group soft-deleted every expense and cancelled payments on their way, whatever anyone
  still owed (high finding 7).
- The edit screen sent the amount and the members on every save, so once edits were validated a
  custom-split expense could not even be renamed.

**Decided:**
- **One ledger** (`src/lib/ledger.ts`). A group's balances are every live expense and every
  completed settlement on all of its trips, in exact paise, by one formula (`computeGroupBalances`).
  Settle Up and the Dashboard (`/api/settlements/by-group`), `/api/settlements`, the group page
  (`/balances`, and the group detail it shows while that loads) and every guard below read it.
  Someone who has left but still owes or is owed stays in the plan under their own name; before,
  their money disappeared from it.
- **Exact paise, stable plans.** The planner no longer treats ±1 paisa as settled. Equal splits hand
  out the odd paise by member ID (`equalSharesById`), so each paisa is owed by someone specific and
  the plan clears it; accounts are sorted by ID before planning, so the same balances always give
  the same plan.
- **One set of split rules** (`src/lib/expenseSplits.ts`), for creating and editing alike: members
  only, each at most once, adding up to the amount exactly, at most ₹10,00,000. An edit that changes
  the amount or the people recomputes the shares; a field sent unchanged changes nothing.
- **An edit lands only on the version that was read.** The write is an `updateMany` on `id` and the
  `updatedAt` that was read, checked for one row; the edit screen also sends the `updatedAt` it
  showed. Losing a race is a 409 saying someone else changed the expense, never a silent overwrite.
  Only a current member who paid, or the owner, may edit or delete, so a removed member loses that
  right. A delete lands once.
- **Leaving is allowed only when square.** Removing a member is refused while they owe, are owed, or
  have a settlement waiting. No share is rewritten, and their past expenses stay. The invite code
  changes on removal, so the old link can't bring them back. Deleting a group is refused the same
  way. Each check shares a serializable transaction with its write; a conflict (`P2034`) is a 409
  asking to try again.
- **A payment must fit.** At most what the payer owes and what the receiver is owed, both across the
  whole group, less what open settlements already carry (`settlementRoom`). It is checked in a
  serializable transaction with the insert, and no error is swallowed. An open request for the same
  payment is reused whichever trip it was made on, and Settle Up matches payments waiting for
  approval to its suggestions by payer, receiver and amount, not by trip.
- **Bad input is a 400 with a sentence, not a 500:** malformed JSON, amounts past the 32-bit columns,
  and schema errors as one readable message.

**Rejected:**
- Re-splitting the leaver's shares, which is what the old code did: it moves debts between people who
  never agreed to them.
- Settling a leaver's balance automatically against the owner: the same thing with extra steps.
- A ±1 paisa tolerance: it hides a real debt of one paisa, and makes plans depend on rounding order.

**Tests:** split rules, including 500 random equal splits that must add up exactly; the ledger across
two trips with completed, pending and cancelled settlements and a former member; route tests for
removing a member, deleting a group, editing and deleting an expense, creating a payment and both
plan endpoints. Run against the code before this change, 39 of the 45 route tests fail; the other 6
pin permission checks that were already right. The planner's randomized test now requires every
balance to clear exactly, not to within a paisa.

**Left:** approving and confirming a payment don't re-check the balance yet, and the settlement state
machine still allows cancelled → completed. Both are D-064. The AI chat computes its own pairwise
balances (B-028). Data written by the old removal may hold shares moved between people (B-029).

### D-064 · A settlement moves by one table, one step at a time
**2026-09-22** · ✅ written and unit-tested (844 → 915 tests)

A payment's state lived in `if`s spread over four routes, and they disagreed:
- "Got cash" completed a settlement from any state that wasn't already complete, so a request the
  receiver had marked as not paid could still be completed, and counted.
- Every route read the status, checked it, then wrote the new one unconditionally: two taps on
  Approve both landed, and the completion was counted twice in the metrics.
- Only some moves were audited: "Got cash", "Not paid" and opening UPI left no record.
- Nothing re-checked balances once a request existed, so a request made before an expense changed
  could be paid at its old amount.
- The UPI screen treated every refusal as "the receiver has no UPI ID" and offered to take one by hand,
  so money could leave the payer's account for a payment the app would then refuse to record.

**Decided** (`src/lib/settlementTransitions.ts`):

| Move | Who | From | To |
|---|---|---|---|
| `open_upi` | payer | pending, initiated | initiated |
| `mark_paid` | payer | pending, initiated | paid_pending |
| `approve` | receiver | paid_pending | completed |
| `send_back` | receiver | paid_pending | initiated |
| `mark_received` | receiver | pending, initiated | paid_pending |
| `accept_cash` | receiver | pending, initiated, paid_pending | completed |
| `decline` | receiver | pending, initiated, paid_pending | cancelled |

- A move lands only on the state that was read: `updateMany` on `id` and that `status`, checked for
  one row. Of two taps at once, exactly one wins; the other is a 409. Completed and cancelled
  settlements never move again.
- **The payer's moves re-check the group's balances** (`settlementRoom`, D-063), leaving out the
  request itself, in a serializable transaction. They come before money leaves the payer's account,
  so this is where a stale amount is caught (`balance_changed`).
- **The receiver's moves record what happened.** Approving or accepting cash says the money has
  arrived; refusing to record it would make the app disagree with the bank. If a receiver approves
  more than was owed, the difference shows as owed back, which is true.
- Every move is written to the audit log with its name and the settlement before and after.
- The four routes keep their URLs and bodies, and map the page's buttons onto the table; an unknown
  action is a 400, where "confirm by receiver" used to fall back to a default. Responses no longer
  carry either person's UPI ID. The UPI screen offers manual entry only for `no_upi_id`, and "Paid
  cash" reports a refusal instead of success.

**Tests:** every move from every state (42 cases), each move by the wrong person, two approvals at
once, the audit record, the balance re-check (and the request not counted against itself), a
deleted group, and a serializable conflict; plus the routes' wiring.

**Left:** a payer can't withdraw their own request; the receiver's "Not paid" is the way out, and
the refusal says so. The frontend review (phase 1b of the plan) adds the button.

### D-065 · Only a group's members reach it, and the server writes what it says
**2026-09-22** · ✅ written and unit-tested (915 → 924 tests)

Four ways a signed-in person could reach past their own groups:

| Where | What was possible |
|---|---|
| `POST /api/contacts/invite` | Anyone who knew a group's ID got its invite code, and with it could join (security finding H1) |
| `POST /api/notifications` | Any member could send anyone in a shared group a notification with any title, text, type and link: a phishing channel inside the app |
| `POST /api/groups/:id/messages` | A message could claim `type: system` (a fake "✅ confirmed receiving ₹5,000"), attach a settlement or an expense from any other group by ID, and be of any length |
| Settlement moves | A person removed from a group could still approve or decline payments in it (high finding 6); editing and deleting expenses was closed in D-063 |

**Decided:**
- A group's invite link goes only to its own members; any other group ID is a 404.
- **The only notification a person can send is a payment reminder, and the server writes it:** the
  request names the person and the group; both must be members, the amount comes from the group's
  settle-up plan (a reminder to someone who owes the sender nothing is refused), and the title,
  text and link are fixed. One a minute per pair, as before.
- **Chat takes text and payment reminders, up to 1,000 characters.** System messages, and messages
  carrying a settlement or an expense, are written by the server alone (approving a payment writes
  one).
- **Moving a payment needs current membership** of its group, like editing an expense.
- An invitation needs a group that still exists. Malformed JSON on these routes is a 400.

**Tests:** each hole above, from the outside: the invite code never appears for a non-member, a
reminder's text and link are the server's whatever the request says, and a chat message can't be a
system message or carry another group's records.

### D-066 · Nothing a signed-in person sees outlives signing out, and history reads only its own group
**2026-09-22** · ✅ written and unit-tested (924 → 931 tests) · production check after merge: `/sw.js` answers 200

**The service worker.** The audit found the PWA configured to keep `/api/*` responses for 24 hours
(`next-pwa`'s default `apis` rule, NetworkFirst), which on a shared phone outlive signing out. Checking
production showed something else: `https://splitsj.vercel.app/sw.js` answers **404**, and always has.
`@ducanh2912/next-pwa` is a webpack plugin; it was added on 2026-02-20 together with `turbopack: {}`,
which tells Next.js 16 to build with Turbopack and ignore webpack plugins. So the 24-hour cache never
ran in production, and neither did the PWA: there was no worker to install or to show anything
offline. A `next build --webpack` would have switched both on.

**Decided:**
- `next-pwa` goes; `public/sw.js` is written by hand, 40 lines. It makes the app installable, shows
  `public/offline.html` when there is no connection, and caches nothing else. If a browser holds a
  worker from any other build at the same URL and scope, installing this one deletes every cache that
  worker left, `apis` included.
- It is registered with `updateViaCache: 'none'`, and `/sw.js` is served `no-store`, so a fix to it
  reaches installed apps on their next launch.
- Signing out also deletes every cache but the offline page (`signOutAndForget`).
- **Rejected:** `next build --webpack` to keep `next-pwa`. It would bring back a generated worker
  whose rules are defaults we would have to keep overriding, for offline copies of a money app that
  would be out of date anyway.

**Balance history** (high finding 8) read every expense audit log in the database created since the
group, for every group, and filtered them in JavaScript. It now asks only for the audit logs of this
group's own expenses (`entityId IN` the group's expense IDs). `AuditLog` had no index; one on
`(entityType, entityId)` is the first migration after the baseline (D-072).

**Tests:** `public/sw.js` itself, run against an in-memory Cache Storage: it deletes an earlier
worker's caches, never answers an API call, and shows the offline page only when the network is gone. The
history route asks the audit log for its own expenses only, and not at all for a group without any.

### D-067 · AI that can't run up a bill, answers from the ledger, and works again
**2026-09-22** · ✅ written and unit-tested (931 → 961 tests) · measured against Gemini's live API

The three features that cost money per call (AI chat and voice entry on Gemini, receipt scanning on
OpenAI) had no limit per person or overall, took input of any size (a receipt photo of any size at
"high" detail; a transcript or member list of any length), and waited on the provider without a
deadline (security finding H3). Checking them against the live API found two more things:

- **The AI chat has been broken in production.** Google retired `gemini-2.0-flash`, the model both
  Gemini features named: generation answers 404, "no longer available … use gemini-3.6-flash".
  The chat replied "Sorry, I couldn't process that right now"; voice entry fell back, unnoticed, to
  its simple parser.
- **Gemini is slow when busy.** On 2026-09-22 a one-word reply from `gemini-3.6-flash` took 14–153 s
  depending on the thinking setting and the moment; the lighter models answered 503, "high demand".
  With 64 output tokens and default thinking, the reply was empty: thinking counts against the limit.

**Decided:**
- **Allowances** (`src/lib/aiQuota.ts`): per person per day, 30 chat questions, 40 voice entries and
  10 receipt scans, plus 400 AI calls a day for all of SplitX, each overridable (`AI_DAILY_*`).
  `AI_DISABLED=true` switches all of it off. They count in the rate limiter's Redis
  (`consumeAllowance`), and **fail closed**: if the counter can't be reached, no paid call is made.
- **Past a limit, the help doesn't stop, only the cost.** The chat answers from the same data
  without AI (the local answer that already existed), saying the allowance is used; voice entry uses
  the simple parser. Receipt scans, which have no server-side substitute, say so and point to
  on-device scanning, with `Retry-After`.
- **One Gemini client** (`src/lib/gemini.ts`): the key in the `x-goog-api-key` header instead of the
  URL; instructions and SplitX's data in `systemInstruction`, the person's words as their own turn,
  and a line telling the model that names and titles in the data are data, not instructions; a
  deadline on every call (25 s chat, 15 s voice), after which the local answer is used; thinking set
  to `low` for the chat and `minimal` for voice; the model is `GEMINI_MODEL`, by default
  `gemini-3.6-flash`, the replacement Google names.
- **Input caps:** a chat question up to 1,000 characters; a transcript up to 500, with at most 50
  members of 60 characters each (the name matcher's work grows with both); a receipt photo up to 4 MB
  as JPEG, PNG or WebP. The scan page now shrinks photos to 2,048 pixels on the long side before
  sending: the vision model reads no more than that at high detail, and Vercel refuses request
  bodies over 4.5 MB, so large phone photos used to fail there. The OpenAI call has a 45 s deadline.
- **The chat answers from the ledger** (B-028): balances per group over live expenses, and "who owes
  whom" from each group's settle-up plan, the same as Settle Up. It used to net every expense pair
  by pair, deleted expenses and deleted groups included, and its instructions told the model that
  SplitX nets debts across groups, which it doesn't.

**Tests:** the allowance rules (per person, overall, unreachable counter, kill switch, overrides);
the Gemini client (key only in a header, instructions apart from the message, deadline, busy and
empty answers, thinking dropped from the text); and each route: the chat's context is the plan,
past the allowance it answers without calling Gemini, a busy Gemini gets the local answer, and
oversized input is refused before anything is counted or spent.

### D-068 · An account belongs to whoever proves the address, and sign-in can't be guessed at
**2026-09-22** · ✅ written and unit-tested (961 → 987 tests) · email verification waits on an email sender

What the audit (H2 and the low findings) and a reading of `src/lib/auth.ts` found:

| What | Why it mattered |
|---|---|
| GitHub sign-in fell back to `emails[0]`, verified or not | Someone could add another person's address to their GitHub account unverified and sign in as that person |
| Google and GitHub sign-in attached to any account with the same address | Someone who registered first with another person's address kept their password on the account after the real owner signed in with Google |
| Sign-in looked up the address exactly as typed, though registration stores it in lower case | "Alice@…" could not sign in to the account created as "alice@…" |
| Passwords of 6 characters, and no upper bound | bcrypt reads only 72 bytes, so a longer password matched anything sharing its first 72 |
| Reset tokens stored as sent, and used by read-then-update | Whoever could read the table could reset any password; one link could be used twice at once |
| Sign-in, registration and reset limits failed open with the rest | A Redis outage let password guessing run unlimited |
| No limit per account | The per-address limit let a password be guessed from many addresses |

**Decided:**
- **A provider's address counts only if the provider verified it:** Google's `email_verified`, and
  for GitHub the primary address if verified, otherwise another verified one, never an unverified
  one. Without one, the sign-in is refused.
- **A verified identity removes a password nobody proved.** When Google or GitHub signs in to an
  account whose password was set while its address was unverified (every password account, today),
  the password is removed and the address marked verified. The owner keeps signing in with the
  provider, or resets the password by email. A name or photo the person chose is no longer
  overwritten by the provider's.
- Addresses are compared without case everywhere (sign-in, registration, reset) and stored in lower
  case.
- **Passwords are 8 characters to 72 bytes**, one rule (`src/lib/password.ts`) in the browser and on
  the server.
- **Reset links:** 32 random bytes; the database keeps their SHA-256; using one deletes it in the
  same transaction that sets the password, so a link works once.
- **Ten sign-in attempts per account per 15 minutes**, counted in Redis, successful ones included
  (so an automated test should use a fresh account). The per-address limit for sign-in,
  registration and reset **fails closed**: without Redis each server counts on its own
  (`src/lib/rateLimit/local.ts`); everything else still fails open.

**Left, and why:**
- **Email verification at sign-up** needs an email sender that reaches anyone. Resend's
  `onboarding@resend.dev` delivers only to the Resend account's owner, so reset emails reach nobody
  else today either. The user chooses: a verified domain in Resend, or Gmail SMTP.
- **Ending sessions** (after a reset, or "sign out everywhere") needs `User.tokenVersion`, a schema
  change, and schema changes wait for the migration baseline (fix 8). Until then a session lasts
  its 30 days, including one opened with a password that was later removed.
- Registration still answers "already exists": uniform answers come with verification emails.

**Tests:** sign-in by any case, the per-account limit (and signing in when its counter is
unreachable), a verified-only address from each provider, the password removal and what is kept,
password rules at 7/8/72/73 bytes and in emoji, the local limiter's windows, reset tokens stored as
hashes, one use per link, and the same answer for accounts that exist and don't.

### D-069 · Production's money is checked against the rules, read only
**2026-09-22** · ✅ run against production: 13 rules, none broken (`docs/evidence/ledger-audit.json`)

D-063 and D-064 changed what the app allows. What was already in the database was written under the
old rules, so it could break the new ones: shares moved by the old member removal (B-029), balances
of people no longer in a group, settlements in states the transition table doesn't know.

**Decided:** `scripts/ledger-audit.mjs` (`npm run ledger:audit`, `--https` where port 5432 is blocked)
checks 13 rules with SQL and reports how many records break each: shares adding up to their
expense, shares only of current members, nobody gone with a balance, every group netting to zero,
amounts in range, settlements positive, never to oneself, in known states, none waiting in a
deleted group, and one account per address whatever its case.
- **Read only, twice over:** it sends SELECTs only, and each runs in a read-only transaction
  (`Neon-Batch-Read-Only` over HTTPS, `SET TRANSACTION READ ONLY` over the Postgres protocol), so
  the database itself refuses a write.
- **Counts only:** no names, addresses or record IDs, nor the database host; the report can be
  committed. It first says how much it looked at, so a report of zeros can't come from an empty
  database.
- Exit code 1 when a rule is broken, so it can gate a pipeline. Repairs are separate and approved
  one at a time.

**Result, 2026-09-22:** 1 live group, 37 expenses, 62 shares, 0 settlements and 9 accounts; every rule
holds. No production data was affected by the old member removal (B-029 closed).

### D-070 · Email that reaches anyone, addresses that are confirmed, and an auth library without critical holes
**2026-09-22** · ✅ written and unit-tested (987 → 1,006 tests; 1,017 with the later changes) · ✅ live: SMTP settings in `.env` and Vercel; a test through Gmail on 587 was accepted, and production's forgot-password answers as configured

**Email.** SplitX sent mail through Resend's shared `onboarding@resend.dev`, which delivers only to
the Resend account's owner: every reset link for anyone else was reported sent and never arrived.
The code also ignored the error Resend returns (it doesn't throw), so failures were silent.
`src/lib/email.ts` now sends through **SMTP** when `SMTP_HOST`, `SMTP_USER` and `SMTP_PASSWORD` are
set (a Gmail account with an app password reaches any address without owning a domain), or through
Resend only with `EMAIL_FROM` on a verified domain; `onboarding@resend.dev` is never used. With
neither, nothing claims to have sent: "forgot password" answers 503 for every address alike.
`npm run email:test -- <address>` checks the settings with one message and prints only the mail
server's answer.

**Confirming addresses** (the rest of security finding H2; D-068 did provider sign-in):
- While SplitX can send email, a password account signs in only once its address is confirmed.
  Sign-up sends a link; the link is single use, kept as SHA-256 in `VerificationToken`, valid for
  24 hours, and sent at most once every ten minutes per address.
- Only someone who gets the password right learns that the address is unconfirmed (the sign-in page
  shows `email_unverified`), and signing in sends them a fresh link. This is also how existing
  password accounts confirm: nothing to migrate, and Google or GitHub accounts are confirmed already.
- **Sign-up answers the same for a taken address** ("check your email"); the owner gets an email
  saying someone tried. The password is hashed before the lookup so the time taken doesn't tell
  either. Two sign-ups racing with one address end the same way. Without email, a taken address is
  refused as before: a uniform answer needs the email to back it.
- `/api/auth/verify-email` and `/api/auth/resend-verification` are rate limited like sign-in, and
  fail closed the same way (D-068).
- Without an email sender nobody is asked to confirm, since nobody could.

**The auth library.** `npm audit` of the production dependencies found `next-auth` 5.0.0-beta.30 with
`@auth/core` 0.41.0 carrying two **critical** advisories: auth checks that fail *open* on a
configuration error (GHSA-8fpg-xm3f-6cx3) and an address check done before Unicode normalization
(GHSA-7rqj-j65f-68wh); plus a high (GHSA-xmf8-cvqr-rfgj, a malformed Bearer header crashes
`getToken`) and a moderate (GHSA-x445-f3h2-j279). **Upgraded to 5.0.0-beta.32 with `@auth/core`
0.41.3**, which fixes all four.
- `next-auth` names nodemailer as an optional peer, `^7.0.7 || ^8.0.5`, and every 7.x and 8.x release
  carries high advisories fixed only in 9.1. SplitX never uses next-auth's email provider, the only
  thing that loads it through `next-auth`, so an npm `overrides` entry gives `next-auth` the same
  nodemailer 10 the app uses, instead of turning off peer checks for the whole project.
- Fixed within their ranges: `ws` (through Supabase), `uuid` (through Resend), `defu` (through the
  Prisma CLI's config loader), `effect`, `baseline-browser-mapping`. Left: B-030.

Found on the way: the cluster's secret never carried `OPENAI_API_KEY`, so AI receipt scans could not
work on Kubernetes; it now carries it and the SMTP settings.

**Tests:** which sender is chosen (and never `onboarding@resend.dev`), the message SMTP sends (sender,
plain-text copy, link), Resend's returned error, a missing site address; one link per ten minutes,
only its hash stored, single use; sign-up's uniform answer, the notice to the owner, the race, and
the no-email behaviour; sign-in asking for confirmation only after the right password; and the
resend route answering the same for every address.

**Later the same day,** before the first merge:
- **Port 587** is what the alert emails already use through this network, so it is the documented
  one. On any port but 465, SMTP now **requires** STARTTLS before signing in (`requireTLS`). Without
  it, a server, or anyone in between, that didn't offer encryption would receive the app password
  in the clear.
- **Links need the site's address.** The local `.env` never had `NEXTAUTH_URL`, and next-auth on
  Vercel runs without it. So links fall back to `VERCEL_PROJECT_PRODUCTION_URL`, the production
  domain Vercel sets on every deployment, instead of every email failing to send.

### D-071 · Every page says what it may load and use
**2026-09-22** · ✅ written and unit-tested (1,006 → 1,015 tests) · ✅ live since PR #18 (all four headers checked on production) · report-only; enforce after production shows the app itself breaks no rule

Production already sent HSTS (Vercel's, with preload), `nosniff`, `X-Frame-Options: DENY` and a
referrer policy. It sent no Content-Security-Policy, and no Permissions-Policy on pages.

**Decided** (`src/lib/security/contentSecurityPolicy.ts`, sent from `next.config.ts` on every route):
- **A Content-Security-Policy, report-only first.** Only the site itself for scripts, frames, form
  posts and base URLs; no plugins; nobody may frame the site. Requests (`connect-src`) may go only
  to the site, Supabase storage (photos are uploaded straight there) and jsDelivr, where on-device
  receipt reading loads its engine; images also from Google's and GitHub's profile photo hosts.
  Browsers report what it would block to `/api/csp-report`, which counts reports in
  `splitx_csp_violations_total` (by directive and kind of source, a fixed set of labels) and logs at
  most one line every ten seconds, so fake reports can't flood the logs.
- **`'unsafe-inline'` stays for scripts, on purpose.** Next.js writes each page's data as inline
  scripts, so without it every response would need a nonce, and a nonce makes every page render per
  request: the landing and sign-in pages are served prerendered today. React escapes what it renders
  and no page puts user text into raw HTML; the policy's work is everything else, above all that an
  injected script can't send data anywhere the list doesn't name. `'unsafe-eval'` is not allowed;
  `'wasm-unsafe-eval'` is, for the OCR engine's WebAssembly.
- **Permissions-Policy:** camera and microphone for this site only (receipt scanning, voice entry);
  location, payment, USB, serial, HID and Bluetooth for no one.
- `Cross-Origin-Opener-Policy: same-origin` (sign-in uses redirects, not pop-ups), and our own HSTS
  in production for the cluster and CloudFront, where Vercel's isn't there.
- Development gets neither HSTS nor the CSP: it runs over plain HTTP and its tooling uses eval.

**Next:** after the merge, open production's pages and read the browser console, where report-only
violations appear, then switch the header to `Content-Security-Policy`. Self-hosting the OCR engine
(fix 7 of the plan) would remove jsDelivr from the list.

**Tests:** the policy's invariants (no `'unsafe-eval'`; `object-src`, `frame-ancestors`, `base-uri`,
`form-action` and `connect-src` as above), both report formats, labels kept to a fixed set whatever a
report claims, at most 20 reports per request, and the route's counting and size limit.

### D-072 · Schema changes are migrations, proven on the Postgres production runs
**2026-09-22** · ✅ written and tested on a real PostgreSQL 17 (1,015 unit tests, 10 new database tests) · production is baselined when the user runs the "Production database" workflow

**Before.** Production was created and changed with `prisma db push`. Nothing recorded what it held,
no change could be reviewed before it landed, and nothing stopped code that needs a new column from
reaching production before the column. No test ran against a real database: every route test used a
fake Prisma client, which has no constraints, no locks and no isolation levels.

**The baseline.** `prisma/migrations/0_baseline` is the schema production holds today, generated from
`schema.prisma`. Before relying on it, production was compared with it, read only, over Neon's HTTPS
endpoint (this network blocks 5432). The catalog of every table, column (type, nullability, default),
index and constraint in production was compared with the same catalog of a database built from the
baseline: **137 columns, 41 indexes and 44 constraints, no difference.** Production runs PostgreSQL
17.11 and has no `_prisma_migrations` table yet. The workflow checks again, with Prisma's own diff,
before it records anything.

**The first migration** adds the index balance history needs, `AuditLog (entityType, entityId)`. An
index changes no query's result, so it is safe whichever lands first, the code or the index.

**Production migrations** run only from `.github/workflows/production-database.yml`:
- Manual, one run at a time, and every run waits for approval of the `production-database`
  environment, the only place that holds the database's address.
- A report first (what production has, what is pending, and the SQL the pending migrations will run),
  then a run with "apply".
- The first time, production is recorded as holding `0_baseline` only if Prisma's diff between the two
  is empty. Any difference stops the run and prints it.
- After applying, Prisma's diff between production and `schema.prisma` must be empty.
- Only the direct address: a pooled one is refused, because a migration holds an advisory lock that a
  transaction-mode pooler can't keep. The host is masked in the log, and dependencies are installed
  before the address is in any step's environment.
- `scripts/db-migrate.mjs` does the work. It was tested on a local copy of production's shape: the
  report, the baseline and apply, a second report finding nothing to do, a database that differed
  from the baseline (refused, left untouched, the difference printed), and an empty database
  (everything applied).

**How a schema change ships:** the pull request carries the migration; run the workflow on that
branch, report then apply; then merge. Vercel deploys a merge within minutes and the code must find
its columns already there, so **migrations only add**: a new column is optional or has a default, and
nothing the running code reads is dropped or renamed in the same release.

**The cluster** can't run Prisma (D-041), so `scripts/db-schema.mjs` now writes `schema.sql` from the
migrations. Each migration the database doesn't have yet is applied in its own transaction and
recorded in `_prisma_migrations` exactly as Prisma records it. The Job runs it on every deploy, so a
migration added later reaches a cluster whose database already exists. A database built by the old
file is recorded as holding the baseline, instead of failing on tables that already exist.

**CI's new `database` job** runs on `postgres:17.11`, pinned by digest, the version production runs. It
checks that:
- the migrations build an empty database;
- nothing in `schema.prisma` lacks a migration (`migrate diff --from-migrations`; a field added without
  one fails the job with the SQL it needs);
- `schema.sql` builds the same database as `prisma migrate deploy` (identical `pg_dump` and identical
  migration records, checksums included), a second run changes nothing, and `prisma migrate status`
  reads the result as up to date;
- the database tests pass.

The release job now waits for it.

**The database tests** (`tests/database`, 10 of them) refuse to run against anything but a local
database named `*_test`. They cover:
- **Constraints the code relies on:** no share, payment or membership can point at nothing; one
  membership per person per group, and one share per person per expense; no account can be deleted
  while the money history names it, so account deletion will have to anonymise.
- **Amounts:** the largest fits the 32-bit column, one past it is refused unwritten, and sums past
  2^31 come back exact (the AI chat sums spending in SQL).
- **Two actions at once**, each repeated over several rounds:
  - approve and decline of one payment: exactly one happens, and only it is in the history;
  - a double tap on "I have paid";
  - five payments started together against one debt: never more than is owed, and every refusal a
    400 or 409, never a 500. A probe of ten rounds saw one to three accepted and the rest refused as
    conflicts;
  - two edits of one expense: one lands whole, the other is asked to reload, and the shares always
    equal the amount.

**Found by them:** a double tap on "join" let two inserts race past the "already a member?" check, and
the losing tap answered **500 "Failed to join group"** although the person had joined (`[201, 500]`
on the first run). The unique constraint's refusal is now answered as "Already a member", the group
is notified once, and a body that isn't JSON gets a 400.

Everything above was verified before pushing, on a throwaway PostgreSQL 17.9 run from the binaries
already installed, with its own data directory and port (Docker stayed off). It was deleted
afterwards.

**Next:**
- `User.tokenVersion`, the first migration that adds a column, shipped the way described above.
- The cluster's own Postgres stays at 16 for now, because moving it to 17 would strand an existing
  cluster's data directory. The Kind end-to-end runs on GitHub's runners start fresh (phase 7), so
  that is where it moves to 17.

### D-073 · Months in India's time, exports a spreadsheet can't run, one database pool
**2026-09-22** · ✅ written and unit-tested (1,017 → 1,027 tests)

**Months.** Analytics read months off the server's clock, and servers run in UTC (Vercel's do). So a
month began at 05:30 in India: an expense added at 1 a.m. on the 1st was charted in the month
before, and for the first 5½ hours of every month "this month" was empty. Budgets defaulted to the
UTC month the same way.
- `src/lib/indiaTime.ts` counts days and months in IST, which is UTC+5:30 all year, since India
  keeps no daylight saving.
- Analytics now reads the six calendar months it charts, from midnight IST. Before, it read a rolling
  six months, so member totals covered days the chart didn't show. This month's settlements count
  from midnight IST on the 1st.
- The tests run the process in UTC, as on Vercel. This laptop runs in India, where the old code
  passed by accident.

**Budgets** (`/api/budgets`) took anything: bad JSON, fractional or out-of-range amounts, and months
like "October" ended in a 500 or a junk row. The input is now validated. No page calls this API, so it
is on the cleanup list (phase 1c).

**The balance-history CSV.** Titles and names are typed by group members, and a spreadsheet runs any
cell that starts with `=`, `+`, `-` or `@` as a formula, quoted or not. A member could title an
expense `=HYPERLINK(...)` and have it run for whoever exported the group's history.
- Text cells that start like a formula now start with an apostrophe.
- Amounts stay numbers, negative ones included.
- Header values are quoted, so a name with a comma can't start a cell of its own.

The other CSV export (`generateCSV`, `exportAsCSV`) is called by nothing; it goes on the phase 1c
list.

**One database pool per process.** `src/lib/db.ts` kept its client on `globalThis` only outside
production. A production server that evaluates the module twice (a separate bundle or module graph)
would open a second connection pool. The client is now kept there in every environment.

---

## Open problems

| ID | Problem | Why it matters | Status / planned fix |
|---|---|---|---|
| B-001 | Rate limiter vs. load: 50/min per IP, every call to Upstash, no error handling. | k6 and a classroom NAT would see 429s, not load; an Upstash outage became a 500 on every call. | ✅ Resolved — D-022. |
| B-002 | The Compose `redis` service was used by nothing. | A health-checked service nobody uses is theatre. | ✅ Resolved — it is the rate-limit backend (D-022). |
| B-003 | `POST /api/transactions` accepted `receiptUrl` but never saved it. | Receipts attached through the composer were lost. | ✅ Resolved — D-019. |
| B-004 | `POST /api/transactions/from-receipt` had no input validation. | Floats, negatives or strings as amounts. | ✅ Resolved — endpoint removed (D-020). |
| B-005 | Readiness depends on the shared database. | A full DB outage removes every pod from the Service. Accepted for now: nearly every page needs the DB, and 3 failures × 10 s rides out Neon cold starts. | ✅ Resolved 2026-09-16 — D-037. Measured on the cluster: with the database scaled to zero both replicas left the Service within one probe cycle, the ingress answered 503, and no pod was restarted. The dependency is correct; serving errors from pods Kubernetes believes are healthy is the worse option. |
| B-006 | Jenkins admin password is still the leaked one (user no longer knows it; it is in `jenkins/create-job.sh` history). | Jenkins becomes internet-reachable when the webhook tunnel opens. | ✅ Resolved 2026-09-20 — the Compose Jenkins is gone, and with it the image built from `jenkins/Dockerfile.jenkins`. The Jenkins in the cluster has no legacy home directory: its admin user is created by Configuration as Code from a Secret `k8s:up` builds from `.env`, generated on the first run (D-055). The leaked password now unlocks nothing that exists. |
| B-007 | Committed avatars may still be referenced by production profiles. | Removing them could change what real users see. | ✅ Resolved 2026-09-14 — production returned 0; the files are untracked (D-017). |
| B-008 | Jenkinsfile stages are still theatre (`docker images` as "build", `|| echo` after Sonar). Only the secrets were removed in phase 0. It also deploys the Helm chart deleted in D-034. | Examiner-visible, and now pointing at a path that no longer exists. | ✅ Resolved 2026-09-20 — rewritten (D-055). Every stage does something whose failure fails the build: cosign verification, `kubectl apply -k` of the release commit, a rollout wait, a check through the ingress, and an automatic rollback. Proven by a real release and a deliberately broken one (`npm run cd:verify`). |
| B-009 | `DEMO_GUIDE.html`, `AWS_SETUP_GUIDE.md` describe removed or wrong things (Ansible, t3.small, 23 resources). | Misleading docs. | Phase 8. |
| B-010 | Prisma pool size across up to 12 pods is unset. | Connection exhaustion under autoscaling. | ✅ Resolved 2026-09-16 — D-042. `connection_limit=5&pool_timeout=10` is set on the URL the cluster builds, so ten pods use at most 50 connections. |
| B-011 | `/api/metrics` and `/api/health/ready` will be reachable through CloudFront. | Metrics are token-protected, but readiness pings the DB per request. | ✅ Resolved for the cluster 2026-09-16 — D-043. Both paths answer 403 through ingress-nginx; the AWS overlay does the same with an ALB fixed-response rule. CloudFront itself is still phase 7. |
| B-012 | Supabase access policies not reviewed. | Any anon policy on the `receipts` bucket was pure risk once the app stopped writing with the anon key. | ✅ Resolved 2026-09-16 — the user deleted every policy and set the bucket to 10 MB and image types only. Verified: an SVG is refused (HTTP 415) even through a valid signed upload URL. |
| B-013 | `npm test` was 65 lines of source-regex assertions. | CI "passed tests" that exercised no behaviour. | ✅ Resolved — D-018. |
| B-014 | The Supabase project URL in the local `.env` did not resolve. | Storage couldn't be exercised, and uploads on the live site were failing. | ✅ Resolved 2026-09-14 — the free-tier project had been **paused**; the user resumed it and added the secret key to `.env` and Vercel. Verified live (D-027). |
| B-015 | Anonymous preview requests from one network share an IP bucket (60/min). | A classroom behind one NAT would be rate limited as one person during the demo. | ✅ Resolved 2026-09-17 — D-045. Anonymous devices carry a signed identity and are limited individually; their network keeps a ceiling. Classroom test under production limits: students refused went from 1,777 of 1,907 (93%) to 0 of 1,912 |
| B-016 | Queue-time shedding can't see the time a request waits before the proxy runs (D-026). | Accepted requests reached p99 ≈ 2.2–2.5 s at 96 concurrent 2,000-person previews on one process. | ✅ Resolved 2026-09-17 — D-046. ingress-nginx stamps the arrival time, the proxy refuses overdue work and caps accepted work at 8 plans per pod, liveness tolerates a busy pod, and Node keep-alive outlasts nginx. Two pods at 60 req/s: served p95 26 s to 1.2 s, 1,314 errors to 0, restarts 2 to 0 |
| B-017 | Deliberately shed 503s are logged at error level by the access log. | 365 error lines in one load test, all intended. Noise hides real errors. | ✅ Resolved 2026-09-18 — refusals in the proxy are counted, not logged (D-046), and alerting is on metrics that subtract deliberate refusals (SplitXServerErrors, D-052). The rare refusal inside the route still logs at error level; it is visible in the logs dashboard and alerts no one. |
| B-019 | **Anyone could list the `receipts` bucket.** Found 2026-09-14: an anonymous request with the public key listed its contents. | Anyone could enumerate every receipt photo. | ✅ Resolved 2026-09-14 — the user deleted all three policies; anonymous listing now returns nothing (D-027). Later: consider a private bucket with signed read URLs. |
| B-020 | The Docker image's browser code had no Supabase URL or key, so uploads could not work from a container. | Receipt uploads would have failed on Kubernetes. | ✅ Resolved 2026-09-16 — the browser now PUTs to the signed URL alone, with no key and no Supabase client (D-028). |
| B-018 | One profile still carried an avatar that wasn’t a normal storage URL. | Photos kept as `data:` text sit in every API response that includes that user — group members, expense payers, settlement participants. | ✅ Resolved 2026-09-17. The corrected query found **one** `data:` avatar and **no** email-named files (the first query was wrong: the old code replaced `@` with `_`, so `LIKE '%@%'` could never match). It was **828 KB of text** — a 621 KB JPEG — carried in every response that mentioned that user. `scripts/migrate-avatars.mjs --apply --https` uploaded it to `avatars/<id>/`, rewrote the row only while it still held the `data:` value, and confirmed the stored copy is served as `image/jpeg` and **byte-identical** to the original. A backup of the old value was written first. Production now has 0 `data:` avatars. |
| B-021 | The AWS root user still had two active access keys. | Root keys cannot be restricted by any policy. | ✅ Resolved 2026-09-16 — the user deleted both. Root keeps MFA (a security key), the CLI uses `splitx-devops`, and no repository file or GitHub Actions secret holds AWS keys. |
| B-022 | `argocd/`, `jenkins/Jenkinsfile`, `AWS_SETUP_GUIDE.md` and `DEMO_GUIDE.html` still reference the `helm/splitx` chart deleted in D-034, and `argocd/kind-cluster.yml` is a second, stale Kind config. | Anyone following those files sets up something that no longer exists. | 🚧 Narrowed 2026-09-20 — `argocd/` and the old Jenkins files are deleted, and the Jenkinsfile is the one that runs (D-055): GitOps does not return, because Jenkins is the deployer. `AWS_SETUP_GUIDE.md` and `DEMO_GUIDE.html` still describe the deleted chart; phase 8 rewrites the guides. |
| B-023 | metrics-server runs with `--kubelet-insecure-tls` on Kind, because Kind’s kubelets serve metrics with a certificate the cluster CA did not issue. | The flag disables verification of what the autoscaler reads. It is in a values file, not hidden in a script, precisely so it cannot be copied to AWS by accident. | Phase 7: EKS signs kubelet certificates properly — install the add-on without the flag and confirm the HPA still reads CPU. |
| B-024 | In the final saturation run, 155 of 7,442 requests spent over 3 s inside a pod, all 30 to 50 s into the overload, on both pods, with none after. | A transient stall right when a burst arrives is exactly when a classroom notices. | 🚧 Narrowed 2026-09-18 — D-053. Not garbage collection: the stall belongs to freshly started pods at their 1-CPU limit. Without the limit, fresh pods had 0 and 89 requests over 3 s in a pod (175 to 228 with it), the longest 2.9 and 6.3 s, and served 45% more. Left: the remaining cold start; phase 7 measures the ALB slow start for new targets. |
| B-025 | Sign-up, login and password reset are still limited to 10 a minute per address (D-022). | A room asked to register at once from one campus network would be refused after the first ten. The demo page needs no account, so it is not affected. | Before any demo asks people to sign up: count failed logins per account for brute-force protection, and give sign-up the device-plus-network treatment of D-045. |
| B-026 | Jenkins' deploy builds and `cd:verify` read GitHub's deployments without a token, and this network's public address shares GitHub's anonymous allowance (60 an hour) with other devices. | A deploy would fail at its first step whenever someone else on the network had spent the allowance: on 2026-09-21 its hour began eleven minutes before this laptop booted, and it was spent when `cd:verify` ran, which failed 2 of its 15 checks on it. | Open — the user creates a fine-grained token (this repository only, Deployments read and write) and puts it in `.env` as `JENKINS_GITHUB_TOKEN`; `k8s:up` hands it to Jenkins. Both scripts now say when the allowance is spent and until when, instead of a bare 403, and the build log no longer repeats GitHub's message, which names the address. **2026-09-21:** the token is in `.env` and works (5,000 an hour). |
| B-027 | With the cluster running, the 6 GB WSL VM held about 4 GB in memory and all 8 GB of its swap (2026-09-21), about 12 GB against the 4.6 GB the same cluster used the day before. | The control plane crash-looped and the app answered 503. On Windows, the swap file held the SSD at a queue of 100–245 and 61 ms reads, which froze the laptop. Release `7e3509e` (deployment 6572256500, 15:45 UTC) reached no relay and was never deployed: no delivery was logged after 15:30 UTC. | Open. Next time the cluster runs, watch the VM's anonymous, shared and swapped memory from `k8s:up` on (node-exporter already exports all three), find what grew, and fit the local cluster into 6 GB. Then redeliver 6572256500 from GitHub's webhook page and read Jenkins' statuses on GitHub. |
| B-028 | The AI chat builds its own balances: pairwise instead of the group plan, over every expense including deleted ones, in deleted groups too, with ±1 paisa counted as settled. | Its answers to "who owes me?" can disagree with Settle Up, and count expenses that were deleted. | ✅ Resolved 2026-09-22 — D-067. The chat's context is the ledger: balances per group over live expenses, and each group's settle-up plan. |
| B-029 | Removing a member used to re-split their shares among the others (D-063). Groups that had a member removed may hold shares that were moved between people, and former members may still owe or be owed. | Balances in those groups reflect the old re-split, not what people agreed to. | ✅ Checked 2026-09-22 — D-069. `npm run ledger:audit -- --https` read production (1 group, 37 expenses, 62 shares, 0 settlements, 9 accounts) in a read-only transaction: no share of a former member, no former member with a balance, every expense adding up, every group netting to zero. Nothing to repair. |
| B-030 | `npm audit` still reports one high advisory: `deepmerge-ts` below 8 (GHSA-ggr8-5vv4-36mx, stack exhaustion when merging self-referencing objects), through `prisma` → `@prisma/config`. | The Prisma CLI is a development and migration tool; the app's runtime (`@prisma/client`) doesn't use it, and the only objects it merges are our own config. | Accepted 2026-09-22 (D-070). The fix is Prisma 7, a major upgrade with its own changes. Still accepted after the migration baseline (D-072), which was done on Prisma 6: the upgrade is its own change. The CLI stays out of the runtime image. |

## Environment notes (this machine)

- Native PostgreSQL 17 (`postgresql-x64-17`) listens on 5432; another process on
  127.0.0.1:6379. Compose uses 5433/6380 to coexist.
- The user-level npm config uses plain HTTP with an auth token configured. Fix
  with `npm config set registry https://registry.npmjs.org/` and consider
  rotating that npm token.
- 15.7 GB of physical RAM. Docker Desktop runs on WSL 2. The phase 0 plan, `memory=10GB` and
  `swap=8GB` in `%UserProfile%\.wslconfig`, starved Windows, which uses about 9 GB with an editor,
  a browser and this assistant: on 2026-09-21 it had 0.3 GB available and paged 1,600 times a
  second (D-062). `memory=6GB` is set now: it keeps Windows responsive, but the full cluster did
  not fit in it (B-027). The CI stack (SonarQube, Nexus) must not run next to it.
- **Docker Desktop keeps running after its window is closed.** Only **Quit Docker Desktop** from the
  tray icon, `docker desktop stop` or a restart stops it, and with it the VM. Closing the window
  left the whole cluster running in the background on 2026-09-21.
- **Heat (2026-09-21).** One of the laptop's two fans has been removed; this is not a sensor fault.
  The ACPI thermal zone read 81–92 °C at 10–14% CPU with the cluster up, 67 °C with it asleep,
  87–99 °C through the 90 s of a cluster start at 20–40% CPU, and 61–65 °C at 3–5% with Docker
  quit. The i7-13700HX throttles at 100 °C. Windows logged 104 "processor speed limited by system
  firmware" events (Kernel-Processor-Power 37) in two days, a blue screen on 2026-09-20 (0x3B,
  SYSTEM_SERVICE_EXCEPTION, in the graphics kernel `dxgkrnl.sys`, NVIDIA driver 551.76), and a
  forced power-off that evening. Until the fan is replaced: no load tests, no rollback rehearsals,
  and the cluster runs only while it is being used.
- An external monitor on DisplayPort is driven by the NVIDIA GPU, so that GPU never sleeps while it
  is connected.
- **This network shares its public address.** On 2026-09-21 GitHub's anonymous API allowance (60 an
  hour per address) was counted in an hour that began at 14:22 UTC, eleven minutes before this
  laptop booted, so something else behind the same address started it; it was spent within that hour.
  Anything here that reads GitHub's API without a token fails once others have used it (B-026).
- Installed: kind 0.31.0, kubectl 1.34.1 (Kustomize 5.7.1 built in), Helm 4.1.4,
  Terraform 1.14.9, AWS CLI 2.34, Docker Buildx 0.33. Not installed: Trivy, k6,
  hadolint. Phases 2 and 4 run their official container images instead.
- Image baseline before phase 2: `splitx:local` is 430 MB, and `splitx_app_info`
  reports `git_sha="unknown"` (no build provenance yet).
- Loki now runs in the cluster and labels every line with namespace, pod, container,
  app, node and, for the application, level; request IDs are structured metadata
  (D-052). Compose no longer runs Loki, so host port 3100 is free again.
- After the host sleeps or restarts, the Docker VM clock can run ahead of Windows (53 s measured on 2026-09-17), which is why `kubectl` shows event ages as `<invalid>`. Everything in the cluster shares the VM clock, so the rate limiter and token expiry are unaffected. On 2026-09-18 the VM clock also ran 2 to 6% slow against Windows and was stepped about 0.8 s at a time, which set off three false alerts (D-052).
- **Outbound TCP 5432 is blocked on this machine’s network** (443 works; DNS resolves). Prisma cannot reach Neon from here, which is why `.env` points at the Compose Postgres. Tools that must reach Neon use its SQL-over-HTTPS endpoint instead (`scripts/migrate-avatars.mjs --https`). Not an issue for Vercel, GitHub Actions or EKS.
- The user-level npm registry is HTTPS now.
