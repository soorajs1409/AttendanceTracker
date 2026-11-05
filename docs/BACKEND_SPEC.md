# Backend Architecture & Technical Specification

## 1. Executive Summary & Purpose

The Attendance Tracker backend is a lightweight, single-user, self-hosted centralized service engineered to coordinate automated attendance tracking between a cross-platform mobile client (iOS / Android via Expo) and a responsive desktop/mobile web portal (React / Vite).

### Core Responsibilities
1. **Event Ingestion**: Ingest native OS geofence entry/exit events and Wi-Fi connection triggers with strict idempotency and microsecond-level atomic database transactions.
2. **Attendance Evaluation**: Evaluate UTC arrival timestamps against user-configured IANA timezones and weekly schedule windows to deterministically assign attendance states (`PRESENT`, `LATE`, `ABSENT`, `LEAVE`, `WFH`).
3. **Audit & Reconciliation**: Support manual adjustments with mandatory justification logging in an append-only audit trail, while executing background cron reconciliation for unrecorded days.
4. **Notification Dispatch**: Push immediate arrival confirmations and pre-deadline warnings to mobile devices via the Expo Push Notification Service and optional self-hosted `ntfy` webhooks.
5. **Unified Hosting**: Serve both the REST API (`/api/v1/*`) and compiled static web portal assets (`/*`) within a single, low-memory Docker container consuming less than 65 MB of RAM under load.

---

## 2. Technology Stack & Framework Selection

| Layer | Selected Technology | Version | Rationale & Architectural Justification |
| :--- | :--- | :--- | :--- |
| **Runtime** | Node.js | v20 LTS (`iron`) | High-performance V8 engine, native `fetch`, native `crypto.subtle`, stable long-term maintenance. |
| **Language** | TypeScript | v5.4+ | End-to-end type safety shared directly across monorepo packages (`@attendance/shared`). |
| **HTTP Framework** | Fastify | v4.26+ / v5.x | 2–3x throughput of Express, native async/await plugin encapsulation, schema-based fast serialization. |
| **Database Engine** | SQLite 3 (`better-sqlite3`) | v9.4+ / v11.x | In-process zero-latency embedded database, WAL mode for concurrent reads, zero container overhead. |
| **ORM / Query Builder** | Drizzle ORM | v0.30+ | Zero-overhead type-safe query builder with direct SQL compilation and automatic migration generation via `drizzle-kit`. |
| **Validation** | Zod | v3.23+ | Shared schema validation compiled for runtime validation and static TypeScript inference across web, mobile, and server. |
| **Password Hashing** | Argon2id (`argon2`) | v0.40+ | Winner of Password Hashing Competition; resistant to GPU/ASIC brute-force attacks via memory-hard cost parameters. |
| **Scheduling Engine** | Croner | v8.0+ | Modern, memory-efficient in-process job scheduler with full IANA timezone support, zero external process dependencies. |
| **Logging** | Pino | v8.19+ | High-speed, structured JSON logger natively integrated into Fastify request/reply lifecycle. |

---

## 3. High-Level System Architecture

```
┌───────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                         CLIENT APPLICATIONS                                           │
│                                                                                                       │
│   ┌─────────────────────────────────────────┐         ┌───────────────────────────────────────────┐   │
│   │               Mobile App                │         │                Web Portal                 │   │
│   │         (Expo / React Native)           │         │         (Vite + React 18 + SPA)           │   │
│   │  - Background Geofencing (CoreLocation) │         │  - Interactive Geofence Map (MapLibre)    │   │
│   │  - Wi-Fi SSID / BSSID Sniffer           │         │  - Schedule & Window Configuration UI     │   │
│   │  - Bearer API Token (KeyStore/Keychain) │         │  - Calendar Heatmaps & Export Tools       │   │
│   │  - Offline Event Queue (SQLite Cache)   │         │  - Argon2id Password Auth (Session Cookie)│   │
│   └─────────────────────────────────────────┘         └───────────────────────────────────────────┘   │
└────────────────────────────────────┬───────────────────────────────────────┬──────────────────────────┘
                                     │                                       │
                      HTTP / HTTPS   │ (Bearer Token)                        │ (HttpOnly Session Cookie)
                                     ▼                                       ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               FASTIFY CENTRALIZED SERVER (Node.js 20)                                 │
│                                                                                                       │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                       Fastify Middleware Pipeline                               │  │
│  │   @fastify/helmet  ──>  @fastify/cors  ──>  @fastify/rate-limit  ──>  @fastify/cookie & jwt     │  │
│  └─────────────────────────────────────────────────┬───────────────────────────────────────────────┘  │
│                                                    │                                                  │
│                                                    ▼                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                  Authentication & Authorization Gate                            │  │
│  │     - Session Cookie (Web) <OR> Bearer Token (Mobile) verified against user_settings            │  │
│  └─────────────────────────────────────────────────┬───────────────────────────────────────────────┘  │
│                                                    │                                                  │
│       ┌────────────────────────────────────────────┼────────────────────────────────────────┐         │
│       ▼                                            ▼                                        ▼         │
│  ┌──────────────────────────┐             ┌──────────────────────────┐            ┌─────────────────┐ │
│  │    Ingestion Engine      │             │  Records & Override API  │            │  Static Server  │ │
│  │  - Single Event Ingestion│             │  - Date Range Filtering  │            │  - Serves Web   │ │
│  │  - Batch Offline Replay  │             │  - Manual Dispute Adjust │            │    SPA assets   │ │
│  │  - Idempotency Gate      │             │  - Immutable Audit Log   │            │    via Fastify  │ │
│  └────────────┬─────────────┘             └────────────┬─────────────┘            └─────────────────┘ │
│               │                                        │                                              │
│               ▼                                        ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                    Attendance Decision Engine                                   │  │
│  │     - Evaluates UTC timestamps against user IANA Timezone                                       │  │
│  │     - Matches arrival time against daily schedule windows: PRESENT, LATE, or ABSENT             │  │
│  └─────────────────────────────────────────────────┬───────────────────────────────────────────────┘  │
│                                                    │                                                  │
│                                                    ▼                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                 Drizzle ORM & Better-SQLite3 Driver                             │  │
│  │     - In-process SQLite 3 database operating in Write-Ahead Logging (WAL) Mode                  │  │
│  │     - Strict ACID isolation, 5000ms busy timeout, memory-cached indexes                         │  │
│  └─────────────────────────────────────────────────┬───────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┼──────────────────────────────────────────────────┘
                                                     │
                                                     ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       STORAGE & EXTERNAL SERVICES                                     │
│                                                                                                       │
│   ┌─────────────────────────────────────────┐         ┌───────────────────────────────────────────┐   │
│   │         SQLite 3 Database File          │         │            Push Notification API          │   │
│   │         (/data/attendance.db)           │         │         (Expo Push / APNs / FCM)          │   │
│   │  - user_settings                        │         │  - "Good morning! Marked PRESENT at 09:14"│   │
│   │  - location_configs                     │         │  - "Warning: Arrival window closes in 15m"│   │
│   │  - schedule_configs                     │         └───────────────────────────────────────────┘   │
│   │  - attendance_records                   │                                                         │
│   │  - attendance_audit_logs                │         ┌───────────────────────────────────────────┐   │
│   │  - push_device_tokens                   │         │          Secondary Webhook Relay          │   │
│   └─────────────────────────────────────────┘         │        (Self-Hosted ntfy / Gotify)        │   │
│                                                       └───────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Server Lifecycle & Plugin Architecture

The Fastify instance initializes through a strictly ordered plugin registration lifecycle ensuring security policies, database connections, and validation hooks are active before any route is handled.

### 4.1 Monorepo Application Structure (`apps/server`)

```text
apps/server/
├── src/
│   ├── app.ts                  # Fastify application factory & plugin registration
│   ├── server.ts               # Process entry point, port binding, and graceful shutdown
│   ├── config/
│   │   └── env.ts              # Zod-validated environment variables
│   ├── db/
│   │   ├── client.ts           # better-sqlite3 connection with WAL pragmas
│   │   ├── schema.ts           # Drizzle ORM table definitions
│   │   └── migrate.ts          # Automatic startup migration runner
│   ├── plugins/
│   │   ├── auth.ts             # Combined Session Cookie + Bearer Token auth decorator
│   │   ├── sensible.ts         # Fastify sensible HTTP error utilities
│   │   ├── swagger.ts          # OpenAPI 3.1 & Swagger UI registration
│   │   └── static.ts           # Static SPA delivery & SPA fallback routing
│   ├── modules/
│   │   ├── auth/               # Login, logout, token rotation handlers & routes
│   │   ├── attendance/         # Check-in, batch ingest, manual override, daily query
│   │   ├── schedules/          # Schedule configuration CRUD
│   │   ├── locations/          # Geofence location configuration CRUD
│   │   ├── analytics/          # Streak calculation, on-time percentage, stats
│   │   ├── export/             # CSV and JSON historical record streaming
│   │   └── notifications/      # Push token registration and test dispatches
│   ├── services/
│   │   ├── attendance-eval.ts  # Pure status computation logic (shared-compatible)
│   │   ├── notification.ts     # Expo Push and ntfy dispatch engine
│   │   └── timezone.ts         # IANA timezone conversion & date string formatting
│   └── jobs/
│       ├── scheduler.ts        # Croner scheduler manager
│       ├── absentee-reconcile.ts # Midnight/cutoff absence reconciliation
│       ├── pre-cutoff-warning.ts # 15-minute window expiration reminder
│       └── backup-maintenance.ts # Nightly WAL checkpoint & VACUUM INTO backup
├── package.json
└── tsconfig.json
```

### 4.2 Fastify Plugin Registration Flow

```typescript
// src/app.ts (Architectural Blueprint)
import Fastify, { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import sensible from '@fastify/sensible';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import path from 'node:path';

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
    },
    trustProxy: true, // Required behind Caddy / Cloudflare Tunnels
    disableRequestLogging: false,
  });

  // 1. Error Utilities
  await app.register(sensible);

  // 2. Security Headers (Helmet)
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // Permitted for bundled Vite scripts
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org'],
        connectSrc: ["'self'", 'https://*.tile.openstreetmap.org'],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  // 3. CORS Configuration
  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow mobile app (origin null or custom scheme) and local web dev
      if (!origin || origin.startsWith('http://localhost') || origin === config.PUBLIC_URL) {
        cb(null, true);
        return;
      }
      cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
  });

  // 4. Rate Limiting (Global and Path-Specific)
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
  });

  // 5. Cookies & JWT Authentication
  await app.register(cookie, {
    secret: config.COOKIE_SECRET,
    hook: 'onRequest',
  });

  await app.register(jwt, {
    secret: config.JWT_SECRET,
    cookie: {
      cookieName: 'session_token',
      signed: true,
    },
  });

  // 6. OpenAPI Documentation Generation
  if (config.NODE_ENV !== 'production') {
    await app.register(swagger, {
      openapi: {
        info: {
          title: 'Attendance Tracker API',
          version: '1.0.0',
          description: 'Single-user automated attendance tracking REST API',
        },
        servers: [{ url: '/api/v1' }],
      },
    });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  // 7. Domain Modules Registration
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(attendanceRoutes, { prefix: '/api/v1/attendance' });
  await app.register(scheduleRoutes, { prefix: '/api/v1/schedules' });
  await app.register(locationRoutes, { prefix: '/api/v1/locations' });
  await app.register(analyticsRoutes, { prefix: '/api/v1/analytics' });
  await app.register(exportRoutes, { prefix: '/api/v1/attendance/export' });
  await app.register(notificationRoutes, { prefix: '/api/v1/notifications' });
  await app.register(healthRoutes, { prefix: '/api/v1/health' });

  // 8. Static Web SPA Assets Delivery (Production)
  if (config.NODE_ENV === 'production') {
    await app.register(fastifyStatic, {
      root: path.join(__dirname, '../../web/dist'),
      prefix: '/',
    });

    // SPA Fallback: Any non-API route returns index.html for client routing
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api')) {
        reply.code(404).send({ error: 'Not Found', message: `Route ${request.url} does not exist` });
      } else {
        reply.sendFile('index.html');
      }
    });
  }

  return app;
}
```

---

## 5. Single-User Authentication Architecture

The system is dedicated to a single owner, requiring an authentication model that balances strict security with frictionless automation for headless background geofence triggers.

```
                     ┌───────────────────────────────────────────────┐
                     │          Incoming HTTP Request                │
                     └───────────────────────┬───────────────────────┘
                                             │
                                             ▼
                     ┌───────────────────────────────────────────────┐
                     │   Header: "Authorization: Bearer <TOKEN>" ?   │
                     └───────┬───────────────────────────────┬───────┘
                             │ YES                           │ NO
                             ▼                               ▼
     ┌──────────────────────────────────┐   ┌──────────────────────────────────┐
     │ Hash incoming token (SHA-256)    │   │  Cookie: "session_token" exists? │
     │ Compare with DB api_token_hash   │   └───────┬──────────────────┬───────┘
     │ using crypto.timingSafeEqual     │           │ YES              │ NO
     └───────┬──────────────────┬───────┘           │                  ▼
             │ MATCH            │ FAIL              ▼         ┌─────────────────┐
             │                  │           ┌──────────────┐  │ 401 Unauthorized│
             ▼                  ▼           │ Verify JWT   │  └─────────────────┘
     ┌───────────────┐  ┌───────────────┐   │ Session Sign │
     │ request.auth =│  │401 Invalid    │   └───────┬──────┘
     │ {type: MOBILE}│  │Bearer Token   │           │ VALID
     └───────┬───────┘  └───────────────┘           ▼
             │                             ┌─────────────────┐
             │                             │ request.auth =  │
             │                             │ {type: WEB}     │
             │                             └────────┬────────┘
             │                                      │
             └──────────────────┬───────────────────┘
                                │
                                ▼
             ┌─────────────────────────────────────┐
             │  Execute Protected Route Handler    │
             └─────────────────────────────────────┘
```

### 5.1 Dual-Credential Model

#### 1. Web Portal: Argon2id Passphrase & Session Cookies
- **Credential**: Master user password stored as an **Argon2id** hash in `user_settings.password_hash`.
- **Argon2id Parameters**:
  - Algorithm: Argon2id (Type 2)
  - Memory Cost: `65536` KiB (64 MiB)
  - Time Cost: `3` iterations
  - Parallelism: `4` threads
- **Session Issuance**:
  - `POST /api/v1/auth/login` verifies the password using `argon2.verify(hash, password)`.
  - On success, issues a signed JWT session cookie named `session_token`.
  - Cookie Attributes: `HttpOnly=true`, `Secure=true` (in production/HTTPS), `SameSite=Strict`, `Path=/`, `Max-Age=1209600` (14 days).
  - Sliding Window: When a request is authenticated with less than 3 days remaining, a refreshed cookie is re-issued in the `onSend` hook.

#### 2. Mobile App: High-Entropy Pre-Shared API Token
- **Credential**: Cryptographically random 256-bit token generated via `crypto.randomBytes(32).toString('hex')` (64 hexadecimal characters).
- **Storage**:
  - Client: Securely stored in hardware-backed keystore via `expo-secure-store` (iOS Keychain / Android Keystore).
  - Server: Hashed with SHA-256 and stored in `user_settings.api_token_hash`. Verification uses constant-time comparison (`crypto.timingSafeEqual`) to prevent side-channel timing attacks.
- **Biometric Protection**:
  - The mobile app UI implements an optional biometric gate (Face ID / Fingerprint via `expo-local-authentication`) before rendering dashboards or configuration screens.
  - Headless background geofencing tasks retrieve the token directly from `expo-secure-store` without invoking a biometric prompt, enabling 100% automated arrival check-ins while the phone is locked.
- **Token Rotation**:
  - The web portal allows the owner to rotate the mobile API token at any time via `POST /api/v1/auth/token/rotate`.
  - Generates a new 64-char token, stores the new SHA-256 hash in `user_settings`, invalidates old tokens, and renders a one-time QR code for mobile scanning.

---

## 6. Check-In Idempotency Engine & Concurrency Control

In real-world environments, mobile devices walking along geofence perimeters or reconnecting to office Wi-Fi can trigger multiple duplicate arrival events within seconds. Furthermore, users leaving the office for lunch must not have their morning check-in time overwritten.

### 6.1 Database-Level Idempotency Guarantees
1. **Composite Unique Index**:
   ```sql
   CREATE UNIQUE INDEX idx_attendance_records_user_date ON attendance_records (user_id, date);
   ```
   Ensures that only **one primary record** can ever exist for a given user on a calendar day.
2. **Client-Generated Idempotency Key**:
   - Every geofence arrival event payload includes an `idempotency_key` (UUID v4) generated by the mobile background task at the instant the OS geofence trigger fires.
   - If network re-transmissions occur, duplicate HTTP requests submit identical idempotency keys.

### 6.2 Atomic Event Processing Flow

```
                      Client submits POST /api/v1/attendance/events
                                         │
                                         ▼
                 ┌──────────────────────────────────────────────┐
                 │  Extract user_settings: IANA timezone        │
                 │  Convert occurred_at (UTC) to localized date │
                 │  `YYYY-MM-DD` and local time `HH:MM:SS`      │
                 └───────────────────────┬──────────────────────┘
                                         │
                                         ▼
                 ┌──────────────────────────────────────────────┐
                 │  BEGIN IMMEDIATE TRANSACTION                 │
                 │  (Locks SQLite writer, ensures ACID)         │
                 └───────────────────────┬──────────────────────┘
                                         │
                                         ▼
                 ┌──────────────────────────────────────────────┐
                 │  SELECT * FROM attendance_records            │
                 │  WHERE user_id = :userId AND date = :date    │
                 └───────────────────────┬──────────────────────┘
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   │ Record Exists?                            │
                   ├─────────────────────────┬─────────────────┤
                   │ YES                     │ NO              │
                   ▼                         ▼                 │
     ┌────────────────────────────┐    ┌───────────────────────────────┐
     │ Status is LEAVE or WFH?    │    │ Query schedule_configs for    │
     ├──────────────┬─────────────┤    │ day_of_week(localized_date)   │
     │ YES          │ NO          │    └───────────────┬───────────────┘
     ▼              ▼                                  │
┌──────────────┐ ┌───────────────────────────┐         ▼
│ Suppress     │ │ Event Type is 'EXIT'?     │ ┌───────────────────────────────┐
│ auto-mutate. │ ├─────────────┬─────────────┤ │ Is is_work_day == true?       │
│ Return 200   │ │ YES         │ NO (ENTER)  │ ├───────────────┬───────────────┤
│ with status  │ ▼             ▼             │ │ YES           │ NO (Weekend)  │
│ unchanged.   │ ┌───────────┐ ┌───────────┐ │ ▼               ▼               │
└──────────────┘ │ Update    │ │ Idempotent│ │ Compute Status: ┌───────────────┐
                 │ check_out │ │ Match:    │ │ - T <= end:     │ Record as     │
                 │ time = MAX│ │ Return    │ │   PRESENT       │ WEEKEND_VISIT │
                 │ (existing,│ │ existing  │ │ - end < T       │ or return 200 │
                 │ occurred) │ │ record    │ │   <= cutoff:    │ without       │
                 │ Commit Tx │ │ without   │ │   LATE          │ marking       │
                 │ Return 200│ │ mutation  │ │ - T > cutoff:   │ ABSENT        │
                 └───────────┘ └───────────┘ │   LATE (cutoff) └───────────────┘
                                             │ Commit Tx;      │
                                             │ Trigger Push.   │
                                             └─────────────────┘
```

### 6.3 Transaction Implementation Blueprint

```typescript
// src/modules/attendance/attendance.service.ts
export async function processAttendanceEvent(
  db: BetterSqlite3Database,
  userId: string,
  event: GeofenceEventPayload,
  userTimezone: string
): Promise<AttendanceProcessingResult> {
  const localDateTime = parseToUserTimezone(event.occurred_at, userTimezone);
  const localDateStr = localDateTime.toFormat('yyyy-MM-dd');
  const localTimeStr = localDateTime.toFormat('HH:mm:ss');
  const dayOfWeek = localDateTime.weekday % 7; // 0=Sunday, 1=Monday... 6=Saturday

  return db.transaction((tx) => {
    // 1. Check for existing record
    const existing = tx
      .select()
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.userId, userId), eq(attendanceRecords.date, localDateStr)))
      .get();

    if (existing) {
      // Rule A: Planned leave or WFH cannot be overwritten by geofence bounce
      if (['LEAVE', 'WFH'].includes(existing.status)) {
        return {
          status: 'PRESERVED_LEAVE',
          message: `Attendance for ${localDateStr} is designated as ${existing.status}; geofence event ignored.`,
          record: existing,
        };
      }

      // Rule B: Departure handling (EXIT) updates check_out_time monotonically
      if (event.event_type === 'EXIT') {
        const currentCheckout = existing.checkOutTime ? new Date(existing.checkOutTime) : null;
        const eventDate = new Date(event.occurred_at);
        const latestCheckout = currentCheckout && currentCheckout > eventDate ? currentCheckout : eventDate;

        const updated = tx
          .update(attendanceRecords)
          .set({ checkOutTime: latestCheckout.toISOString(), updatedAt: new Date().toISOString() })
          .where(eq(attendanceRecords.id, existing.id))
          .returning()
          .get();

        // Audit raw EXIT in presence_timeline
        tx.insert(presenceTimeline).values({
          id: crypto.randomUUID(),
          userId,
          eventId: event.event_id,
          eventType: 'EXIT',
          occurredAt: event.occurred_at,
          source: event.source,
          rawPayload: JSON.stringify(event),
          createdAt: new Date().toISOString(),
        }).run();

        return { status: 'CHECK_OUT_UPDATED', record: updated };
      }

      // Rule C: Offline Queue Replay vs Auto-Reconciled Absence
      // If the existing record was created by end-of-day cron reconciliation (status === 'ABSENT' and check_in_time === null)
      // and a delayed mobile check-in arrives with authentic GPS occurred_at during the work window,
      // allow the authentic check-in to overwrite the auto-reconciled absence.
      if (existing.status === 'ABSENT' && existing.checkInTime === null && event.event_type === 'ENTER') {
        const schedule = tx
          .select()
          .from(scheduleConfigs)
          .where(and(eq(scheduleConfigs.userId, userId), eq(scheduleConfigs.dayOfWeek, dayOfWeek)))
          .get();

        let computedStatus: AttendanceStatus = 'PRESENT';
        let notes: string | null = 'Offline check-in replayed: overwrote auto-reconciled absence';
        if (schedule && schedule.isWorkDay) {
          if (localTimeStr <= schedule.windowEnd) {
            computedStatus = 'PRESENT';
          } else if (localTimeStr <= schedule.lateCutoff) {
            computedStatus = 'LATE';
          } else {
            computedStatus = 'LATE';
            notes = 'Offline check-in replayed: arrived past grace cutoff';
          }
        }

        const updated = tx
          .update(attendanceRecords)
          .set({
            status: computedStatus,
            checkInTime: event.occurred_at,
            source: event.source, // 'GEOFENCE' or 'WIFI_AUTO'
            accuracyMeters: event.accuracy_meters,
            notes,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(attendanceRecords.id, existing.id))
          .returning()
          .get();

        // Audit raw delayed check-in in presence_timeline
        tx.insert(presenceTimeline).values({
          id: crypto.randomUUID(),
          userId,
          eventId: event.event_id,
          eventType: 'ENTER',
          occurredAt: event.occurred_at,
          source: event.source,
          rawPayload: JSON.stringify(event),
          createdAt: new Date().toISOString(),
        }).run();

        return {
          status: 'RECONCILED_ABSENCE_OVERWRITTEN',
          message: `Delayed offline check-in for ${localDateStr} overwrote auto-reconciled absence. Status updated to ${computedStatus}.`,
          record: updated,
        };
      }

      // Rule D: Subsequent ENTER events do NOT alter check_in_time or status (Idempotency)
      return {
        status: 'ALREADY_RECORDED',
        message: 'Attendance already registered for today.',
        record: existing,
      };
    }

    // 2. No record exists: EXIT-Before-ENTER Protection
    // If an OS geofence EXIT event arrives on date D when no check-in record exists yet,
    // do NOT create an attendance record setting check_in_time = exit_time.
    // Instead, log the exit event in presence_timeline with a note "EXIT without prior check-in"
    // and return HTTP 200 without creating a false check-in record, preserving date D for subsequent valid ENTER events.
    if (event.event_type === 'EXIT') {
      tx.insert(presenceTimeline).values({
        id: crypto.randomUUID(),
        userId,
        eventId: event.event_id,
        eventType: 'EXIT',
        occurredAt: event.occurred_at,
        source: event.source,
        rawPayload: JSON.stringify({ ...event, note: 'EXIT without prior check-in' }),
        createdAt: new Date().toISOString(),
      }).run();

      return {
        status: 'IGNORED_NO_CHECK_IN',
        message: `Ignored exit event on ${localDateStr} because no prior check-in exists. Preserving date for subsequent ENTER events.`,
        record: null,
      };
    }

    // 3. Query Schedule for Day
    const schedule = tx
      .select()
      .from(scheduleConfigs)
      .where(and(eq(scheduleConfigs.userId, userId), eq(scheduleConfigs.dayOfWeek, dayOfWeek)))
      .get();

    if (!schedule || !schedule.isWorkDay) {
      // Non-working day: Record optional voluntary visit without impacting weekday streaks
      const weekendRecord = tx
        .insert(attendanceRecords)
        .values({
          id: crypto.randomUUID(),
          userId,
          date: localDateStr,
          status: 'PRESENT',
          checkInTime: event.occurred_at,
          source: event.source,
          accuracyMeters: event.accuracy_meters,
          notes: 'Voluntary attendance registered on scheduled non-work day',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .returning()
        .get();

      // Log raw event to presence_timeline
      tx.insert(presenceTimeline).values({
        id: crypto.randomUUID(),
        userId,
        eventId: event.event_id,
        eventType: 'ENTER',
        occurredAt: event.occurred_at,
        source: event.source,
        rawPayload: JSON.stringify(event),
        createdAt: new Date().toISOString(),
      }).run();

      return { status: 'NON_WORK_DAY_RECORDED', record: weekendRecord };
    }

    // 4. Status Computation against Arrival Windows
    let computedStatus: AttendanceStatus;
    if (localTimeStr <= schedule.windowEnd) {
      // Arriving before window_start (early arrival) or within window is PRESENT
      computedStatus = 'PRESENT';
    } else if (localTimeStr <= schedule.lateCutoff) {
      computedStatus = 'LATE';
    } else {
      // Arriving past grace cutoff
      computedStatus = 'LATE';
    }

    // 5. Atomic Insert
    const newRecord = tx
      .insert(attendanceRecords)
      .values({
        id: crypto.randomUUID(),
        userId,
        date: localDateStr,
        status: computedStatus,
        checkInTime: event.occurred_at,
        source: event.source,
        accuracyMeters: event.accuracy_meters,
        notes: localTimeStr > schedule.lateCutoff ? 'Arrived past grace cutoff' : null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .returning()
      .get();

    // Log raw event to presence_timeline
    tx.insert(presenceTimeline).values({
      id: crypto.randomUUID(),
      userId,
      eventId: event.event_id,
      eventType: 'ENTER',
      occurredAt: event.occurred_at,
      source: event.source,
      rawPayload: JSON.stringify(event),
      createdAt: new Date().toISOString(),
    }).run();

    return { status: 'NEW_CHECK_IN', record: newRecord };
  });
}
```

---

## 7. Timezone-Anchored Date & Time Matching

### 7.1 The Timezone Problem in Geofencing
UTC timestamps alone cannot identify the calendar date of an event. For example:
- A user arrives in Tokyo (`Asia/Tokyo`, UTC+9) at `2026-11-06 08:30:00` local time.
- The device emits UTC timestamp `2026-11-05T23:30:00Z`.
- Naively using UTC date `2026-11-05` marks attendance for **yesterday**, corrupting the entire attendance history.

### 7.2 Resolution Architecture
1. **User Timezone Authority**: The backend stores the user's primary IANA timezone in `user_settings.timezone` (e.g. `'Asia/Kolkata'`, `'America/New_York'`).
2. **Timezone Normalization**:
   - Every ingested event timestamp (`occurred_at`) is converted to an immutable `DateTime` object anchored to `user_settings.timezone` via Luxon or `@date-fns/tz`.
   - Local date string (`YYYY-MM-DD`) determines the `attendance_records.date` partition.
   - Local time string (`HH:mm:ss`) is compared with `schedule_configs.window_start`, `window_end`, and `late_cutoff`.
3. **Daylight Saving Time (DST) Handling**:
   - IANA database tables account for 1-hour spring-forward and fall-back transitions automatically.
   - Schedules remain anchored to local wall-clock time (e.g., `09:00 AM` local time remains `09:00 AM` across DST boundaries).

---

## 8. Background Jobs & Cron Scheduling Engine

The backend embeds an in-process, zero-external-dependency scheduling engine using `Croner`. The scheduler operates in the user's configured IANA timezone, ensuring jobs trigger relative to local wall-clock time.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                            IN-PROCESS CRON SCHEDULER                             │
│                                                                                  │
│   ┌───────────────────────────────┐     ┌───────────────────────────────────┐    │
│   │ Job 1: Pre-Cutoff Reminder    │     │ Job 2: Absenteeism Reconciliation │    │
│   │ Schedule: Every 1 minute      │     │ Schedule: Daily at 23:59:00       │    │
│   │ Trigger: 15m before window end│     │ Checks: Unrecorded active work day│    │
│   │ Dispatches: Warning Push Alert│     │ Action: Inserts status='ABSENT'   │    │
│   └───────────────────────────────┘     └───────────────────────────────────┘    │
│                                                                                  │
│   ┌───────────────────────────────┐     ┌───────────────────────────────────┐    │
│   │ Job 3: Daily WAL Checkpoint   │     │ Job 4: Live VACUUM Atomic Backup  │    │
│   │ Schedule: Daily at 03:30:00   │     │ Schedule: Daily at 03:35:00       │    │
│   │ Action: PRAGMA wal_checkpoint │     │ Action: VACUUM INTO /backups/...  │    │
│   └───────────────────────────────┘     └───────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 8.1 Job 1: Pre-Cutoff Expiration Warning Dispatcher
- **Schedule**: Evaluates every minute: `* * * * *`.
- **Logic**:
  1. Retrieves active schedule for `today` in user's timezone.
  2. If today is not a work day (`is_work_day == false`), skips evaluation.
  3. Computes reminder trigger time: `trigger_time = schedule.window_end - reminder_minutes` (default 15 minutes before window closes).
  4. If current local time matches `trigger_time`:
     - Checks if an attendance record exists for `(user_id, today)`.
     - If record exists (status is `PRESENT`, `LATE`, `LEAVE`, or `WFH`), suppresses alert.
     - If NO record exists: dispatches high-priority push warning to all registered devices:
       > *"Attendance Alert: Your check-in window closes at 10:00 AM (15 minutes remaining). Enter work location to record on-time arrival."*
  5. Implements in-memory lock key `reminder_sent_${userId}_${today}` to guarantee at most one reminder is dispatched per calendar day.

### 8.2 Job 2: Absenteeism Reconciliation
- **Schedule**: Daily at local end-of-day: `59 23 * * *`.
- **Logic**:
  1. Resolves `today` in user's timezone.
  2. Queries `schedule_configs` for today's day of week.
  3. If `is_work_day == false`, skips reconciliation.
  4. Queries `attendance_records` for `(user_id, today)`.
  5. If no record exists:
     - Automatically creates an attendance record inside an atomic transaction:
       - `status = 'ABSENT'`
       - `check_in_time = NULL`
       - `source = 'MANUAL'`
       - `notes = 'System auto-reconciliation: No check-in registered before end of day'`
     - Sends notification to user informing them of recorded absence. Note: If a delayed mobile check-in replayed from offline storage arrives subsequently with authentic sensor epoch on date D, Rule C permits overwriting this auto-reconciled record.

### 8.3 Job 3: Live WAL Checkpointing
- **Schedule**: Daily at `03:30:00` local time (`30 3 * * *`).
- **DST-Safety Rationale**: Rescheduled from 02:00:00 AM to 03:30:00 AM local time. In IANA timezones observing Daylight Saving Time (e.g. `America/New_York`, `Europe/London`), local clocks skip directly from 01:59:59 AM to 03:00:00 AM during Spring Forward transitions. Scheduling maintenance cron jobs between 02:00:00 AM and 02:59:59 AM causes jobs to land in a non-existent clock window, resulting in skipped checkpoints or unpredictable scheduler delays. Running at 03:30:00 AM guarantees consistent, uninterrupted execution across all 365 days of the year.
- **Logic**:
  1. Executes `PRAGMA wal_checkpoint(PASSIVE);` to commit cached WAL frames to the main SQLite database without blocking concurrent readers.

### 8.4 Job 4: Live VACUUM Atomic Backup Rotation
- **Schedule**: Daily at `03:35:00` local time (`35 3 * * *`).
- **DST-Safety Rationale**: Rescheduled from 02:05:00 AM to 03:35:00 AM local time, running 5 minutes post-checkpoint in a guaranteed valid clock window across all DST transitions.
- **Logic**:
  1. Executes `VACUUM INTO '/backups/attendance_backup_YYYYMMDD_HHMMSS.db';` to create an immutable, zero-lock live copy of the database.
  2. Scans `/backups/` and removes backup files older than 30 days to enforce rolling retention.

---

## 9. Push Notification Engine & Delivery Pipeline

Push notifications alert the user upon successful boundary arrival and warn of impending window expiration.

### 9.1 Delivery Channels
1. **Expo Push Notification Service (Primary)**:
   - Dispatches payload via HTTPS POST to `https://exp.host/--/api/v2/push/send`.
   - Relay delivers payload to Apple Push Notification service (APNs) for iOS and Firebase Cloud Messaging (FCM) for Android.
   - High priority payload awakens suspended mobile app to display notification banner even when device is screen-locked.
2. **ntfy Webhook Relay (Secondary / Homelab)**:
   - Configurable via `NTFY_URL` in environment.
   - Sends standard HTTP POST payload with title, message, and tags (`white_check_mark,briefcase`).
   - Enables desktop notifications and custom home automation triggers.

### 9.2 Non-Blocking Asynchronous Dispatch
Notification dispatch is explicitly isolated from the check-in transaction. If the external Expo API times out or fails:
- The attendance record remains committed in the database.
- The HTTP check-in response returns `201 Created` without latency.
- The notification error is logged to Pino with full context for diagnostics.

---

## 10. Operational Logging, Diagnostics & Graceful Shutdown

### 10.1 Structured Pino Logging
The server utilizes Pino for high-performance structured JSON logging. Every incoming request receives a unique `x-request-id` header:

```json
{
  "level": 30,
  "time": 1793970862000,
  "pid": 4210,
  "hostname": "attendance-srv",
  "reqId": "req-9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "req": {
    "method": "POST",
    "url": "/api/v1/attendance/events",
    "remoteAddress": "192.168.1.50"
  },
  "userId": "usr_main",
  "msg": "Attendance event processed: PRESENT"
}
```

### 10.2 Graceful Shutdown Handling (SIGTERM / SIGINT)
When a Docker container stop or host shutdown signal is received:
1. Fastify stops listening for new connections (`app.close()`).
2. Active in-flight HTTP requests are given a 10-second grace period to complete.
3. Croner schedulers are halted (`scheduler.stop()`).
4. Better-sqlite3 executes a final `PRAGMA wal_checkpoint(TRUNCATE);`.
5. Database connection is closed cleanly (`db.close()`).
6. Process terminates with exit code 0, guaranteeing zero SQLite WAL corruption.

---

## 11. Environment Configuration Specification

The server enforces strict runtime configuration validation on startup using Zod:

| Variable Name | Type | Default | Purpose & Constraints |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | `enum` | `'production'` | `'development'`, `'test'`, or `'production'` |
| `PORT` | `number` | `3000` | Port Fastify binds to inside container |
| `HOST` | `string` | `'0.0.0.0'` | Host interface binding |
| `DATABASE_PATH` | `string` | `'/data/attendance.db'` | Path to SQLite database file on disk |
| `BACKUP_PATH` | `string` | `'/backups'` | Destination folder for automated SQLite backups |
| `JWT_SECRET` | `string` | *Required* | Min 32-character secret for signing session cookies |
| `COOKIE_SECRET` | `string` | *Required* | Min 32-character secret for cookie tampering prevention |
| `EXPO_ACCESS_TOKEN` | `string` | *Optional* | Expo Push Service access token for authenticated push dispatch |
| `NTFY_URL` | `string` | *Optional* | URL of self-hosted ntfy topic (e.g. `https://ntfy.sh/my-topic`) |
| `LOG_LEVEL` | `enum` | `'info'` | `'debug'`, `'info'`, `'warn'`, or `'error'` |
| `PUBLIC_URL` | `string` | `'http://localhost:3000'` | Canonical base URL for CORS and reverse proxy matching |
