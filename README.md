# Attendance Tracker

> **Automated, battery-efficient, single-user attendance management system with complete functional parity between a native mobile client and an interactive web portal, backed by a centralized self-hosted server.**

[![Node.js](https://img.shields.io/badge/Node.js-20_LTS-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Fastify](https://img.shields.io/badge/Fastify-v4%2B-000000?logo=fastify&logoColor=white)](https://fastify.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL_Mode-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-v0.30%2B-C5F74F?logo=drizzle&logoColor=black)](https://orm.drizzle.team/)
[![React Native](https://img.shields.io/badge/React_Native-Expo_SDK_51%2B-000020?logo=expo&logoColor=white)](https://expo.dev/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS_3.4-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Docker](https://img.shields.io/badge/Docker-Multi--stage-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)

---

## ⚡ Quick Navigation: Choose Your Plan

Depending on your engineering goal, this repository provides two planning tracks:

1. **[Recommended] The Lean Single-User Plan** 👉 [`docs/SIMPLE_PLAN.md`](docs/SIMPLE_PLAN.md)
   - **No login/logout screens or auth flows**: Single pre-shared secret token (`X-API-KEY`).
   - **Minimal SQLite database**: Just 2 tables (`settings` and `attendance_log`).
   - **4 Core Endpoints**: `/api/status`, `/api/checkin`, `/api/history`, `/api/settings`.
   - **Fast 4-Stage implementation**: Direct, uncluttered, and ready to build immediately.

2. **The Comprehensive Enterprise-Grade Specification Suite** 👉 [`PROJECT.md`](PROJECT.md)
   - Deep reference documentation covering 32 domain features, multi-profile Docker orchestration, advanced Litestream replication, OpenAPI 3.1 contracts, and forensic audit criteria.

---

## 📌 Mission & Core Philosophy

**Attendance Tracker** eliminates manual daily clock-ins for an individual professional. By coupling native OS background geofencing on mobile devices (iOS `CoreLocation` and Android `GeofenceManager`) with an embedded SQLite Write-Ahead Logging backend and a responsive Web Portal, the system automatically registers work arrivals when you physically enter your workplace boundary during your scheduled arrival window.

### Key Architectural Tenets
1. **Zero-Friction Ingestion**: Your phone remains in your pocket. Boundary crossings wake a headless OS background task that persists the event to a local SQLite queue and dispatches an idempotent check-in to your server.
2. **Battery Efficiency**: No continuous GPS polling. Multi-tier sensing relies on cellular tower handoffs and Wi-Fi beacons for macro tracking, spinning up satellite GNSS positioning only when approaching the workplace perimeter ($< 1.5\%$ battery impact per day).
3. **Idempotency & Boundary Bounce Resilience**: Commuters cross boundaries when parking, walking to lunch, or running errands. The first arrival timestamp and computed status (`PRESENT` or `LATE`) for any calendar date are permanently preserved; subsequent exits update check-out times without corrupting check-ins.
4. **Complete Client Feature Parity**: The Web Portal and Mobile App share identical TypeScript domain models, Zod validation contracts, interactive geofence maps, 7-day schedule matrices, 52-week activity heatmaps, and formal manual override workflows.
5. **Self-Hosting & Data Sovereignty**: Self-hosted via Docker Compose on a low-cost VPS (with automated Caddy TLS) or a home server behind CGNAT (with Cloudflare Tunnels). Zero third-party telemetry, sub-65MB RAM footprint, and instant startup ($< 400\text{ms}$).

---

## 📖 Master Documentation Index

Every component, protocol, schema, and operational procedure is authoritatively specified across dedicated documentation modules:

| Document | File Path | Scope & Primary Coverage |
| :--- | :--- | :--- |
| **Project Master Specification** | [`PROJECT.md`](PROJECT.md) | High-level system overview, 32-feature domain inventory, milestone pipeline (M1–M5), and interface contracts. |
| **System Architecture** | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Monorepo topology, data flow sequence diagrams, component interaction architecture, and DDL schema. |
| **Client Parity Specification** | [`docs/CLIENT_PARITY.md`](docs/CLIENT_PARITY.md) | The 5 core parity pillars: Interactive Map, Schedule Matrix, 52-Week Heatmap, Manual Adjustments, and Live Status Widget. |
| **Backend Specification** | [`docs/BACKEND_SPEC.md`](docs/BACKEND_SPEC.md) | Fastify server lifecycle, Drizzle ORM integration, idempotency state machine, Croner scheduling, and notification pipelines. |
| **Database Schema** | [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md) | Embedded SQLite 3 WAL engine, PRAGMA configuration, table definitions, relational indexes, and migration strategy. |
| **API Specification** | [`docs/API_SPECIFICATION.md`](docs/API_SPECIFICATION.md) | OpenAPI 3.1 specification, RFC 9457 error contracts, authentication schemes (JWT cookie & Bearer token), and endpoint schemas. |
| **Geofencing Mechanics** | [`docs/GEOFENCING_MECHANICS.md`](docs/GEOFENCING_MECHANICS.md) | iOS `CLCircularRegion`, Android `GeofencingClient`, Expo `TaskManager` headless execution, offline SQLite queues, and clock skew guards. |
| **Self-Hosting Guide** | [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) | Multi-stage Docker packaging, Cloudflare Tunnels (CGNAT bypass), Caddy auto-TLS, Litestream S3 replication, and disaster recovery. |
| **Implementation Roadmap** | [`docs/IMPLEMENTATION_ROADMAP.md`](docs/IMPLEMENTATION_ROADMAP.md) | Phased, actionable 8-phase engineering roadmap from environment initialization to end-to-end verification and hardening. |
| **Technical Requirements** | [`docs/TECHNICAL_REQUIREMENTS.md`](docs/TECHNICAL_REQUIREMENTS.md) | Foundation domain requirements and historical specification index. |

---

## 🏛️ System Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 CLIENT APPLICATIONS                                    │
│                                                                                        │
│   ┌────────────────────────────────────────┐  ┌────────────────────────────────────┐   │
│   │    Mobile Application (iOS/Android)    │  │       Web Portal (SPA)             │   │
│   │         Expo SDK 51+ / React Native    │  │       React 18 + Vite + Tailwind   │   │
│   │  - iOS CoreLocation / Android Geofence │  │  - MapLibre GL Geofence Visualizer │   │
│   │  - Headless TaskManager Daemon         │  │  - 7-Day Schedule Matrix Table     │   │
│   │  - Durable Local SQLite Queue          │  │  - 52-Week GitHub Activity Grid    │   │
│   │  - Bearer Token Auth (Keychain)        │  │  - Manual Override & Audit Drawer  │   │
│   └───────────────────┬────────────────────┘  └─────────────────┬──────────────────┘   │
└───────────────────────┼─────────────────────────────────────────┼──────────────────────┘
                        │ POST /api/v1/attendance/events          │ Session Cookie (JWT)
                        │ (Authorization: Bearer <TOKEN>)         │ (Argon2id Login)
                        ▼                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                           NETWORK & SECURE INGRESS LAYER                               │
│                                                                                        │
│   Homelab / CGNAT: Cloudflare Tunnel (cloudflared)  ──┐                                │
│   VPS / Public IP: Caddy Reverse Proxy (Auto TLS)   ──┴──> http://127.0.0.1:3000       │
└─────────────────────────────────────────────────────────────────┬──────────────────────┘
                                                                  │
                                                                  ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        CENTRALIZED SERVER CONTAINER (Node.js 20)                       │
│                                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Fastify Application Engine                                                       │  │
│  │  - @fastify/helmet, @fastify/cors, @fastify/rate-limit                           │  │
│  │  - Route Ingestion & Idempotency Gate (Composite Unique Key: user_id + date)     │  │
│  │  - Attendance State Machine (PRESENT, LATE, ABSENT, LEAVE, WFH)                   │  │
│  │  - Background Croner Scheduler (15m Pre-Cutoff Warning, Absentee Reconciliation) │  │
│  │  - Static Asset Delivery (Serves compiled Web SPA from /*)                       │  │
│  └──────────────────────────────────────────┬───────────────────────────────────────┘  │
│                                             │ In-Process Fast SQLite Driver            │
│                                             ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Embedded SQLite 3 Storage Layer (WAL Mode via better-sqlite3 & Drizzle ORM)      │  │
│  │  - Local Data Volume: /data/attendance.db                                        │  │
│  │  - Nightly Zero-Lock VACUUM INTO Live Snapshots: /backups/                       │  │
│  │  - Optional Real-Time Litestream Replication to Remote S3/R2                     │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────┬──────────────────────────────────────────┘
                                              │
                                              ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                         PUSH NOTIFICATION RELAY INFRASTRUCTURE                         │
│                                                                                        │
│   Expo Push Service Gateway (APNs / FCM)  ──>  Mobile Lock-Screen Banner Notifications  │
│   Optional Self-Hosted Webhook Relay      ──>  ntfy / Gotify                           │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 📁 Monorepo Directory Tree

The project is governed by a strict **Turborepo** + **pnpm workspaces** topology, enforcing modularity, shared domain contracts, and clean compilation boundaries:

```text
AttendanceTracker/
├── apps/
│   ├── server/                  # Centralized Backend (Fastify + SQLite WAL + Drizzle ORM)
│   │   ├── src/
│   │   │   ├── app.ts           # Fastify plugin pipeline & static SPA server
│   │   │   ├── server.ts        # Entrypoint, port listener & graceful shutdown
│   │   │   ├── db/              # better-sqlite3 client, Drizzle schema & migrations
│   │   │   ├── modules/         # Auth, attendance, schedules, locations, analytics
│   │   │   ├── services/        # Attendance evaluation, notifications, time utils
│   │   │   └── jobs/            # Croner schedulers (warnings, reconciliation, backups)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── web/                     # Web Portal SPA (React 18 + Vite + Tailwind CSS)
│   │   ├── src/
│   │   │   ├── components/      # MapLibre GL map, schedule matrix, heatmap, drawers
│   │   │   ├── pages/           # Dashboard, calendar, settings, login
│   │   │   └── hooks/           # Typed queries, mutations, and local state
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   └── mobile/                  # Mobile Application (Expo SDK 51+ / React Native)
│       ├── index.js             # Headless TaskManager registration in global scope
│       ├── src/
│       │   ├── services/        # Geofence task, SQLite offline queue, retry dispatcher
│       │   ├── screens/         # Map, schedule editor, heatmap, manual adjustments
│       │   └── navigation/      # Native stack & tab navigation
│       ├── app.json             # Expo native configuration plugins & permissions
│       └── package.json
│
├── packages/
│   ├── shared/                  # Universal domain kernel: Zod schemas, types & logic
│   │   ├── src/
│   │   │   ├── enums/           # AttendanceStatus, AttendanceSource, AuditAction
│   │   │   ├── schemas/         # LocationConfig, ScheduleConfig, CheckIn, AuditLog
│   │   │   ├── logic/           # Status calculator, haversine math, timezone helpers
│   │   │   └── constants/       # Timing limits, geofence radius constraints
│   │   └── package.json
│   │
│   ├── api-client/              # Strongly-typed fetch SDK wrapping backend REST API
│   ├── tsconfig/                # Shared TypeScript compiler presets (base, node, react)
│   └── eslint-config/           # Unified linting rules and code style definitions
│
├── docker/
│   └── Dockerfile               # Multi-stage production container build (Fastify + Web SPA)
├── Caddyfile                    # Automated TLS reverse proxy configuration for VPS
├── litestream.yml               # Continuous SQLite WAL replication configuration
│
├── docs/                        # Complete technical architecture & engineering specifications
│   ├── ARCHITECTURE.md          # System architecture specification
│   ├── CLIENT_PARITY.md         # Web vs Mobile client parity specification
│   ├── BACKEND_SPEC.md          # Backend architecture specification
│   ├── DATABASE_SCHEMA.md       # Database & Drizzle ORM schema specification
│   ├── API_SPECIFICATION.md     # OpenAPI 3.1 REST API specification
│   ├── GEOFENCING_MECHANICS.md  # Native mobile background geofencing mechanics
│   ├── SELF_HOSTING.md          # Deployment, tunneling, and operations guide
│   ├── IMPLEMENTATION_ROADMAP.md# 8-Phase engineering implementation roadmap
│   └── TECHNICAL_REQUIREMENTS.md# Foundation domain requirements
│
├── docker-compose.yml           # Production Docker Compose specification (with profiles)
├── pnpm-workspace.yaml          # Monorepo workspace boundaries
├── turbo.json                   # Turborepo task pipeline and caching rules
├── package.json                 # Root workspace dependencies & build scripts
└── PROJECT.md                   # Master specification, feature inventory & milestones
```

---

## 🚀 Quick-Start Self-Hosting Guide

Deploy the unified production container hosting the Fastify backend, embedded SQLite database, and pre-compiled Web Portal SPA in minutes.

### Prerequisites
- Docker Engine 24.0+ and Docker Compose v2.20+
- Host operating system: Linux (recommended), macOS, or Windows WSL2
- Persistent local SSD storage (NFS/SMB mounts are strictly prohibited for SQLite WAL)

### 1. Clone & Configure Environment
```bash
git clone https://github.com/your-username/AttendanceTracker.git
cd AttendanceTracker

# Copy environment template
cp .env.example .env
```

Generate secure credentials and configure `.env`:
```bash
# Generate 64-character random secrets
openssl rand -hex 32 # Set as SESSION_SECRET
openssl rand -hex 32 # Set as API_BEARER_TOKEN

# Edit environment variables
nano .env
```

### 2. Launch Container Services

#### Option A: Core Server Only (Direct localhost binding on port 3000)
```bash
docker compose up -d
```

#### Option B: Homelab Deployment (Zero port-forwarding via Cloudflare Tunnel)
```bash
# Ensure CLOUDFLARE_TUNNEL_TOKEN is set in .env
docker compose --profile homelab up -d
```

#### Option C: VPS Deployment (Automated ACME Let's Encrypt TLS via Caddy)
```bash
# Ensure DNS records point to your VPS IP and Caddyfile is configured
docker compose --profile vps up -d
```

#### Option D: Homelab with Continuous Litestream S3 WAL Backup
```bash
docker compose --profile homelab --profile litestream up -d
```

### 3. Verify Health & Operational Status
```bash
# Check container status
docker compose ps

# Inspect backend health endpoint
curl -s http://127.0.0.1:3000/api/v1/health | jq
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2026-11-05T14:00:00.000Z",
  "uptime_seconds": 12,
  "database": {
    "connected": true,
    "wal_mode": true
  },
  "version": "1.0.0"
}
```

---

## 💻 Development Setup & Prerequisites

### Prerequisites
- **Node.js**: `v20.x LTS`
- **Package Manager**: `pnpm` (version 9+)
- **Mobile Development** (for `apps/mobile`):
  - Expo CLI: `npm install -g expo-cli`
  - macOS with Xcode 15+ (for iOS simulator / device builds)
  - Android Studio with Android SDK 34+ (for Android emulator / device builds)

### Local Development Commands

```bash
# Install all monorepo dependencies
pnpm install

# Run build across all workspaces via Turborepo
pnpm build

# Start all applications in parallel watch/dev mode
pnpm dev

# Execute unit and integration tests across workspaces
pnpm test

# Run TypeScript type-checking across all packages
pnpm type-check

# Run code style & lint checks
pnpm lint
```

### Starting Individual Applications
```bash
# Fastify Backend Server (apps/server)
pnpm --filter @attendance/server dev

# Web Portal Dashboard (apps/web)
pnpm --filter @attendance/web dev

# Mobile Expo Client (apps/mobile)
pnpm --filter @attendance/mobile start
```

---

## 🔒 Privacy & Data Sovereignty

- **Zero External Tracking**: Attendance Tracker contains no third-party telemetry, advertising SDKs, or external analytics cookies.
- **Local SQLite Storage**: Your physical movements, arrival timestamps, and audit history never leave your private server.
- **Encrypted Ingress**: All mobile background check-ins and web sessions transmit over standard TLS 1.3 / HTTPS encryption.
- **Zero Lock-In**: Full database exports are instantly downloadable in standard CSV and JSON formats directly through the Web and Mobile settings panels.

---

## 📄 License
This project is open-source software licensed under the **MIT License**.
