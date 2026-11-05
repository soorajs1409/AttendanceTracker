# Technical Requirements & Architectural Foundation

> **Status**: Historical Requirements Baseline & Specification Index  
> **Authoritative Successor Documentation**: This document outlines the original foundation requirements and technical feasibility baseline. Each functional area has been fully expanded into dedicated, production-grade technical specifications linked in the **Architectural Specification Index** below.

---

## 1. Architectural Specification Index

The high-level requirements in this document have been refined and finalized into the following authoritative specification documents:

| Architectural Domain | Authoritative Specification Document | Primary Coverage & Successor Scope |
| :--- | :--- | :--- |
| **Master Specification & Inventory** | [`PROJECT.md`](../PROJECT.md) | Exhaustive 32-feature domain inventory, milestone roadmap (M1–M5), single-user philosophy, and workspace contracts. |
| **System Architecture** | [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) | Component interaction diagrams, monorepo topology (`pnpm` + Turborepo), data flow sequence diagrams, and DDL schema. |
| **Client Feature Parity** | [`docs/CLIENT_PARITY.md`](CLIENT_PARITY.md) | The 5 core parity pillars (Interactive Map, Schedule Matrix, 52-Week Heatmap, Manual Overrides, and Live Status Banner). |
| **Backend & Service Engine** | [`docs/BACKEND_SPEC.md`](BACKEND_SPEC.md) | Fastify server lifecycle, embedded SQLite WAL engine, idempotency state machine, Croner scheduling, and notification engine. |
| **Database Architecture** | [`docs/DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md) | Detailed SQLite 3 PRAGMAs, Drizzle ORM TypeScript models, relational indexing, and zero-lock snapshot backup strategies. |
| **REST API & Contracts** | [`docs/API_SPECIFICATION.md`](API_SPECIFICATION.md) | OpenAPI 3.1 contracts, RFC 9457 Problem Details error models, Bearer Token and JWT cookie authentication, and payload schemas. |
| **Mobile Geofencing Mechanics** | [`docs/GEOFENCING_MECHANICS.md`](GEOFENCING_MECHANICS.md) | iOS `CLCircularRegion`, Android `GeofencingClient`, Expo `TaskManager` global scope, local SQLite offline queue, and clock integrity. |
| **Self-Hosting & Operations** | [`docs/SELF_HOSTING.md`](SELF_HOSTING.md) | Multi-stage Docker containerization, Cloudflare Tunnels (CGNAT bypass), Caddy reverse proxy (Auto TLS), and Litestream backups. |
| **Implementation Roadmap** | [`docs/IMPLEMENTATION_ROADMAP.md`](IMPLEMENTATION_ROADMAP.md) | Phased, actionable 8-phase engineering roadmap from monorepo initialization to end-to-end verification and hardening. |

---

## 2. System Objectives
Build an automated single-user attendance management system combining:
1. A **Mobile App** running native background geofence triggers to automatically register presence upon arriving at the workplace within a designated time window.
2. A **Web Portal** providing an interactive map to define work destinations, customize arrival schedules, review monthly calendar heatmaps, and export records.

---

## 3. Technical Feasibility & Background Tracking Rules

### The Mobile Background Geofence Imperative
- **Web Limitations**: Modern mobile browsers (Safari on iOS, Chrome on Android) strictly suspend web workers and Geolocation API polling once the browser tab loses focus or the phone screen turns off. PWAs cannot execute background geofences reliably.
- **Native OS Geofencing Solution**:
  - iOS: `CoreLocation` framework (`CLCircularRegion`, monitored via background app refresh / location manager).
  - Android: `GeofenceManager` (Google Play Services Geofencing API).
  - Energy profile: Uses cell tower and Wi-Fi SSID trilateration until within range; only spins up hardware GPS upon entering the near-boundary zone.
  - *Detailed Mechanics*: See [`docs/GEOFENCING_MECHANICS.md`](GEOFENCING_MECHANICS.md).

---

## 4. Core Feature Specifications

### 4.1 Work Location Configuration
- **Geocoding & Map Selection**: Search address or drop pin on map.
- **Coordinates & Radius**:
  - `latitude`: Floating point (WGS 84).
  - `longitude`: Floating point (WGS 84).
  - `radius`: In meters (Default: `100m`, range: `50m` to `500m`).
- **Wi-Fi BSSID/SSID Verification (Optional Fallback)**:
  - If the workplace has poor GPS reception (e.g. basement, high-rise interior), connection to the workplace Wi-Fi can serve as a secondary confirmation trigger.
  - *Parity Specification*: See [`docs/CLIENT_PARITY.md § Pillar 1`](CLIENT_PARITY.md).

### 4.2 Schedule & Arrival Time Window
- **Daily Configuration**:
  - Active work days: e.g., Monday through Friday.
  - Window Start Time: e.g., `09:00 AM`.
  - Window End Time: e.g., `10:00 AM`.
  - Grace / Late Cutoff: e.g., `11:30 AM`.
- **Status Computation Logic**:
  - Arrive within `[Window Start, Window End]` $\rightarrow$ **PRESENT**
  - Arrive within `(Window End, Grace Cutoff]` $\rightarrow$ **LATE**
  - No arrival registered by day end $\rightarrow$ **ABSENT**
  - Manually marked planned absence $\rightarrow$ **LEAVE / SICK / WFH**
- **Idempotency Guarantee**:
  - Multiple entries and exits throughout the day (e.g., leaving for lunch) do not overwrite the initial check-in time or alter the attendance status.
  - *Calculation Details*: See [`docs/ARCHITECTURE.md § 3.3`](ARCHITECTURE.md).

### 4.3 Confirmation & Notifications
- Instant push notification upon geofence entry: "*Good morning! Marked PRESENT at 09:14 AM.*"
- Warning notification 15 minutes prior to window expiration if not yet checked in.
- *Push Infrastructure*: See [`docs/BACKEND_SPEC.md § 8`](BACKEND_SPEC.md).

### 4.4 Web Dashboard & Analytics
- Monthly calendar view with color-coded day markers (Present, Late, Absent, Leave).
- Summary statistics: On-time percentage, average arrival time, monthly streak counter.
- Dispute / Manual Adjustment tool: Allows the user to retroactively correct an entry with an audit reason (e.g., forgot phone, sensor failure).
- Export to CSV / JSON format.
- *Dashboard Parity*: See [`docs/CLIENT_PARITY.md § Pillar 3 & 4`](CLIENT_PARITY.md).

---

## 5. Technology Stack Decisions

During architectural evaluation, the stack was finalized as follows:

- **Mobile Client**: React Native with Expo SDK 51+ Custom Development Client (`expo-location`, `expo-task-manager`, `expo-sqlite`, `expo-notifications`, `react-native-maps`).
- **Web Dashboard**: React 18 SPA built with Vite, Tailwind CSS, MapLibre GL, and lucide-react.
- **Backend API & Database**: **Option B (Custom Self-Hosted)** was selected for optimal resource efficiency and privacy sovereignty:
  - Fastify Node.js 20 LTS.
  - In-process SQLite 3 with Write-Ahead Logging (`better-sqlite3`) managed via Drizzle ORM.
  - Sub-65MB RAM footprint in single Docker container.
- **Codebase Organization**: Strict Monorepo structure using **pnpm workspaces** and **Turborepo** (`apps/server`, `apps/web`, `apps/mobile`, `packages/shared`, `packages/api-client`, `packages/tsconfig`).
- *Architecture Blueprint*: See [`docs/ARCHITECTURE.md`](ARCHITECTURE.md).

---

## 6. Foundation Data Schema

*(Refined and implemented in [`docs/DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md) and `apps/server/src/db/schema.ts`)*

### Table: `user_settings`
- `id` (UUID, Primary Key)
- `timezone` (VARCHAR, e.g. "Asia/Kolkata")
- `created_at` (TIMESTAMP)

### Table: `location_configs`
- `id` (UUID, Primary Key)
- `user_id` (UUID, Foreign Key)
- `name` (VARCHAR, e.g. "Headquarters")
- `latitude` (DOUBLE PRECISION)
- `longitude` (DOUBLE PRECISION)
- `radius_meters` (INTEGER, default 100)
- `wifi_ssid` (VARCHAR, nullable)
- `is_active` (BOOLEAN, default true)

### Table: `schedule_configs`
- `id` (UUID, Primary Key)
- `user_id` (UUID, Foreign Key)
- `day_of_week` (INTEGER, 0=Sun ... 6=Sat)
- `window_start` (TIME)
- `window_end` (TIME)
- `late_cutoff` (TIME)
- `is_work_day` (BOOLEAN)

### Table: `attendance_records`
- `id` (UUID, Primary Key)
- `user_id` (UUID, Foreign Key)
- `date` (DATE)
- `check_in_time` (TIMESTAMP WITH TIME ZONE)
- `check_out_time` (TIMESTAMP WITH TIME ZONE, nullable)
- `status` (ENUM: `PRESENT`, `LATE`, `ABSENT`, `LEAVE`, `WFH`)
- `source` (ENUM: `GEOFENCE`, `WIFI_AUTO`, `MANUAL`)
- `check_in_lat` (DOUBLE PRECISION, nullable)
- `check_in_lng` (DOUBLE PRECISION, nullable)
- `notes` (TEXT, nullable)
- `created_at` (TIMESTAMP)

### Table: `attendance_audit_logs` (Added in Final Architecture)
- `id` (UUID, Primary Key)
- `attendance_record_id` (UUID, Foreign Key)
- `action` (ENUM: `CREATE`, `UPDATE`, `DELETE`)
- `previous_status` (TEXT, nullable)
- `new_status` (TEXT)
- `previous_check_in_time` (TIMESTAMP, nullable)
- `new_check_in_time` (TIMESTAMP, nullable)
- `reason` (TEXT, Mandatory $\ge 5$ chars)
- `client_source` (ENUM: `WEB_PORTAL`, `MOBILE_APP`)
- `created_at` (TIMESTAMP)

### Table: `push_device_tokens` (Added in Final Architecture)
- `id` (UUID, Primary Key)
- `user_id` (UUID, Foreign Key)
- `device_token` (TEXT)
- `platform` (ENUM: `IOS`, `ANDROID`)
- `is_active` (BOOLEAN, default true)
- `created_at` (TIMESTAMP)
