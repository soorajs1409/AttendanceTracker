# Technical Requirements & Specification

## 1. System Objectives
Build an automated single-user attendance management system combining:
1. A **Mobile App** running native background geofence triggers to automatically register presence upon arriving at the workplace within a designated time window.
2. A **Web Portal** providing an interactive map to define work destinations, customize arrival schedules, review monthly calendar heatmaps, and export records.

---

## 2. Technical Feasibility & Background Tracking Rules

### The Mobile Background Geofence Imperative
- **Web Limitations**: Modern mobile browsers (Safari on iOS, Chrome on Android) strictly suspend web workers and Geolocation API polling once the browser tab loses focus or the phone screen turns off. PWAs cannot execute background geofences reliably.
- **Native OS Geofencing Solution**:
  - iOS: `CoreLocation` framework (`CLCircularRegion`, monitored via background app refresh / location manager).
  - Android: `GeofenceManager` (Google Play Services Geofencing API).
  - Energy profile: Uses cell tower and Wi-Fi SSID trilateration until within range; only spins up hardware GPS upon entering the near-boundary zone.

---

## 3. Core Feature Specifications

### 3.1 Work Location Configuration
- **Geocoding & Map Selection**: Search address or drop pin on map.
- **Coordinates & Radius**:
  - `latitude`: Floating point (WGS 84).
  - `longitude`: Floating point (WGS 84).
  - `radius`: In meters (Default: `100m`, range: `50m` to `500m`).
- **Wi-Fi BSSID/SSID Verification (Optional Fallback)**:
  - If the workplace has poor GPS reception (e.g. basement, high-rise interior), connection to the workplace Wi-Fi can serve as a secondary confirmation trigger.

### 3.2 Schedule & Arrival Time Window
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

### 3.3 Confirmation & Notifications
- Instant push notification upon geofence entry: "*Good morning! Marked PRESENT at 09:14 AM.*"
- Warning notification 15 minutes prior to window expiration if not yet checked in.

### 3.4 Web Dashboard & Analytics
- Monthly calendar view with color-coded day markers (Present, Late, Absent, Leave).
- Summary statistics: On-time percentage, average arrival time, monthly streak counter.
- Dispute / Manual Adjustment tool: Allows the user to retroactively correct an entry with an audit reason (e.g., forgot phone, sensor failure).
- Export to CSV / JSON format.

---

## 4. Proposed Technology Stack

- **Mobile Client**: React Native with Expo (`expo-location`, `expo-task-manager`, `expo-notifications`).
- **Web Dashboard**: Next.js / Vite + React + Tailwind CSS + Mapbox GL / Leaflet + shadcn/ui.
- **Backend API & Database Options**:
  - *Option A (Fastest to Launch)*: Supabase (PostgreSQL with Row-Level Security, Edge Functions, automated REST/GraphQL APIs, Push Webhooks).
  - *Option B (Custom Self-Hosted)*: Python FastAPI or Node.js Fastify + SQLite/PostgreSQL with Docker containerization.
- **Codebase Organization**: Monorepo structure (e.g., Turborepo / npm workspaces) sharing schemas and types across web, mobile, and backend.

---

## 5. Data Schema

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
- `source` (ENUM: `GEOFENCE_AUTO`, `WIFI_AUTO`, `MANUAL`)
- `check_in_lat` (DOUBLE PRECISION, nullable)
- `check_in_lng` (DOUBLE PRECISION, nullable)
- `notes` (TEXT, nullable)
- `created_at` (TIMESTAMP)
