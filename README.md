# ⚡ SplitX — Smart Expense Splitting & Settlement

> A premium, full-stack expense-splitting web app built with **Next.js 16**, **Prisma**, **PostgreSQL (Neon)**, and **NextAuth v5**. Features glassmorphic UI, AI-powered receipt scanning (Tesseract OCR + OpenAI Vision), Gemini AI chat assistant, real-time group chat with avatars, debt simplification, real-time analytics, smart notifications, and 12 color themes.

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
        GroupsAPI["GET/POST /api/groups<br/>GET/PUT /api/groups/:id<br/>GET /api/groups/:id/balances<br/>POST /api/groups/join"]
        TxnAPI["GET/POST /api/transactions<br/>PUT/DELETE /api/transactions/:id"]
        SettleAPI["GET/POST /api/settlements"]
        TripsAPI["GET/POST /api/trips"]
        SearchAPI["GET /api/search"]
        NotifAPI["GET/PATCH /api/notifications"]
        BudgetAPI["GET/POST /api/budgets"]
        AnalyticsAPI["GET /api/analytics"]
        AIChatAPI["POST /api/ai/chat"]
        HealthAPI["GET /api/admin/health"]
    end

    subgraph Backend["⚙️ Backend Services"]
        PrismaORM["Prisma ORM"]
        AuthLib["NextAuth v5"]
        Parser["Transaction Parser<br/>(OCR + regex)"]
        SettleLib["Settlement Engine<br/>(Greedy + Optimized)"]
        NotifLib["Notification Engine"]
        AuditLib["Audit Logger"]
        RateLimit["Rate Limiter"]
        Export["CSV/JSON Export"]
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
| **Expense Tracking** | Create, edit, delete expenses with categories, payment methods, and receipt URLs |
| **Group Management** | Create groups, invite via link/code, manage members with admin roles |
| **Trip Scoping** | Organize expenses within trips per group with date ranges and currency |
| **Split Types** | Equal, percentage, custom, and item-based splitting |
| **Settlements** | Track who owes whom, mark as completed, with UPI deep-links and auto-sync |
| **Settlement Security** | Self-settlement block, 60s duplicate check, membership verification, soft-delete filters |
| **Debt Simplification** | Dual algorithm: greedy netting + optimized exact-match pruning (auto-picks fewer transfers) |
| **Analytics Dashboard** | 6-month spending trends, category breakdown, budget vs actual comparison, smart AI insights |
| **Budget Tracking** | Set monthly budgets per category, compare against actual spending |
| **CSV/JSON Export** | Export transaction data for external use |

### AI & Smart Features
| Feature | Description |
|---|---|
| **🤖 AI Chat Assistant** | Gemini-powered conversational assistant — ask about spending, debts, groups in natural language |
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
| **Smart Notifications** | Real-time notification panel with type-based icons, unread badges, mark-all-read, 30s auto-polling |
| **Smart Insights** | AI-generated spending insights: overspend alerts, savings detection, trend change analysis |
| **Global Search** | Search across transactions, groups, and members |

### Premium UI/UX
| Feature | Description |
|---|---|
| **Glassmorphism Design** | Frosted-glass cards with blur, saturation, and gradient overlays |
| **12 Color Themes** | Rose, Ocean, Emerald, Violet, Amber, Slate, Coral, Teal, Indigo, Lime, Fuchsia, Cyan |
| **Dark / Light Mode** | System-aware with manual toggle; theme saved to localStorage |
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
| **Group Receipt Gallery** | Per-group receipt gallery page with masonry grid, payer filter, and zoomed view with expense details |
| **QR Code Invites** | Generate QR codes for group invitations |
| **Centered Split UI** | Split-among member avatars center-aligned with clean multi-line wrapping |

### System & Admin
| Feature | Description |
|---|---|
| **System Health Dashboard** | Real-time service status, DB latency, data counts, server uptime |
| **Audit Logging** | Track all data mutations (create/update/delete) with entity details |
| **Feature Flags** | Toggle features on/off without code changes |
| **Rate Limiting** | In-memory sliding-window rate limiter (50 req/min per IP) |
| **API Middleware** | Global request logging and rate limiting via Next.js middleware |

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
| **AI** | Google Gemini 2.0 Flash (with smart local fallback) |
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
│   │   ├── groups/               # Group list & group detail (balances, members, activity)
│   │   ├── transactions/         # List/timeline view, new, scan, receipts
│   │   ├── settlements/          # Settlement tracker with status management
│   │   ├── analytics/            # Spending charts & breakdowns
│   │   ├── settings/             # Profile, theme, account settings
│   │   └── admin/health/         # System health dashboard
│   ├── (auth)/                   # Login & register pages
│   ├── api/                      # Next.js API route handlers
│   │   ├── auth/                 # NextAuth endpoints
│   │   ├── register/             # User registration
│   │   ├── me/                   # Current user profile & avatar
│   │   ├── groups/               # CRUD + join + balances
│   │   ├── transactions/         # CRUD with split management
│   │   ├── settlements/          # Create & list settlements
│   │   ├── trips/                # Trip management
│   │   ├── search/               # Global search across entities
│   │   ├── notifications/        # GET (list + unread) / PATCH (mark read)
│   │   ├── budgets/              # GET (by month) / POST (upsert per category)
│   │   ├── analytics/            # Enhanced analytics with AI insights
│   │   ├── ai/chat/              # Gemini-powered AI assistant
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
│   ├── export.ts                 # CSV/JSON export
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
| `GET` | `/api/groups` | List user's groups |
| `POST` | `/api/groups` | Create a new group |
| `GET` | `/api/groups/:id` | Get group details with members & balances |
| `GET` | `/api/groups/:id/balances` | Compute balances & suggested settlements |
| `POST` | `/api/groups/join` | Join a group via invite code |
| `GET` | `/api/transactions` | List transactions (supports `?limit=`) |
| `POST` | `/api/transactions` | Create transaction with splits |
| `PUT` | `/api/transactions/:id` | Update transaction |
| `DELETE` | `/api/transactions/:id` | Delete transaction |
| `GET` | `/api/settlements` | List settlements |
| `POST` | `/api/settlements` | Create or update settlement |
| `GET` | `/api/trips` | List trips |
| `POST` | `/api/trips` | Create a trip |
| `GET` | `/api/search?q=` | Global search |

### Phase 2 APIs
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/notifications` | List notifications with unread count |
| `PATCH` | `/api/notifications` | Mark notification(s) as read |
| `GET` | `/api/budgets?month=&year=` | List budgets for a month |
| `POST` | `/api/budgets` | Create/update budget for a category |
| `GET` | `/api/analytics` | Enhanced analytics (trends, categories, budget comparison, insights) |
| `POST` | `/api/ai/chat` | AI assistant — send message, get contextual response |
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
- **Glassmorphism tokens**: `--bg-glass`, `--border-glass`, `--shadow-card`
- **Spacing scale**: 4px base with `--space-1` through `--space-12`
- **Typography scale**: `--text-2xs` through `--text-3xl`
- **Border radius**: `--radius-sm` through `--radius-full`

Theme preference is persisted in `localStorage` and applied via CSS class on `<html>`.

---

## 📱 PWA-Ready Features

- **Responsive layout** with mobile-first bottom navigation + FAB
- **Pull-to-refresh** touch gesture on dashboard
- **Haptic feedback** via Vibration API
- **Offline detection** with user-friendly banner
- **Camera integration** via getUserMedia for receipt scanning

---

## 📄 License

This project is private and not open-source.
