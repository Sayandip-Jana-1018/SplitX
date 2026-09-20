> SplitX — Smart Expense Splitting & Settlement
 # SplitX ~ Smart Expense Splitting & Settlement (MOBILE FIRST)

> A production-grade, full-stack expense-splitting web app built with **Next.js 16**, **Prisma**, **PostgreSQL (Neon)**, and **NextAuth v5**. Features glassmorphic UI, AI-powered receipt scanning (Tesseract OCR + OpenAI Vision), Gemini AI chat assistant, real-time group chat with avatars, debt simplification with transparent calculation breakdowns, Balance Journey history timelines, CSV/print exports, real-time analytics, smart notifications, colorful themed navigation, backend security hardening, and 12 color themes.

---

### Screenshots

<div align="center">
  <img src="https://raw.githubusercontent.com/Sayandip-Jana-1018/SplitX/main/public/screenshots/1.png" alt="SplitX landing page" width="180" />
  <img src="https://raw.githubusercontent.com/Sayandip-Jana-1018/SplitX/main/public/screenshots/2.png" alt="SplitX dashboard" width="180" />
  <img src="https://raw.githubusercontent.com/Sayandip-Jana-1018/SplitX/main/public/screenshots/3.png" alt="SplitX dark mode activity" width="180" />
</div>

<div align="center">
  <img src="https://raw.githubusercontent.com/Sayandip-Jana-1018/SplitX/main/public/screenshots/4.png" alt="SplitX add expense flow" width="180" />
  <img src="https://raw.githubusercontent.com/Sayandip-Jana-1018/SplitX/main/public/screenshots/5.png" alt="SplitX analytics page" width="180" />
  <img src="https://raw.githubusercontent.com/Sayandip-Jana-1018/SplitX/main/public/screenshots/6.png" alt="SplitX dark analytics view" width="180" />
</div>

<div align="center">
  <img src="https://raw.githubusercontent.com/Sayandip-Jana-1018/SplitX/main/public/screenshots/7.png" alt="SplitX settings page" width="180" />
  <img src="https://raw.githubusercontent.com/Sayandip-Jana-1018/SplitX/main/public/screenshots/8.png" alt="SplitX settlements graph" width="180" />
  <img src="https://raw.githubusercontent.com/Sayandip-Jana-1018/SplitX/main/public/screenshots/9.png" alt="SplitX UPI payment flow" width="180" />
</div>

<div align="center">
  <img src="https://raw.githubusercontent.com/Sayandip-Jana-1018/SplitX/main/public/screenshots/10.png" alt="SplitX receipt scan result" width="180" />
  <img src="https://raw.githubusercontent.com/Sayandip-Jana-1018/SplitX/main/public/screenshots/11.png" alt="SplitX notes and whiteboard" width="180" />
</div>

### Live Experience

- **Live Project:** [splitsj.vercel.app](https://splitsj.vercel.app)
- **GitHub Repository:** [Sayandip-Jana-1018/SplitX](https://github.com/Sayandip-Jana-1018/SplitX)
- **Hero Video Asset:** [`public/video.mp4`](./public/video.mp4)

### Showcase Highlights

- **Dashboard:** centered balance overview, recent activity, pending settlements, quick actions, and guided Balance Journey entry
- **Groups:** shared-space management with invite flows, member avatars, and group-level spending context
- **Settlements:** premium transfer graph, pay-via-UPI actions, pairwise clarity, and simplified debt routing
- **Analytics:** real per-group monthly trend, category breakdown, and "who paid in this group" horizontal bars
- **Settings:** profile customization, avatar upload, theming, PWA install, and export controls

> For the best visual preview, open the live site on desktop and mobile. The repo currently ships the brand/video assets directly, while runtime screenshots are best viewed on the deployed app.

---

## 🚀 DevOps Platform

SplitX is being rebuilt into a production platform where every DevOps tool does
verifiable work — no pipeline stage that only prints success. Every decision,
the alternatives rejected, and the evidence behind each claim is recorded in
**[docs/DECISIONS.md](docs/DECISIONS.md)**.

### Real and verified today

| Area | What it does | Proof |
|---|---|---|
| **Prometheus metrics** | HTTP rate, errors and latency per route pattern with the true status code; proxy (auth + rate-limit) time; business events — expenses, settlements, AI replies, receipt scans, voice parses | `npm run verify:metrics` — 15 checks; each response counted exactly once |
| **Health probes** | `/api/health/live` (no dependencies) and `/api/health/ready` (database, 2 s timeout) | Readiness caught a real database misconfiguration on its first run |
| **Secret scanning** | gitleaks on every commit (pre-commit hook) and over full history in CI | Working tree and history both scan clean |
| **Docker Compose** | App, Postgres and Redis for local development, and SonarQube and Nexus behind the `ci` profile; admin ports on 127.0.0.1 only; required secrets; the app images pinned by digest (the ci profile only by version); memory limits that fit the 10 GB Docker VM. Monitoring and Jenkins moved to the cluster (D-052, D-055) | The app container reports healthy against its own Postgres and Redis |
| **AWS identity** | Least-privilege IAM user for all automation; IAM actions limited to `splitx-*` names; root user protected by a security key (its two old access keys are being deleted) | `iam:ListUsers` is denied — [terraform/bootstrap](terraform/bootstrap/README.md) |
| **Terraform** | VPC, ECR and EKS modules; subnet discovery tags match the cluster; provider lock file committed | `terraform validate` and `terraform plan` |
| **Rate limiting** | Sliding window in Redis (one atomic Lua script), keyed by the verified signed-in user, a signed anonymous device identity, or the client IP; a device is also held to a ceiling for its whole network, so identities cannot be minted into extra capacity; fails open with a metric when Redis is down | 200 concurrent requests against a limit of 25 admit exactly 25. 80 phones behind one address under production limits: 0 of 1,912 plans refused, where per-address limiting refused 93% — [load tests](docs/evidence/load-tests.md) |
| **Request tracing** | One request ID from the proxy to the route's log lines, and into the ingress access log (JSON, the ID taken from the app's response so a client cannot choose it); JSON logs with pod and version | `npm run k8s:verify` makes a request and finds its `X-Request-Id` in Loki twice: in the ingress line, and in the line of the pod the ingress says it sent it to |
| **Load shedding** | `POST /api/settlements/preview` runs the real settle-up planner, pure CPU. ingress-nginx stamps each request's arrival; the proxy refuses a preview that has waited past a second, and admits at most 8 unfinished plans per pod, so an overloaded pod answers fast instead of queueing until its probes fail | Two pods held at 60 plans a second of 2,000 people: served p95 26 s → 1.2 s, 1,314 errors → 0, restarts 2 → 0, every liveness check answered — each fix measured on its own in [D-046](docs/DECISIONS.md). Without a CPU limit, the same pods serve 45% more, and fresh pods no longer stall for up to 21 s — [D-053](docs/DECISIONS.md) |
| **Container image** | Node 24 on Alpine, pinned by digest; runtime stage is Alpine plus the `node` binary — no npm, yarn or build tools; runs as a non-root user; carries its commit as OCI labels and in `splitx_app_info` | Built and measured against a deliberately naive image: 1091 MB → 81 MB to download, 4139 → 0 vulnerabilities — [docs/evidence/image-comparison.md](docs/evidence/image-comparison.md) |
| **Kubernetes** | Three-node cluster (Kind locally, EKS for the demo) on the same pinned version; one Kustomize base with local, AWS and load-test overlays; in-cluster Postgres built from the Prisma schema; pods non-root on a read-only filesystem, enforced by the namespace; a CPU request but no CPU limit, on measurement (D-053); default-deny networking, with kindnet given the resources to enforce it (Kind's defaults starved it, D-050); config changes and new builds always roll the pods | `npm run k8s:verify` — 36 live checks, including a database outage, a release under traffic, fresh connections from every pod and the policy engine that judges them, and the monitoring end to end: [docs/evidence/kubernetes.md](docs/evidence/kubernetes.md) |
| **Zero-downtime releases** | `maxSurge: 1, maxUnavailable: 0` with a `preStop` delay so the ingress stops routing before the server shuts down | 3,090 requests during a full pod replacement: 0 lost, 0 non-200 |
| **Autoscaling** | HPA on CPU (60% of a 250m request), 2 → 10 pods, fed by metrics-server from a pinned chart; scales up without a stabilisation window, down after five minutes at one pod a minute | k6 staircase of 1,000-person plans at 10, 30, 60 and 100 a second: 2 → 3 → 7 → 10 pods, all 30,029 plans served with p95 54 ms, no restarts, back to 2 pods 12 minutes after the load stopped — [D-051](docs/DECISIONS.md) |
| **Monitoring** | On the cluster, all pinned: kube-prometheus-stack (Prometheus Operator, Prometheus, Alertmanager, Grafana, kube-state-metrics, node-exporter), Loki, and Grafana Alloy reading pod logs through the Kubernetes API. The app ships its own ServiceMonitor and alert rules; alerts email through Gmail from a routing tree in `monitoring/alertmanager`; dashboards are JSON in `monitoring/dashboards`, read-only in Grafana | `npm run test:alerts`: promtool proves every SplitX alert fires when it should and stays silent through load shedding, reboots and quiet nights, and seven deliberate breakages of the rules were each caught. A real outage (Redis stopped) emailed the alert 199 s later and the resolution 5 minutes after the fix. `npm run k8s:verify`: every target up, every dashboard query runs on metrics that exist, every email accepted |
| **Delivery** | A merge to main becomes a release: GitHub Actions builds the image once, scans it (Trivy), signs it keyless (cosign) and publishes it to ghcr.io by commit, then announces it as a GitHub deployment. GitHub’s signed webhook reaches Jenkins in the cluster through a smee.io relay; Jenkins verifies the webhook and the image signature, applies the release commit’s own manifests by digest, checks the rollout through the ingress, and rolls back anything that does not come up | `npm run cd:verify` — 13 live checks: [docs/evidence/delivery.md](docs/evidence/delivery.md). A signed release deployed in 177 s; a release built to fail was rolled back with 717 of 717 requests still answered 200 |
| **Jenkins** | In the cluster, not on the laptop: a pinned chart in a `restricted` namespace, every plugin and dependency pinned, the whole configuration (realm, credentials, job, webhook gate) as Configuration as Code. It builds nothing, so no build needs root or a Docker socket; deploy builds run as an account that may change the application and nothing else | `npm run cd:verify` proves the gate refuses unsigned, wrongly signed and altered deliveries, and that the deploy account cannot read a Secret or touch another namespace |
| **Helm** | Installs the components we did not write — ingress-nginx, metrics-server, kube-prometheus-stack, Loki and Alloy — pinned by chart version in `helm/platform/charts.json`, each with its own values file, into namespaces created with their Pod Security level first | `helm list -A` on the cluster |
| **Load tests** | k6 2.2.0 in its pinned container: a classroom under production limits, a held overload on two pods, and a staircase that drives the autoscaler; a runner applies the setup each test declares, refuses to measure on battery power, and samples the cluster while it runs | Raw results committed in `docs/evidence/load/`, rendered as [docs/evidence/load-tests.md](docs/evidence/load-tests.md) |
| **Demo page** | `/scale`: public, built for phones — plan a trip for up to 2,000 people and see which pod answered; "keep planning" is paced and jittered so a whole room cannot turn it into its own load test | Checked in a browser at desktop and phone width; pacing covered by unit tests |
| **Tests** | 768 unit tests (property-based, mutation-checked), 14 integration tests against a real Redis | CI jobs `verify` and `integration` |
| **Commit standards** | Husky + Commitlint enforce Conventional Commits | Git history |

### Being rebuilt, phase by phase

| Phase | Scope |
|---|---|
| ✅ 1 | Backend: settlement planner and preview API, rate limiter, request tracing, signed storage uploads, real tests — [D-018 to D-027](docs/DECISIONS.md) |
| ✅ 2 | One image for every environment, measured against a naive build — [D-028 to D-031](docs/DECISIONS.md) |
| ✅ 3 | Kubernetes: Kind cluster, Kustomize base and overlays, probes and network policy tested by breaking things — [D-033 to D-043](docs/DECISIONS.md) |
| ✅ 4 | k6 against the cluster: autoscaling driven by real traffic, HPA tuning, the classroom-NAT question, overload behaviour — [D-044 to D-051](docs/DECISIONS.md) |
| ✅ 5 | Prometheus, Alertmanager, Grafana and Loki on the cluster; alert rules unit-tested and proven by a real outage by email; dashboards as code; logs traced by request ID; B-024 traced to the CPU limit with them — [D-052, D-053](docs/DECISIONS.md) |
| ✅ 6 | GitHub Actions releases (build once, scan, sign); Jenkins in the cluster deploys signed releases and rolls back what does not come up; GitHub deployments and webhooks — [D-054 to D-057](docs/DECISIONS.md) |
| 7 | Terraform: IRSA, EKS add-ons, Cluster Autoscaler, CloudFront with S3 + ALB origins |

---

## 💻 Local + CI Workflow

1. Copy `.env.example` to `.env`. Compose refuses to start without `POSTGRES_PASSWORD`, `REDIS_PASSWORD` and `METRICS_TOKEN`; the cluster (step 8) also needs `GF_ADMIN_PASSWORD` for Grafana, and emails alerts once `ALERT_SMTP_USERNAME`, `ALERT_SMTP_PASSWORD` (a Google App Password) and `ALERT_EMAIL_TO` are set.
2. Start what you need:
   - App, Postgres and Redis: `docker compose up -d`
   - CI tools: `docker compose --profile ci up -d` → SonarQube `127.0.0.1:9000`, Nexus `127.0.0.1:8081`. Jenkins now runs in the cluster (step 8), at http://jenkins.localhost
   - Metrics, logs and alerts run in the cluster (step 8), not in Compose.
3. Host tools reach the Compose Postgres on `localhost:5433` and Redis on `localhost:6380` (chosen so a native Postgres/Redis on the default ports can't shadow them).
4. Test: `npm test` (unit tests and hardening checks), `npm run test:alerts` (alert rules, see step 8). The integration tests need a real Redis:
   `REDIS_URL=redis://:<REDIS_PASSWORD>@127.0.0.1:6380/15 npm run test:integration`.
5. Prove metrics are live: `npm run verify:metrics` (point it at a single instance).
6. Measure the load target: `node --env-file=.env scripts/load-preview.mjs <baseUrl> --sizes 100,500,1000,2000` for CPU per request, or `--members 1000 --steps 1,4,16,64` for behaviour under load (raise `RATE_LIMIT_PREVIEW_PER_MINUTE` on that instance first).
7. Build the image with its commit baked in: `npm run image:build` (tags `splitx:<sha>` and `splitx:local`). `npm run image:report` rebuilds it next to the naive image and rewrites the comparison; `./scripts/scan-image.sh splitx:local` runs Trivy and fails on fixable HIGH/CRITICAL findings.
8. Run it on Kubernetes: `npm run k8s:up` creates the three-node Kind cluster, installs the pinned platform charts, loads the image into the nodes, builds the Secrets from `.env` and applies `k8s/overlays/local` and the dashboards. The app is then on <http://localhost/>, and Grafana on <http://grafana.localhost/> (user `admin`, password `GF_ADMIN_PASSWORD`), with the SplitX Service and Logs dashboards.
   - `npm run k8s:verify` runs the evidence pass — it takes the database away, replaces every pod under load, and checks the monitoring end to end, so expect it to take about four minutes.
   - `npm run cd:verify` checks the delivery path: what Jenkins refuses, what the relay carries, what the deploy account may do, and that the running pods are the image GitHub Actions signed. `npm run cd:verify -- --rollback` also deploys a release built to fail and measures what visitors saw while it was rolled back.
   - `npm run test:alerts` unit-tests the alert rules with promtool and checks the Alertmanager configuration with amtool, in their pinned containers; no cluster needed.
   - `npm run k8s:render` prints the AWS overlay; `npm run db:schema` regenerates the SQL the in-cluster database is built from; `npm run k8s:down` deletes the cluster.
   - Load tests: `node scripts/load-run.mjs classroom|saturation|staircase --label <name>` applies the overlay the test needs, runs k6 in Docker, watches the autoscaler, restores the local overlay and records the result. Nothing else should use the laptop's CPU while one runs.
9. Scan for secrets before pushing: `npm run scan:secrets` (the pre-commit hook scans staged changes automatically).
10. CI (`.github/workflows/ci.yml`) type-checks, tests, lints and builds; runs the integration tests against a Redis service container; validates every Kustomize overlay (local, AWS and the two load-test setups) against the Kubernetes 1.35 schemas and fails if the committed SQL has drifted from the Prisma schema; and scans every commit for secrets. On main, and only after all of that passes, the `release` job builds the image once, scans it with Trivy, signs it with cosign (keyless, so there is no key to leak), publishes it to `ghcr.io/sayandip-jana-1018/splitx:<commit>`, and creates the GitHub deployment Jenkins acts on (D-054).

Secrets never live in the repository: local values go in `.env`, CI values in GitHub/Jenkins credentials, cluster values in Kubernetes Secrets.

## 🏗️ Architecture Overview

```mermaid
graph TB
    subgraph Client["🖥️ Frontend — Next.js 16 App Router"]
        Landing["Landing Page"]
        Auth["Auth Pages<br/>(Login / Register)"]
        Dashboard["Dashboard"]
        Groups["Groups & Group Detail"]
        Transactions["Transactions<br/>(List / Timeline / New / Scan / Receipts)"]
        Settlements["Settlements"]
        Analytics["Analytics"]
        Settings["Settings"]
        AdminHealth["Admin Health Dashboard"]
    end

    subgraph Components["🧩 Component Library"]
        UI["UI Components<br/>(Card, Button, Avatar, Modal, Toast,<br/>AmountPad, Confetti, GlobalSearch,<br/>PullToRefresh, Skeleton, Icons, EmptyState)"]
        Features["Feature Components<br/>(OnboardingTour, ThemeSelector,<br/>ClipboardBanner, NotificationBanner,<br/>NotificationPanel, AIChatPanel,<br/>SplitSelector, GroupInvite,<br/>SettlementGraph, SplitByItems)"]
        Charts["Charts<br/>(SpendingCharts via Recharts)"]
    end

    subgraph Hooks["🪝 Custom Hooks"]
        H1["useTheme"]
        H2["useHaptics"]
        H3["useAnimatedNumber"]
        H4["usePullToRefresh"]
        H5["useClipboardPaste"]
        H6["useCurrentUser"]
    end

    subgraph API["🔌 API Routes — Next.js Route Handlers"]
        AuthAPI["POST /api/auth/*<br/>POST /api/register"]
        MeAPI["GET /api/me<br/>GET /api/me/avatar"]
        GroupsAPI["GET/POST /api/groups<br/>GET/PUT /api/groups/:id<br/>GET /api/groups/:id/balances<br/>GET /api/groups/:id/balance-history<br/>POST /api/groups/join"]
        TxnAPI["GET/POST /api/transactions<br/>PUT/DELETE /api/transactions/:id"]
        SettleAPI["GET/POST /api/settlements"]
        TripsAPI["GET/POST /api/trips"]
        SearchAPI["GET /api/search"]
        NotifAPI["GET/PATCH /api/notifications"]
        BudgetAPI["GET/POST /api/budgets"]
        AnalyticsAPI["GET /api/analytics"]
        AIChatAPI["POST /api/ai/chat"]
        AIVoiceAPI["POST /api/ai/parse-voice"]
        HealthAPI["GET /api/admin/health"]
    end

    subgraph Backend["⚙️ Backend Services"]
        PrismaORM["Prisma ORM"]
        AuthLib["NextAuth v5"]
        Parser["Transaction Parser<br/>(OCR + regex + voice)"]
        SettleLib["Settlement Engine<br/>(Greedy + Optimized)"]
        NotifLib["Notification Engine"]
        AuditLib["Audit Logger"]
        RateLimit["Rate Limiter"]
        Export["CSV/JSON Export + Print Views"]
        UPI["UPI Deep-link Generator"]
        Validators["Zod Validators"]
        FeatureFlags["Feature Flags"]
    end

    subgraph DB["🗄️ Database — PostgreSQL (Neon)"]
        Users["Users"]
        GroupsDB["Groups"]
        Members["GroupMembers"]
        Trips["Trips"]
        TransDB["Transactions"]
        Splits["SplitItems"]
        SettleDB["Settlements"]
        NotifDB["Notifications"]
        BudgetDB["Budgets"]
        AuditDB["AuditLogs"]
        ChatDB["ChatMessages"]
    end

    Client --> Components
    Client --> Hooks
    Client --> API
    API --> Backend
    Backend --> PrismaORM
    PrismaORM --> DB
```

---

## 🗃️ Database Schema (Entity-Relationship)

```mermaid
erDiagram
    User ||--o{ Account : has
    User ||--o{ Session : has
    User ||--o{ Group : owns
    User ||--o{ GroupMember : joins
    User ||--o{ Transaction : pays
    User ||--o{ SplitItem : owes
    User ||--o{ Settlement : "settles from"
    User ||--o{ Settlement : "settles to"
    User ||--o{ Notification : receives
    User ||--o{ Budget : sets
    User ||--o{ AuditLog : generates
    User ||--o{ ChatMessage : sends

    Group ||--o{ GroupMember : contains
    Group ||--o{ Trip : has

    Trip ||--o{ Transaction : contains
    Trip ||--o{ Settlement : tracks

    Transaction ||--o{ SplitItem : "split into"

    User {
        string id PK
        string name
        string email UK
        string password
        string phone
        string upiId
        string image
    }

    Group {
        string id PK
        string name
        string emoji
        string inviteCode UK
        string ownerId FK
        datetime deletedAt "soft delete"
    }

    Trip {
        string id PK
        string groupId FK
        string title
        datetime startDate
        datetime endDate
        string currency
        boolean isActive
    }

    Transaction {
        string id PK
        string tripId FK
        string payerId FK
        long amount "in paise"
        string title
        string category
        string method
        string splitType
        string receiptUrl
        datetime deletedAt "soft delete"
    }

    SplitItem {
        string id PK
        string transactionId FK
        string userId FK
        long amount "in paise"
    }

    Settlement {
        string id PK
        string tripId FK
        string fromId FK
        string toId FK
        long amount "in paise"
        string status
        string method
        datetime deletedAt "soft delete"
    }

    Notification {
        string id PK
        string userId FK
        string type "expense | settlement | group | reminder"
        string title
        string message
        boolean read
        string link
    }

    Budget {
        string id PK
        string userId FK
        string category
        long amount "in paise"
        int month
        int year
    }

    AuditLog {
        string id PK
        string userId FK
        string action "create | update | delete"
        string entityType
        string entityId
        json details
    }

    ChatMessage {
        string id PK
        string userId FK
        string role "user | assistant"
        string content
    }
```

---

## ✨ Features

### Core Functionality
| Feature | Description |
|---|---|
| **Expense Tracking** | Create, edit, soft-delete expenses with categories, payment methods, and receipt URLs |
| **Group Management** | Create groups, invite via link/code, manage members with admin roles |
| **Group Deletion** | Owner-only soft delete with atomic cascade — soft-deletes all transactions, cancels pending settlements, notifies all members |
| **Member Removal** | Owner/admin removes member → equal splits auto-recalculated, orphaned SplitItems cleaned, all members notified |
| **Trip Scoping** | Organize expenses within trips per group with date ranges and currency |
| **Split Types** | Equal, percentage, custom, and item-based splitting — backend validates split sums equal total and all user IDs are group members |
| **Settlements** | Track who owes whom, centered card layout with "Pay via UPI" and subtle "Mark Settled" text link for cash/offline payments |
| **Settlement Transparency** | Per-group info tooltips explain simplified transfers; global view has expandable per-group breakdown showing how each group contributes to pairwise debts |
| **Balance Journey** | Group-level running balance timeline for the current user with before/delta/after values, route-change explanations, filters, CSV export, and print-to-PDF support |
| **Settlement Security** | Self-settlement block, 60s duplicate check (pending + initiated + completed), sender + recipient membership verification, **over-settlement guard** (rejects amounts exceeding actual debt with clear error), soft-delete filters |
| **UPI Payment Notifications** | All group members notified on UPI payment — receiver gets ✅, others get 💸 |
| **Transaction Edit Notifications** | All group members notified when any expense is edited (✏️) |
| **Debt Simplification** | Dual algorithm: greedy netting + optimized exact-match pruning (auto-picks fewer transfers) |
| **Per-Group Settlement Graphs** | Swipeable carousel with per-group settlement visualization, subtle animated money-flow routes, and a premium global pairwise overview |
| **Analytics Dashboard** | API-backed monthly trends, category breakdown, budget vs actual comparison, and smart insights |
| **Budget Tracking** | Set monthly budgets per category, compare against actual spending |
| **CSV/JSON Export** | Export transaction data, account data, and balance-history reports for external use |
| **Read-Only Split Details** | All group members can open the transaction pencil panel to inspect equal and custom split breakdowns without expanding edit permissions |

### AI & Smart Features
| Feature | Description |
|---|---|
| **🤖 AI Chat Assistant** | Gemini-powered conversational assistant — ask about spending, debts, groups in natural language |
| **🎙️ AI Voice Input** | Talk naturally to add expenses (e.g., "I paid 500 for pizza for Sneh and Ankit at Domino's"). Extracts amount, title, merchant, category, and assigns the correct payer/participants instantly. |
| **Receipt Scanner (OCR)** | Dual-mode scanner: **Basic** (Tesseract.js, on-device) and **Advanced** (OpenAI Vision API, cloud-based with itemized receipt parsing) |
| **Advanced Receipt AI** | GPT-4o-mini Vision extracts merchant, date, individual items with quantities, taxes, subtotal, total, and auto-categorizes |
| **Smart Receipt Split** | Interactive itemized splitting: scan a receipt, then drag/tap to assign items to specific members with auto-calculated taxes |
| **Settlement Chat Messages** | Auto-post payment messages in group chat when settlements are completed, with green accent styling |
| **Scan Mode Toggle** | Premium pill-style toggle (⚡ Basic / ✨ AI Scan) with mode description and dynamic privacy notes |
| **Live Camera Capture** | getUserMedia viewfinder with real-time scan guide overlay |
| **Group Chat** | Real-time group messaging with sender avatars, date separators, payment reminders, and system messages |
| **Chat Avatars** | Profile photos displayed for all messages — both own (right side) and others (left side) |
| **Clipboard Paste** | Auto-detect UPI transaction text from clipboard |
| **Transaction Parser** | Regex engine parses UPI/bank SMS into structured data |
| **Smart Notifications** | Real-time notification panel with type-based icons, unread badges, mark-all-read, 30s auto-polling — sender/recipient must share a group (anti-spam) |
| **Smart Insights** | AI-generated spending insights: overspend alerts, savings detection, trend change analysis |
| **Global Search** | Search across transactions, groups, and members |
| **Expense Drafts & Impact Preview** | New-expense form autosaves drafts locally, warns about likely duplicates, and previews who will owe or be owed more before submit |

### Premium UI/UX
| Feature | Description |
|---|---|
| **Glassmorphism Design** | Frosted-glass cards with blur, saturation, and gradient overlays |
| **Colorful Bottom Navigation** | Each nav icon (Home, Groups, History, Analytics, Activity, Settle) has a distinct vibrant color with active/inactive states |
| **Enhanced Nav Blur** | 60px backdrop-filter blur with 96% opacity + gradient fade mask for seamless content transition |
| **12 Color Themes** | Rose, Ocean, Emerald, Violet, Amber, Slate, Coral, Teal, Indigo, Lime, Fuchsia, Cyan |
| **Dark / Light Mode** | System-aware with manual toggle; theme saved to localStorage |
| **Editorial Typography** | Playfair Display is used across the product for headings, UI copy, pricing, and navigation for a consistent premium feel in light and dark mode |
| **Animated Numbers** | Counting animations on dashboard stats |
| **Pull to Refresh** | Touch gesture with animated gradient spinner |
| **Haptic Feedback** | Vibration API integration on buttons, navigation, and actions |
| **Activity Timeline** | Grouped-by-day vertical timeline view with staggered animations |
| **Confetti Celebration** | Canvas particle animation when all debts are settled |
| **Onboarding Tour** | 9-step spotlight walkthrough for new users |
| **Skeleton Loading** | Premium shimmer loading states across all pages |
| **Offline Indicator** | Detects network loss and shows a banner |
| **Empty States** | Animated empty-state illustrations with contextual CTAs |
| **Amount Pad** | GPay-style digit-by-digit number pad bottom sheet |
| **Receipt Gallery** | Browse scanned receipt thumbnails in a 2-column grid with member filter and full-size overlay |
| **Group Receipt Gallery** | Per-group receipt gallery with date-grouped card layout, payer avatars, and lightbox view |
| **Landing Story Hero** | Hero section uses a polished brand video from `public/video.mp4`, framed in a cinematic glass stage before the supporting copy and CTAs |
| **QR Code Invites** | Generate QR codes for group invitations |
| **Centered Split UI** | Split-among member avatars center-aligned with clean multi-line wrapping |

### System & Admin
| Feature | Description |
|---|---|
| **System Health Dashboard** | Real-time service status, DB latency, data counts, server uptime |
| **Audit Logging** | Track transaction, settlement, group, and member mutations with entity details for explainability and safer debugging |
| **Feature Flags** | Toggle features on/off without code changes |
| **Rate Limiting** | Sliding window in Redis, shared by every pod: 10/min per IP for login, registration and password reset; 60/min for the settlement preview; 120/min per signed-in user for the rest of the API. Fails open (and counts it) if Redis is unavailable |
| **Security Headers** | HSTS, X-Frame-Options DENY, X-Content-Type-Options, Permissions-Policy (no camera/mic/geo), Referrer-Policy |
| **Soft Deletes** | All destructive operations (group delete, transaction delete, settlement cancel) use soft deletes with `deletedAt` guards on all queries including DELETE endpoints |
| **Over-Settlement Guard** | Server-side pairwise debt calculation prevents settling more than what's owed; graceful degradation on calculation failure |
| **Permission Model** | Delete group = owner only, remove member = owner/admin only, delete/edit transaction = payer or group owner only, view split details = any visible group member |
| **Input Validation** | Zod schemas on all mutations including notification POST; custom splits validated (sum = total, user IDs ∈ group members); settlement recipient must be group member |
| **Anti-Spam** | Notification POST requires sender & recipient share ≥1 group; duplicate settlement check covers pending/initiated/completed within 60s |
| **Performance Indexes** | Composite DB indexes on `Settlement(tripId, status)` and `Notification(userId, read)` for optimized queries |

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 16 (App Router, React 19, Server Components) |
| **Language** | TypeScript 5 |
| **Styling** | CSS Modules + CSS Custom Properties (design tokens) |
| **Animations** | Framer Motion 12 |
| **Icons** | Lucide React |
| **Charts** | Recharts 3 |
| **OCR** | Tesseract.js 7 |
| **Vision AI** | OpenAI GPT-4o-mini (Vision) |
| **QR Codes** | qrcode.react |
| **AI Text/Chat** | Google Gemini 2.0 Flash (with smart local fallback) |
| **Speech-to-Text** | Web Speech API (SpeechRecognition) |
| **Auth** | NextAuth v5 (beta-30) with credentials + Google + GitHub providers |
| **ORM** | Prisma 6 |
| **Database** | PostgreSQL on Neon |
| **Validation** | Zod 4 |
| **Compiler** | React Compiler (babel-plugin-react-compiler) |

---

## 📁 Project Structure

```
src/
├── app/
│   ├── (app)/                    # Authenticated app shell
│   │   ├── layout.tsx            # Sidebar, header, bottom nav, FAB, AI chat
│   │   ├── dashboard/            # Home — stats, balance hero, quick actions
│   │   ├── history/              # App-level Balance Journey entry and group chooser
│   │   ├── groups/               # Group list & group detail (balances, members, activity, journey)
│   │   ├── transactions/         # List/timeline view, new, scan, receipts
│   │   ├── settlements/          # Settlement tracker with status management
│   │   ├── analytics/            # Spending charts & breakdowns
│   │   ├── settings/             # Profile, theme, account settings
│   │   └── admin/health/         # System health dashboard
│   ├── (auth)/                   # Login & register pages
│   ├── api/                      # Next.js API route handlers
│   │   ├── auth/                 # NextAuth endpoints
│   │   ├── register/             # User registration
│   │   ├── me/                   # Current user profile, avatar, and account export
│   │   ├── groups/               # CRUD + join + balances + balance history
│   │   ├── transactions/         # CRUD with split management
│   │   ├── settlements/          # Create & list settlements; preview (fewest payments, the load target)
│   │   ├── receipts/upload-url/  # Signed upload URLs for receipt photos
│   │   ├── health/               # Liveness (live) and readiness (ready) probes
│   │   ├── metrics/              # Prometheus metrics (token-protected)
│   │   ├── trips/                # Trip management
│   │   ├── search/               # Global search across entities
│   │   ├── notifications/        # GET (list + unread) / PATCH (mark read)
│   │   ├── budgets/              # GET (by month) / POST (upsert per category)
│   │   ├── analytics/            # Enhanced analytics with AI insights
│   │   ├── ai/chat/              # Gemini-powered AI assistant
│   │   ├── ai/parse-voice/       # Gemini-powered voice transaction parser
│   │   ├── receipt-scan/         # OpenAI Vision receipt scanner
│   │   └── admin/health/         # System diagnostics endpoint
│   ├── invite/                   # Public invite accept page
│   ├── join/                     # Group join flow
│   └── page.tsx                  # Landing page
├── components/
│   ├── ui/                       # 27 reusable UI components (incl. EmptyState)
│   ├── features/                 # 10 feature-specific components (incl. NotificationPanel, AIChatPanel)
│   ├── charts/                   # Recharts-based spending charts
│   └── providers/                # Theme & session providers
├── hooks/                        # 6 custom React hooks
├── lib/                          # Server and shared modules
│   ├── auth.ts                   # NextAuth configuration
│   ├── db.ts                     # Prisma client singleton
│   ├── groupFinance.ts           # Balances, settle-up routes and balance-history derivation
│   ├── settlementPlanner.ts      # Fewest-payments planner (exact up to 16 people, bounded search beyond)
│   ├── settlementScenario.ts     # Seeded simulated trips for the preview endpoint and load tests
│   ├── splits.ts                 # Equal shares in paise
│   ├── rateLimit/                # Redis sliding-window limiter: policies, identity, client IP, store
│   ├── observability/            # Request-span metrics and W3C trace context
│   ├── metrics.ts                # Prometheus registry (one per process) and recorders
│   ├── logger.ts                 # JSON logs with request ID, pod and version
│   ├── requestQueue.ts           # Queue-time measurement for load shedding
│   ├── readJsonBody.ts           # JSON body reader with a hard size cap
│   ├── storage.ts                # Service-role storage: signed receipt uploads, avatars, image sniffing
│   ├── receiptUrl.ts             # Trusted and owned receipt URL checks
│   ├── supabase.ts               # Browser storage client (uploads through signed URLs only)
│   ├── transactionParser.ts      # UPI/SMS regex parser
│   ├── export.ts                 # CSV/JSON export + balance journey export
│   ├── auditLog.ts, auditPayloads.ts  # Audit log recording and snapshots
│   ├── notifications.ts, email.ts     # Notification and email helpers
│   ├── upi.ts                    # UPI deep-link generator
│   ├── validators.ts             # Zod schemas
│   ├── apiResponse.ts            # Standardized API response helpers
│   ├── featureFlags.ts           # Feature toggle system
│   └── utils.ts                  # General utilities
└── prisma/
    └── schema.prisma             # Database schema (13 models)
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 20+
- **PostgreSQL** database (or [Neon](https://neon.tech/) free tier)

### 1. Clone & Install

```bash
git clone https://github.com/your-username/SplitX.git
cd SplitX
npm install
```

### 2. Environment Variables

Create a `.env` file in the root:

```env
# Database (Neon PostgreSQL)
DATABASE_URL="postgresql://user:pass@host-pooler/neondb?sslmode=require"
DIRECT_URL="postgresql://user:pass@host/neondb?sslmode=require"

# NextAuth
NEXTAUTH_SECRET="your-random-secret-here"
NEXTAUTH_URL="http://localhost:3000"

# OAuth (optional)
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
GITHUB_ID="your-github-id"
GITHUB_SECRET="your-github-secret"

# AI (optional — works with local fallback)
GEMINI_API_KEY="your-gemini-api-key"

# OpenAI Vision (optional — for advanced receipt scanning)
OPENAI_API_KEY="your-openai-api-key"
```

### 3. Database Setup

```bash
npx prisma generate
npx prisma db push
```

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

### 5. Build for Production

```bash
npm run build
npm start
```

---

## 🔑 API Reference

### Core APIs
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/register` | Create a new user account |
| `GET` | `/api/me` | Get current user profile |
| `POST` | `/api/me/avatar` | Upload a profile photo (type checked from the file's bytes, stored under the user's folder) |
| `GET` | `/api/me/export` | Export the current user's account data bundle |
| `GET` | `/api/groups` | List user's groups (filters soft-deleted) |
| `POST` | `/api/groups` | Create a new group |
| `GET` | `/api/groups/:id` | Get group details with members & balances |
| `DELETE` | `/api/groups/:id` | **Soft-delete group** (owner only) — cascades to transactions & settlements, notifies all members |
| `DELETE` | `/api/groups/:id/members` | **Remove member** (owner/admin) - recalculates equal splits, cleans orphaned data |
| `GET` | `/api/groups/:id/balances` | Compute balances & suggested settlements (group members only) |
| `GET` | `/api/groups/:id/balance-history` | Derive the current user's balance timeline with explanations, deltas, and route summaries |
| `POST` | `/api/groups/join` | Join a group via invite code |
| `GET` | `/api/settlements/by-group` | **Batch endpoint** — all per-group settlements + global overview in one call |
| `GET` | `/api/transactions` | List transactions (supports `?limit=`) |
| `POST` | `/api/transactions` | Create transaction with splits |
| `PUT` | `/api/transactions/:id` | Update transaction — notifies all group members |
| `DELETE` | `/api/transactions/:id` | **Soft-delete** transaction — notifies all group members |
| `GET` | `/api/settlements` | List settlements |
| `POST` | `/api/settlements` | Create or update settlement |
| `POST` | `/api/settlements/:id/pay` | Generate UPI deep-link and mark as initiated |
| `POST` | `/api/settlements/:id/confirm` | Confirm UPI payment — notifies **all** group members |
| `POST` | `/api/settlements/preview` | Fewest payments for supplied balances, or for a seeded simulated trip (`{ "scenario": { "members": 500, "seed": 42 } }`). No sign-in; rate limited; 503 when the pod is saturated |
| `POST` | `/api/receipts/upload-url` | One-time signed URL to upload a receipt photo straight to storage, into the caller's own folder |
| `GET` | `/api/trips` | List trips |
| `POST` | `/api/trips` | Create a trip |
| `GET` | `/api/search?q=` | Global search |

### Phase 2 APIs
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/notifications` | List notifications with unread count |
| `PATCH` | `/api/notifications` | Mark notification(s) as read |
| `POST` | `/api/notifications` | Send notification to user (requires shared group membership) |
| `GET` | `/api/budgets?month=&year=` | List budgets for a month |
| `POST` | `/api/budgets` | Create/update budget for a category |
| `GET` | `/api/analytics` | Enhanced analytics (trends, categories, budget comparison, insights) |
| `POST` | `/api/ai/chat` | AI assistant — send message, get contextual response |
| `POST` | `/api/ai/parse-voice`| Parse natural language transcripts into structured transaction objects |
| `POST` | `/api/receipt-scan` | Advanced receipt scan via OpenAI Vision (returns items, taxes, total) |
| `GET` | `/api/admin/health` | System health diagnostics |
| `GET` | `/api/health/live` | Liveness: the process is up (no dependencies) |
| `GET` | `/api/health/ready` | Readiness: the database answers within 2 s |
| `GET` | `/api/metrics` | Prometheus metrics (bearer token; refuses to serve in production without one) |

---

## 🧮 Debt Simplification Algorithm

Every settle-up screen uses one planner (`src/lib/settlementPlanner.ts`). Any
settle-up plan splits the group into sets of people whose balances add up to
zero, and a set of *k* people settles in *k − 1* payments. The fewest payments
therefore means the most such sets.

1. **Exact opposites first.** Someone who owes exactly what another person is owed pays them directly. This never costs optimality.
2. **Exact solution for real groups.** With up to 16 people left, dynamic programming over every subset finds the provably fewest payments (0.66 ms in the worst case).
3. **Larger groups.** Sets of three that cancel exactly (two people add up to a third) settle with two payments each, within a fixed work budget. Everyone else is settled largest-first.
4. **No churn.** The classic largest-debtor-pays-largest-creditor plan is kept unchanged unless it needs more payments.

For groups of a few friends the largest-first plan is almost always already optimal; the planner guarantees it. In large groups it saves real payments: a simulated 2,000-person event needs 1,818 payments instead of 1,999, where repaying each expense directly would take 23,602. Details and measurements: [D-023](docs/DECISIONS.md).

---

## 🎨 Theming System

SplitX uses a **CSS custom properties** design system with HSL-based color tokens:

- **12 accent palettes**: `rose`, `ocean`, `emerald`, `violet`, `amber`, `slate`, `coral`, `teal`, `indigo`, `lime`, `fuchsia`, `cyan`
- **Dark / Light modes** with automatic system detection
- **Display typography**: `Playfair Display` is the primary visible font across headings, body, navigation, cards, and data UI
- **Glassmorphism tokens**: `--bg-glass`, `--border-glass`, `--shadow-card`
- **Spacing scale**: 4px base with `--space-1` through `--space-12`
- **Typography scale**: `--text-2xs` through `--text-3xl`
- **Border radius**: `--radius-sm` through `--radius-full`

Theme preference is persisted in `localStorage` and applied via CSS class on `<html>`.

---

## 📱 PWA-Ready Features

- **Fluid responsive design** — `clamp(14px, 3.6vw, 16px)` base font scales across all phone sizes (6.5" to 7.0"+)
- **viewport-fit: cover** — proper notch/safe-area handling on all devices
- **Auto-generated service worker** — `@ducanh2912/next-pwa` with cache-busting (no stale assets)
- **Responsive layout** with mobile-first bottom navigation + FAB
- **Pull-to-refresh** touch gesture on dashboard
- **Haptic feedback** via Vibration API
- **Offline detection** with user-friendly banner
- **Camera integration** via getUserMedia for receipt scanning

---

## Notes on Balance History

- You do **not** need to wipe existing production data to use Balance Journey.
- Existing transactions and confirmed settlements can still be used to derive balance changes from your current database state.
- Historical edits or deletes that happened **before** audit logging was added cannot be reconstructed perfectly if no audit record existed at the time.
- From this release onward, new transaction edits, deletes, settlement confirmations, group mutations, and member removals are logged more clearly for future explainability.
- Users only see **their own** balance journey. The app-level `History` menu routes into the same self-only per-group Balance Journey rather than exposing other members' money-change trails.

---

## 📄 License

This project is private and not open-source.
