# Attendance Tracker: Project Master Specification

> **Status**: Architectural Specification Phase (Milestone 1)  
> **Target Audience**: Core Engineering, Platform Architects, QA, and Forensic Auditors  
> **System Architecture**: Monorepo (pnpm + Turborepo) with Dual Clients (React Native/Expo + React/Vite) backed by a Centralized Fastify + SQLite WAL Backend Service  

---

## 1. Project Overview & Core Philosophy

### 1.1 Purpose & Mission
**Attendance Tracker** is an automated, battery-efficient, single-user attendance management system designed to eliminate manual clock-ins. By coupling native OS background geofencing on mobile devices (iOS CoreLocation and Android GeofenceManager) with a centralized self-hosted backend and an interactive web portal, the system automatically registers work arrivals when the user physically enters their configured workplace boundary during their daily scheduled window.

### 1.2 The Single-User Operational Paradigm
Unlike enterprise workforce management platforms burdened by complex multi-tenant hierarchies, manager approval workflows, organizational trees, and role-based permissions, Attendance Tracker is strictly optimized for an **individual professional**. 
- **Data Volume**: Approximately 250–300 work records per calendar year. Five years of complete telemetry, check-ins, check-outs, and manual overrides consume less than 15 MB of SQLite storage.
- **Architectural Consequence**: Multi-tenant database connection pooling, distributed caching (Redis), distributed message brokers (Kafka/RabbitMQ), and heavyweight relational servers (PostgreSQL) introduce unnecessary RAM consumption (~200–500 MB) and container orchestration overhead. SQLite running in Write-Ahead Logging (WAL) mode embedded directly within a Fastify Node.js process achieves zero network latency, instant startup (<400ms), and sub-50 MB idle memory consumption.

### 1.3 Core Engineering Philosophy
1. **Zero-Friction Ingestion**: Daily attendance registration requires zero manual user interaction. The phone remains locked in the user's pocket while OS-level hardware sensors detect boundary crossings.
2. **Energy Conservation & Multi-Tier Sensing**: Continuous GPS polling drains mobile batteries within hours. The mobile client relies on cell-tower and Wi-Fi SSID transitions for macro-location monitoring, reserving satellite GNSS hardware exclusively for approaching the workplace perimeter. Total daily battery impact remains below 1.5%.
3. **Idempotency & Boundary Bounce Resilience**: Commuters frequently cross borders when parking, walking to lunch, or running mid-day errands. The system treats daily check-ins as strictly immutable and idempotent: the first arrival timestamp and computed status for any calendar date are permanently preserved. Subsequent daily entries update exit records without corrupting initial check-in data.
4. **Offline Durability & Replay Consistency**: In subterranean garages or cellular dead-zones, events are committed to a local device-side SQLite queue and flushed asynchronously with exponential backoff and jitter upon network reconnection. Arrivals are evaluated using the device's original sensor capture timestamp, not server receipt time.
5. **Client Feature Parity**: The Web Portal and Mobile Application share identical TypeScript domain models, Zod validation contracts, and user capabilities—including interactive geofence radius maps, 7-day schedule matrices, GitHub-style 52-week activity heatmaps, and formal manual adjustment workflows with immutable audit logs.
6. **Local-First Data Ownership & Self-Hosting**: Full operational autonomy is maintained through containerized Docker Compose deployments. Whether hosted on a public VPS with automated TLS or on an internet-connected homelab behind CGNAT via Cloudflare Tunnels, data remains entirely under user control.

---

## 2. Milestone Roadmap (M1 to M5)

The project is structured into five sequential, verifiable milestones. Every capability discovered during domain analysis maps directly into this development pipeline.

| Milestone | Name | Primary Scope & Objectives | Key Deliverables | Dependencies | Verification Strategy |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **M1** | **Architecture & Client Parity** | Establish complete architectural blueprints, technical documentation, monorepo topology, shared TypeScript schemas, status computation algorithms, and mobile/web feature parity contracts. | `PROJECT.md`, `docs/ARCHITECTURE.md`, `docs/CLIENT_PARITY.md`, package layouts | Survey & Requirements | Architectural review, schema validation, layout verification |
| **M2** | **Backend, Database & API Engine** | Implement Fastify backend, SQLite WAL engine via Drizzle ORM, database migrations, authentication (Argon2id + Bearer tokens), CRUD endpoints, status evaluation state machine, idempotency guarantees, export/import, and cron jobs. | `apps/server`, `packages/shared`, `packages/api-client`, SQLite DDL, automated tests | M1 | Unit & integration tests (`vitest`), SQLite WAL concurrency tests, API contract testing |
| **M3** | **Geofencing Mechanics & Mobile Client** | Implement React Native / Expo mobile application, native iOS CoreLocation (`CLCircularRegion`) & Android `GeofencingClient` integration, Expo TaskManager background daemon, local SQLite event queue, Wi-Fi SSID fallback, monotonic clock guards, and push receipt. | `apps/mobile`, background tasks, custom native config plugins, SQLite queue manager | M1, M2 | Custom dev build on iOS Simulator / Android Emulator, simulated GPX geofence breaches, offline queue replay tests |
| **M4** | **Self-Hosting, Tunneling & Deployment** | Containerize the system with multi-stage Docker builds, production Docker Compose recipes, Caddy reverse proxy with automatic ACME Let's Encrypt TLS, Cloudflare Tunnel integration, Litestream live backups, and health monitoring. | `docker/Dockerfile`, `docker/docker-compose.yml`, `Caddyfile`, Litestream configs | M2 | Docker build verification, container memory profiling (<65MB), live backup & restore drill, tunnel ingress testing |
| **M5** | **Web Client & Complete System Integration** | Implement React/Vite Web Portal with Tailwind CSS, MapLibre GL geofencing map, 7-day schedule editor, 52-week activity heatmap, manual adjustment modal with audit trail drawer, live status widget, and end-to-end integration. | `apps/web`, responsive dashboard, full end-to-end test suites, release builds | M1, M2, M3, M4 | End-to-end user workflows (Playwright / Cypress), cross-client sync validation, final parity audit |

---

## 3. Comprehensive Feature Inventory

The following exhaustive inventory documents all 32 system features identified during domain mining. Every feature is explicitly assigned to its respective development milestone (M1 through M5).

| # | Category | Feature Name | Description | Inputs | Outputs | Error Behavior | Source | Assigned Milestone |
|---|----------|--------------|-------------|--------|---------|----------------|--------|-------------------|
| 1 | System Architecture | Monorepo Structure & Tooling | Centralized workspace hosting web, mobile, server, and shared packages via pnpm workspaces and Turborepo. | Monorepo config, workspace manifests | Unified build pipeline, cached task execution | Build fails on mismatched package versions | `README.md:28-40`, `ORIGINAL_REQUEST.md:29` | **M1** |
| 2 | System Architecture | Shared Contract Package (`packages/shared`) | Common Zod schemas, TypeScript types, status computation math, and constants shared across all apps. | Source TypeScript definitions | Compiled npm workspace package with type declarations | Compile-time type check failure on drift | `README.md:35`, `ORIGINAL_REQUEST.md:29` | **M1** |
| 3 | User Management | Single-User Profile & Timezone Config | Manages single-user preferences, display name, and authoritative IANA timezone anchor (e.g. `Asia/Kolkata`). | `timezone` (IANA string), `display_name`, `user_id` | Persisted `user_settings` entity | 400 Bad Request on invalid IANA timezone string | `TECHNICAL_REQUIREMENTS.md:71-75` | **M2** |
| 4 | Security & Auth | Dual-Credential Single-User Authentication | Web password auth via Argon2id issuing JWT session cookies; Mobile API auth via pre-shared cryptographically secure Bearer token. | Passphrase (Web) or Bearer Token (Mobile) | Signed JWT cookie or authorized API session context | 401 Unauthorized on invalid credentials; 429 on brute force | `ORIGINAL_REQUEST.md:21`, Survey 1 & 2 | **M2** |
| 5 | Geofence Config | Work Location Setup & Forward Geocoding | Defines workplace geographic coordinates (WGS 84) and circular geofence radius with map geocoding lookup. | `name`, `latitude` [-90,90], `longitude` [-180,180], `radius_meters` [50,500] | Stored `location_configs` record | 422 Unprocessable Entity if radius out of range | `TECHNICAL_REQUIREMENTS.md:23-28, 76-85` | **M2** |
| 6 | Geofence Fallback | Secondary Wi-Fi SSID / BSSID Fallback | Wi-Fi network proximity verification for indoor workplaces or subterranean basements lacking GNSS visibility. | `wifi_ssid` (string), `wifi_bssid` (MAC string), `is_active` (bool) | Updated `location_configs` fallback settings | Ignored if SSID is empty or permission denied | `TECHNICAL_REQUIREMENTS.md:29-31, 83` | **M3** |
| 7 | Schedule Config | Day-of-Week Working Schedule Matrix | Configures 7-day weekly schedule (0=Sun to 6=Sat), active work days, and per-day arrival windows. | `day_of_week` (0-6), `is_work_day` (bool), `window_start`, `window_end`, `late_cutoff` | Persisted `schedule_configs` records | 400 Bad Request on invalid day-of-week index | `TECHNICAL_REQUIREMENTS.md:33-37, 86-94` | **M2** |
| 8 | Schedule Config | Arrival Window Validation Engine | Enforces strict validation logic: `window_start < window_end < late_cutoff` within 24-hour `HH:MM:SS` format. | Window time strings from client | Validated schedule configuration payload | 422 Unprocessable Entity with inline field error | `TECHNICAL_REQUIREMENTS.md:35-37` | **M1** |
| 9 | Event Ingestion | Geofence Event Ingestion Endpoint | Ingests native mobile background geofence arrival and departure payloads with coordinate and sensor telemetry. | `user_id`, `event_type`, `occurred_at`, `latitude`, `longitude`, `accuracy_meters`, `source` | HTTP 200/201 + Attendance evaluation response | 400 Invalid payload schema, 401 Unauthorized | `ORIGINAL_REQUEST.md:24`, `TECHNICAL_REQUIREMENTS.md:12-18` | **M2** |
| 10 | Event Ingestion | Wi-Fi Connection Trigger Ingestion | Ingests Wi-Fi network connection events when mobile device associates with the configured workplace SSID. | `user_id`, `wifi_ssid`, `bssid`, `occurred_at`, `source='WIFI_AUTO'` | HTTP 200/201 + Attendance evaluation response | 400 on unrecognized/mismatched SSID | `TECHNICAL_REQUIREMENTS.md:29-31, 102` | **M2** |
| 11 | Business Logic | On-Time Status Computation (`PRESENT`) | Marks status as `PRESENT` when arrival event occurs on an active work day within `[window_start, window_end]`. Early arrivals ($T < \text{start}$) also mark `PRESENT`. | Check-in timestamp, localized day schedule | `attendance_records` row with `status='PRESENT'`, `check_in_time` | None (valid path) | `TECHNICAL_REQUIREMENTS.md:39` | **M2** |
| 12 | Business Logic | Late Arrival Status Computation (`LATE`) | Marks status as `LATE` when arrival event occurs on an active work day within `(window_end, late_cutoff]`. | Check-in timestamp, localized day schedule | `attendance_records` row with `status='LATE'`, `check_in_time` | None (valid path) | `TECHNICAL_REQUIREMENTS.md:40` | **M2** |
| 13 | Business Logic | Automated Absenteeism Reconciliation | Scheduled server cron evaluates past cutoff or at day close. Marks `status='ABSENT'` if no check-in occurred on an active work day. | Date, active work day flag, existing check-in presence | `attendance_records` row with `status='ABSENT'`, `check_in_time=NULL` | Overwritten if authentic delayed offline check-in arrives | `TECHNICAL_REQUIREMENTS.md:41` | **M2** |
| 14 | Business Logic | Planned Absence Management (`LEAVE`, `WFH`) | Allows user to pre-designate or log a calendar day as Planned Leave, Sick Day, or Work-From-Home. | `date`, `status` (`LEAVE`, `WFH`), `notes` | `attendance_records` row with selected status | 409 Conflict if conflicting record exists without overwrite flag | `TECHNICAL_REQUIREMENTS.md:42, 101` | **M2** |
| 15 | Business Logic | Multi-Entry Check-In Idempotency | Ensures initial check-in time and status are preserved across subsequent daily boundary entries (e.g. lunch exits). | Multiple geofence `ENTER` payloads on the same date | Existing record returned unmodified; check-in preserved | Duplicate event acknowledged idempotently (HTTP 200) | `TECHNICAL_REQUIREMENTS.md:43-45` | **M2** |
| 16 | Business Logic | Check-Out Time Recording Engine | Ingests geofence `EXIT` events and records/updates `check_out_time` without altering initial check-in or status. | Geofence `EXIT` event with `occurred_at` | Updated `attendance_records.check_out_time` | Logged in timeline if no check-in record exists; no check-in created | `TECHNICAL_REQUIREMENTS.md:100` | **M2** |
| 17 | Event Pipeline | Persistent Mobile SQLite Offline Queue | Durable local device store persisting geofence transitions across device reboots and app kills until acknowledged by server. | Mobile geofence payload | Local SQLite row in `geofence_event_queue` (`PENDING`) | SQLite write lock retried with immediate backoff | `TECHNICAL_REQUIREMENTS.md:43-45`, Survey 2 | **M3** |
| 18 | Event Pipeline | Exponential Backoff with Jitter | Resilient network retry dispatcher preventing thundering herd when server recovers or device regains cellular signal. | Failed HTTP attempt, retry count ($0 \le N \le 10$) | Calculated delay: $t = \min(300, 2 \times 2^N) \pm \text{jitter}$ | After 10 consecutive server 5xx failures, pauses active polling; network disconnects immediately pause retries and await NetInfo reconnect | Survey 2 | **M3** |
| 19 | Event Pipeline | Network Reconnect Drain Trigger | Immediate event queue flush triggered by OS network monitor (`NetInfo`) transitioning from offline to online. | `NetInfo` state change (`isInternetReachable: true`) | Wakes queue processor to drain pending events via batch API | Flapping throttled by 5-second debounce window | Survey 2 | **M3** |
| 20 | Clock Integrity | Monotonic Clock & Skew Verification | Hardware uptime counter (`SystemClock.elapsedRealtime()`) and GPS epoch verification preventing device time tampering. | Monotonic timestamp at boot, GPS epoch, Server-Time | Clock skew offset $\Delta_{\text{skew}}$; detects tampering | If $|\Delta_{\text{skew}}| > 300\text{s}$, flags record for audit | Survey 2 | **M3** |
| 21 | Notifications | Immediate Arrival Push Notification | Sends instant push notification upon geofence arrival confirming attendance status and check-in time. | `user_id`, computed status, formatted local time | Delivered push notification ("Marked PRESENT at 09:14 AM") | Failed push logged without failing check-in transaction | `TECHNICAL_REQUIREMENTS.md:46-47` | **M2** |
| 22 | Notifications | Pre-Cutoff Expiration Warning Push | Dispatches alert 15 minutes before arrival window closes if user has not yet checked in on an active work day. | Daily cron trigger, user schedule, today's attendance status | Warning push notification dispatched | Suppressed if user already checked in or on LEAVE | `TECHNICAL_REQUIREMENTS.md:48-49` | **M2** |
| 23 | Notifications | Push Device Token Registration | Stores APNs / FCM push notification tokens for the user's mobile device. | `user_id`, `token`, `platform` (iOS/Android) | Stored device token in `push_device_tokens` | 400 Bad Request on invalid token format | `TECHNICAL_REQUIREMENTS.md:46-49, 60` | **M2** |
| 24 | Manual Override | Retroactive Attendance Correction | Allows user to correct or record attendance retroactively (e.g., forgot phone, sensor failure). | `date`, `status`, `check_in_time`, `check_out_time`, mandatory `reason` | Updated `attendance_records` row | 422 Unprocessable Entity if mandatory reason missing | `TECHNICAL_REQUIREMENTS.md:53`, `ORIGINAL_REQUEST.md:18` | **M2** |
| 25 | Audit Trail | Immutable Manual Override Audit Logging | Records detailed audit trail entry for every manual creation or update in `attendance_audit_logs`. | `record_id`, `previous_status`, `new_status`, `previous_times`, `new_times`, `reason` | Persisted immutable `attendance_audit_logs` row | Transaction rolled back if audit write fails | `ORIGINAL_REQUEST.md:30`, `TECHNICAL_REQUIREMENTS.md:53` | **M2** |
| 26 | Client Parity | Interactive Geofence Destination Map | Mobile and Web render equivalent map view showing work pin, circular boundary, address search, and radius slider. | Coordinates, radius slider (50–500m), geocode query | Interactive map rendering boundary polygon | Geocoding failure falls back to coordinate inputs | `ORIGINAL_REQUEST.md:18`, `TECHNICAL_REQUIREMENTS.md:23-28` | **M5** |
| 27 | Client Parity | Schedule Window Configuration UI | Web and Mobile provide identical forms for setting weekly work days, start, end, and cutoff times. | User schedule form inputs | Synchronized backend schedule configuration | Form validation feedback on invalid time ranges | `ORIGINAL_REQUEST.md:18`, `TECHNICAL_REQUIREMENTS.md:32-37` | **M5** |
| 28 | Client Parity | Calendar Heatmap & 52-Week Grid | Displays monthly calendar grid and GitHub-style 52-week activity heatmap color-coded by attendance status. | Month/Year query parameters, date ranges | Color-coded heatmap UI with day detail view modal | Empty state for future or unrecorded months | `ORIGINAL_REQUEST.md:18`, `TECHNICAL_REQUIREMENTS.md:51` | **M5** |
| 29 | Client Parity | Real-Time Attendance Status Widget | Web header and Mobile home screen display today's current status, arrival time, window timer, and sync pill. | Current date attendance query, network queue state | Rendered status badge and connectivity indicator | Fallback to cached state with offline indicator | `ORIGINAL_REQUEST.md:18`, `README.md:20` | **M5** |
| 30 | Data Management | Attendance Data Export & Import | Exports historical records and audit logs to CSV or JSON; imports JSON dumps with relational integrity. | Date range, format (`csv` / `json`), backup payload | Downloadable file stream or restored database | 400 Bad Request on invalid file or schema | `TECHNICAL_REQUIREMENTS.md:54` | **M2** |
| 31 | Self-Hosting | Containerized Server Deployment | Full backend, database, and background worker orchestration via single multi-stage Docker Compose service. | `docker-compose.yml`, environment variables | Running self-hosted services with healthchecks | Container restart policy on unhandled exceptions | `ORIGINAL_REQUEST.md:21, 32` | **M4** |
| 32 | Self-Hosting | Secure Remote Tunneling Integration | Dual exposure architecture: Caddy reverse proxy for VPS; Cloudflare Tunnel (`cloudflared`) for homelab CGNAT bypass. | Tunnel token or Caddy domain configuration | Secure HTTPS endpoint for mobile background check-in | Log warning on tunnel disconnect | `ORIGINAL_REQUEST.md:21, 32` | **M4** |

---

## 4. Monorepo Package Topology

The repository adopts a strict **Turborepo** + **pnpm workspaces** topology. All code is segregated into discrete applications (`apps/`) and shared packages (`packages/`), ensuring unidirectional dependencies and zero circular imports.

```text
AttendanceTracker/
├── apps/
│   ├── server/                  # Centralized Backend (Fastify + SQLite WAL + Drizzle ORM)
│   ├── web/                     # Web Portal (React 18 + Vite + Tailwind CSS + MapLibre GL)
│   └── mobile/                  # Mobile Client (Expo SDK 51+ / React Native + Native Geofences)
├── packages/
│   ├── shared/                  # Universal Zod schemas, TypeScript interfaces, domain logic
│   ├── api-client/              # Strongly-typed fetch SDK wrapping backend REST endpoints
│   ├── tsconfig/                # Shared TypeScript compiler configurations (base, react, node)
│   └── eslint-config/           # Unified linting rules and code style definitions
├── docker/
│   └── Dockerfile               # Multi-stage production container build (Fastify + Vite SPA)
├── Caddyfile                    # Automated TLS reverse proxy configuration for VPS
├── litestream.yml               # Continuous SQLite WAL replication configuration
├── docker-compose.yml           # Production Docker Compose specification (with profiles)
├── docs/
│   ├── ARCHITECTURE.md          # Exhaustive technical system architecture specification
│   ├── CLIENT_PARITY.md         # Comprehensive Mobile vs Web client parity specification
│   └── TECHNICAL_REQUIREMENTS.md # Foundation domain requirements
├── pnpm-workspace.yaml          # Monorepo workspace configuration
├── turbo.json                   # Turborepo task pipeline and caching rules
├── package.json                 # Root dependencies and script entrypoints
└── PROJECT.md                   # Project overview, feature inventory, milestones, contracts
```

### 4.1 Package Roles & Dependencies

```
                    ┌─────────────────────────┐
                    │    packages/tsconfig    │
                    │  packages/eslint-config │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │     packages/shared     │
                    │   (Zod, Types, Logic)   │
                    └────────────┬────────────┘
                                 │
                   ┌─────────────┴─────────────┐
                   ▼                           ▼
        ┌─────────────────────┐     ┌─────────────────────┐
        │ packages/api-client │     │     apps/server     │
        │   (Typed HTTP SDK)  │     │  (Fastify + SQLite) │
        └──────────┬──────────┘     └─────────────────────┘
                   │
         ┌─────────┴─────────┐
         ▼                   ▼
┌─────────────────┐ ┌─────────────────┐
│    apps/web     │ │   apps/mobile   │
│  (React / Vite) │ │  (Expo SDK 51)  │
└─────────────────┘ └─────────────────┘
```

1. **`packages/shared`**:
   - Zero external runtime dependencies beyond `zod`.
   - Exports domain validation schemas (`LocationConfigSchema`, `ScheduleConfigSchema`, `GeofenceEventPayloadSchema`, `AttendanceRecordSchema`, `ManualOverrideSchema`).
   - Exports derived TypeScript types (`LocationConfig`, `ScheduleConfig`, `AttendanceRecord`, `AttendanceStatus`, etc.).
   - Exports pure mathematical logic: `computeAttendanceStatus()`, `haversineDistance()`, `isArrivalWithinWindow()`.
2. **`packages/api-client`**:
   - Consumed by `apps/web` and `apps/mobile`.
   - Instantiates a typed HTTP client wrapping native `fetch`.
   - Validates server responses against `packages/shared` schemas.
   - Automatically injects JWT session cookies (browser) or Bearer API tokens (mobile).
3. **`apps/server`**:
   - Node.js 20 LTS running Fastify v4+.
   - Embedded SQLite 3 with WAL mode enabled via `better-sqlite3` and `drizzle-orm`.
   - Directly imports validation schemas from `packages/shared` for route request validation and response serialization.
   - Hosts static web assets from `apps/web` in single-container production mode.
4. **`apps/web`**:
   - Single-Page Application (SPA) built with React 18, Vite, and Tailwind CSS.
   - MapLibre GL for desktop/browser interactive geofencing.
   - Full calendar heatmap, manual override drawer, and schedule editor.
5. **`apps/mobile`**:
   - React Native application built with Expo SDK 51+ (Custom Development Build).
   - Utilizes `expo-location` and `expo-task-manager` for native iOS `CLCircularRegion` and Android `GeofenceManager`.
   - Embedded `expo-sqlite` for durable offline event queuing and replay.
   - `react-native-maps` for mobile destination setup.

---

## 5. Interface Contracts Summary

All client-server interactions adhere to strict, typed contracts formalized in `packages/shared`.

### 5.1 Authentication Contracts
- **Web Client**: Form submission (`POST /api/v1/auth/login`) verified against Argon2id master hash. Server responds with HTTP-only, `SameSite=Strict`, `Secure` session cookie containing signed JWT (14-day validity).
- **Mobile Client**: Transmits pre-shared cryptographically generated 64-character token via header:
  ```http
  Authorization: Bearer <DEVICE_API_TOKEN>
  ```
  The token is provisioned during initial setup, persisted in iOS Keychain / Android Keystore (`expo-secure-store`), and used exclusively by headless background daemons.

### 5.2 Geofence Event Ingestion Contract (`POST /api/v1/attendance/events`)
*(Backward-compatible alias: `POST /api/v1/attendance/check-in`)*
- **Request Payload**:
  ```typescript
  export interface GeofenceEventRequest {
    event_id: string;               // UUIDv4 generated by client at event capture (alias: idempotency_key)
    user_id?: string;               // System user ID asserting attendance
    event_type: "ENTER" | "EXIT" | "DWELL"; // Boundary transition classification
    occurred_at: string;            // ISO 8601 UTC timestamp (e.g. "2026-11-05T09:14:22.123Z")
    source: "GEOFENCE" | "WIFI_AUTO" | "MANUAL";
    latitude?: number;              // WGS 84 float [-90.0, 90.0]
    longitude?: number;             // WGS 84 float [-180.0, 180.0]
    accuracy_meters?: number;       // Sensor radius accuracy in meters
    client_dispatch_time?: string;  // ISO 8601 UTC timestamp at HTTP transmission
    wifi_ssid?: string;             // Connected SSID if triggered via Wi-Fi fallback
    wifi_bssid?: string;            // Connected BSSID router MAC address
    device_id?: string;             // Hardware identifier or platform label
    monotonic_timestamp_ms?: number;// Device monotonic uptime in milliseconds
  }
  ```
- **Response Payload**:
  ```typescript
  export interface AttendanceEvaluationResponse {
    event_status: "CREATED" | "ALREADY_RECORDED" | "CHECK_OUT_UPDATED" | "RECONCILED_ABSENCE_OVERWRITTEN" | "IGNORED_NO_CHECK_IN" | "NON_WORK_DAY_RECORDED";
    record: AttendanceRecord | null;
    message?: string;
    notification_dispatched?: boolean;
    server_time?: string;           // Authoritative server UTC timestamp for clock sync
  }
  ```

### 5.3 Manual Adjustment Contract (`PATCH /api/v1/attendance/records/:date`)
- **Request Payload**:
  ```typescript
  export interface ManualOverrideRequest {
    status: "PRESENT" | "LATE" | "ABSENT" | "LEAVE" | "WFH";
    check_in_time?: string | null;  // ISO 8601 string or null
    check_out_time?: string | null; // ISO 8601 string or null
    reason: string;                 // Mandatory justification (min 5 characters)
    client_source: "WEB_PORTAL" | "MOBILE_APP";
  }
  ```

---

## 6. Code Layout & Repository Standards

### 6.1 Directory Conventions
- **Source Files**: All application and package source code resides strictly in `apps/<app_name>/src/` or `packages/<pkg_name>/src/`.
- **Test Co-Location**: Unit tests are co-located directly with source units using the `*.test.ts` or `*.spec.tsx` naming convention (e.g. `src/logic/status.ts` and `src/logic/status.test.ts`). Integration and system tests reside in dedicated `test/` directories within each package.
- **Agent Metadata Boundary**: The directory `.agents/teamwork/` is strictly reserved for agent coordination metadata (plans, dispatches, briefings, handoffs). **No source code, test files, or application assets may ever be written to `.agents/teamwork/`.**

### 6.2 Quality & Integrity Guidelines
- **Zero Dummy Implementations**: All business logic, database transactions, geofence computations, and API validations must be genuinely implemented. Hardcoding mock data, stubbing test outputs, or fabricating audit logs is strictly prohibited.
- **Verification Commands**:
  - Full workspace build: `pnpm build` (delegated via Turborepo)
  - Unit and integration tests: `pnpm test` (invoking `vitest`)
  - Type checking across all workspaces: `pnpm type-check` (invoking `tsc --noEmit`)
  - Code formatting & linting: `pnpm lint`
