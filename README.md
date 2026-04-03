# ⚡ SplitX — Smart Expense Splitting & Settlement

> A production-grade, full-stack expense-splitting web app built with **Next.js 16**, **Prisma**, **PostgreSQL (Neon)**, and **NextAuth v5**. Features glassmorphic UI, AI-powered receipt scanning (Tesseract OCR + OpenAI Vision), Gemini AI chat assistant, real-time group chat with avatars, debt simplification with transparent calculation breakdowns, Balance Journey history timelines, CSV/print exports, real-time analytics, smart notifications, colorful themed navigation, backend security hardening, and 12 color themes.

---

## Local + CI Workflow

- Local development: `npm install` then `npm run dev`
- Local production-style container run: `docker compose up --build`
- CI pipeline: `.github/workflows/ci.yml` runs `npm test`, `npm run lint`, `npm run build`, and validates the Docker image build on PRs and `main`
- Docker uses your existing `.env` file, so keep production secrets out of the repo and configure them through environment variables / GitHub Secrets

---

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
| **Rate Limiting Middleware** | Tiered in-memory rate limiter: 5/hr register, 10/15min auth, 30/min settlements, 120/min default |
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
│   │   ├── settlements/          # Create & list settlements
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
├── lib/                          # 11 utility modules
│   ├── auth.ts                   # NextAuth configuration
│   ├── db.ts                     # Prisma client singleton
│   ├── settlement.ts             # Dual settlement algorithm (greedy + optimized)
│   ├── transactionParser.ts      # UPI/SMS regex parser
│   ├── voiceParser.ts            # Local fallback parser for voice input
│   ├── export.ts                 # CSV/JSON export + balance journey export
│   ├── groupFinance.ts           # Shared balance and balance-history derivation engine
│   ├── auditPayloads.ts          # Audit snapshot helpers for mutations
│   ├── upi.ts                    # UPI deep-link generator
│   ├── validators.ts             # Zod schemas
│   ├── utils.ts                  # General utilities
│   ├── featureFlags.ts           # Feature toggle system
│   ├── apiResponse.ts            # Standardized API response helpers
│   ├── rateLimit.ts              # Sliding-window rate limiter
│   ├── recomputeBalances.ts      # Group balance recomputation
│   ├── notifications.ts          # Notification creation helpers
│   ├── auditLog.ts               # Audit log recording
│   └── middleware.ts             # API rate limiting & logging
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
| `GET` | `/api/me/avatar` | Get user avatar |
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

---

## 🧮 Debt Simplification Algorithm

SplitX uses a **dual-algorithm approach** to minimize settlement transfers:

### Algorithm 1: Greedy Netting
1. Compute each member's **net balance** (total paid − total owed)
2. Separate into **debtors** (negative balance) and **creditors** (positive balance)
3. Sort debtors by largest debt, creditors by largest credit
4. Iteratively match the largest debtor with the largest creditor
5. Transfer the minimum of the two amounts, reducing both

### Algorithm 2: Optimized Exact-Match Pruning
1. Compute net balances (same as above)
2. **Phase 1 — Exact matches**: Find debtors and creditors with matching amounts and pair them directly (one transfer each)
3. **Phase 2 — Sorted merge**: Pair remaining debtors/creditors by size

The engine runs both algorithms and **automatically picks the one with fewer transfers**, reporting savings when applicable.

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
