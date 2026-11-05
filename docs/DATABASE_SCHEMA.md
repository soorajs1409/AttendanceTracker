# Database Architecture & Schema Specification

## 1. Overview & Storage Engine

The Attendance Tracker uses **SQLite 3** managed via the **`better-sqlite3`** C++ native driver and typed with **Drizzle ORM**. This architecture provides an embedded, zero-maintenance, zero-network-latency relational database engine specifically optimized for a single-user workload with microsecond read/write execution and ACID compliance.

### Storage Profile & Concurrency Model
- **Database Engine**: SQLite 3 (version 3.42+)
- **Driver**: `better-sqlite3` (synchronous execution, zero Promise event loop overhead for DB transactions)
- **Primary Data File**: `/data/attendance.db`
- **WAL Journal File**: `/data/attendance.db-wal` (Write-Ahead Logging buffer)
- **Shared Memory File**: `/data/attendance.db-shm` (Index mapping for concurrent readers)
- **Volume Isolation**: The `/data` directory must be mounted on local SSD/NVMe storage. Network-attached filesystems (NFS, SMB, CIFS) are strictly prohibited due to POSIX file-locking bugs.

---

## 2. SQLite PRAGMA Configuration & Connection Initialization

Upon opening the database connection in `apps/server/src/db/client.ts`, the server immediately executes the following performance, durability, and integrity pragmas:

```typescript
// apps/server/src/db/client.ts
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const sqlite = new Database(process.env.DATABASE_PATH || '/data/attendance.db', {
  timeout: 5000, // 5000ms busy timeout prevents SQLITE_BUSY under short locks
  verbose: process.env.NODE_ENV === 'development' ? console.log : undefined,
});

// Execute mandatory operational pragmas
sqlite.pragma('journal_mode = WAL');       // Concurrent readers while single writer writes
sqlite.pragma('synchronous = NORMAL');     // Flushes WAL safely; 10x faster than FULL, zero corruptions
sqlite.pragma('foreign_keys = ON');        // Strict enforcement of relational foreign keys & cascades
sqlite.pragma('busy_timeout = 5000');      // Wait up to 5000ms if database is locked by background backup
sqlite.pragma('cache_size = -20000');      // 20 MB in-memory page cache (negative = KiB)
sqlite.pragma('temp_store = MEMORY');      // Store temporary tables and indices in RAM
sqlite.pragma('auto_vacuum = INCREMENTAL');// Prevent database file bloat over years of use

export const db = drizzle(sqlite, { schema });
```

### Pragma Rationale Matrix

| PRAGMA Directive | Setting | Purpose & Operational Rationale |
| :--- | :--- | :--- |
| `journal_mode` | `WAL` | Write-Ahead Logging allows simultaneous non-blocking concurrent reads while a write transaction executes. Prevents reader starvation during check-in writes. |
| `synchronous` | `NORMAL` | In WAL mode, `NORMAL` guarantees database integrity across application crashes and power failures while reducing disk sync system calls by ~80% compared to `FULL`. |
| `foreign_keys` | `ON` | Enforces relational integrity across all 7 tables. Cascade deletions automatically purge dependent records (e.g., location/schedule configs when a user profile is deleted). |
| `busy_timeout` | `5000` | Eliminates instant `SQLITE_BUSY` or `SQLITE_LOCKED` exceptions by instructing the driver to poll with exponential backoff for up to 5 seconds if a write transaction is underway. |
| `cache_size` | `-20000` | Allocates ~20 MiB of system memory for the page cache. For a single user, this keeps virtually the entire active working set in RAM, reducing disk reads to near zero. |
| `temp_store` | `MEMORY` | Forces temporary index builds and sorting tables into RAM instead of writing ephemeral scratch files to disk. |

---

## 3. Entity-Relationship Model (All 7 Core Tables)

```
┌──────────────────────────────────────────────────────────┐
│                      user_settings                       │
├──────────────────────────────────────────────────────────┤
│ PK  id               UUID / VARCHAR(36)                  │
│     username         VARCHAR(64) UNIQUE NOT NULL         │
│     password_hash    TEXT NOT NULL (Argon2id)            │
│     api_token_hash   TEXT NOT NULL (SHA-256)             │
│     timezone         VARCHAR(64) NOT NULL (IANA)         │
│     created_at       TEXT NOT NULL (ISO8601)             │
│     updated_at       TEXT NOT NULL (ISO8601)             │
└────────┬──────────────────────┬────────────────────┬─────┴────────────┐
         │ 1:N                  │ 1:N                │ 1:N              │ 1:N
         ▼                      ▼                    ▼                  ▼
┌──────────────────┐   ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────────────┐
│ location_configs │   │ schedule_configs │ │push_device_tokens│ │    presence_timeline     │
├──────────────────┤   ├──────────────────┤ ├──────────────────┤ ├──────────────────────────┤
│ PK id            │   │ PK id            │ │ PK id            │ │ PK id                    │
│ FK user_id       │   │ FK user_id       │ │ FK user_id       │ │ FK user_id               │
│    name          │   │    day_of_week   │ │    token         │ │    event_id (UNIQUE)     │
│    latitude      │   │    is_work_day   │ │    platform      │ │    event_type            │
│    longitude     │   │    window_start  │ │    device_name   │ │    occurred_at           │
│    radius_meters │   │    window_end    │ │    created_at    │ │    source                │
│    wifi_ssid     │   │    late_cutoff   │ │    updated_at    │ │    raw_payload           │
│    wifi_bssid    │   │    created_at    │ └──────────────────┘ │    created_at            │
│    is_active     │   │    updated_at    │                      └──────────────────────────┘
│    created_at    │   └──────────────────┘
│    updated_at    │
└──────────────────┘
         │
         │ (Referenced by user)
         ▼
┌──────────────────────────────────────────────────────────┐
│                    attendance_records                    │
├──────────────────────────────────────────────────────────┤
│ PK  id               UUID / VARCHAR(36)                  │
│ FK  user_id          UUID / VARCHAR(36) NOT NULL         │
│     date             TEXT NOT NULL (YYYY-MM-DD)          │
│     status           TEXT NOT NULL (PRESENT|LATE|ABSENT| │
│                                     LEAVE|WFH)           │
│     check_in_time    TEXT NULL (ISO8601)                 │
│     check_out_time   TEXT NULL (ISO8601)                 │
│     source           TEXT NOT NULL (GEOFENCE|WIFI_AUTO|  │
│                                     MANUAL)              │
│     accuracy_meters  REAL NULL                           │
│     notes            TEXT NULL                           │
│     created_at       TEXT NOT NULL (ISO8601)             │
│     updated_at       TEXT NOT NULL (ISO8601)             │
│                                                          │
│     CONSTRAINT: UNIQUE(user_id, date)                    │
└────────┬─────────────────────────────────────────────────┘
         │ 1:N
         ▼
┌──────────────────────────────────────────────────────────┐
│                  attendance_audit_logs                   │
├──────────────────────────────────────────────────────────┤
│ PK  id               UUID / VARCHAR(36)                  │
│ FK  record_id        UUID / VARCHAR(36) NOT NULL         │
│     previous_status  TEXT NULL                           │
│     new_status       TEXT NOT NULL                       │
│     previous_check_in TEXT NULL                          │
│     new_check_in     TEXT NULL                           │
│     reason           TEXT NOT NULL (Mandatory)           │
│     client_source    TEXT NOT NULL (WEB|MOBILE)          │
│     created_at       TEXT NOT NULL (ISO8601)             │
└──────────────────────────────────────────────────────────┘
```

---

## 4. Drizzle ORM TypeScript Schema Models (`src/db/schema.ts`)

```typescript
import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// 1. user_settings
// ---------------------------------------------------------------------------
export const userSettings = sqliteTable('user_settings', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  apiTokenHash: text('api_token_hash').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

// ---------------------------------------------------------------------------
// 2. location_configs
// ---------------------------------------------------------------------------
export const locationConfigs = sqliteTable('location_configs', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => userSettings.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  latitude: real('latitude').notNull(),
  longitude: real('longitude').notNull(),
  radiusMeters: integer('radius_meters').notNull().default(100),
  wifiSsid: text('wifi_ssid'),
  wifiBssid: text('wifi_bssid'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
}, (table) => ({
  userIdIdx: index('idx_location_configs_user_id').on(table.userId),
  activeIdx: index('idx_location_configs_active').on(table.isActive),
}));

// ---------------------------------------------------------------------------
// 3. schedule_configs
// ---------------------------------------------------------------------------
export const scheduleConfigs = sqliteTable('schedule_configs', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => userSettings.id, { onDelete: 'cascade' }),
  dayOfWeek: integer('day_of_week').notNull(), // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  isWorkDay: integer('is_work_day', { mode: 'boolean' }).notNull().default(true),
  windowStart: text('window_start').notNull(), // 'HH:MM:SS' format (e.g., '09:00:00')
  windowEnd: text('window_end').notNull(),     // 'HH:MM:SS' format (e.g., '10:00:00')
  lateCutoff: text('late_cutoff').notNull(),   // 'HH:MM:SS' format (e.g., '11:30:00')
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
}, (table) => ({
  userDayUnique: uniqueIndex('idx_schedule_configs_user_day').on(table.userId, table.dayOfWeek),
  userIdIdx: index('idx_schedule_configs_user_id').on(table.userId),
}));

// ---------------------------------------------------------------------------
// 4. attendance_records
// ---------------------------------------------------------------------------
export const attendanceRecords = sqliteTable('attendance_records', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => userSettings.id, { onDelete: 'cascade' }),
  date: text('date').notNull(), // 'YYYY-MM-DD' anchored to user's IANA timezone
  status: text('status', { enum: ['PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'WFH'] }).notNull(),
  checkInTime: text('check_in_time'), // UTC ISO 8601 string: 'YYYY-MM-DDTHH:mm:ss.sssZ'
  checkOutTime: text('check_out_time'), // UTC ISO 8601 string
  source: text('source', { enum: ['GEOFENCE', 'WIFI_AUTO', 'MANUAL'] }).notNull(),
  accuracyMeters: real('accuracy_meters'),
  notes: text('notes'),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
}, (table) => ({
  userDateUnique: uniqueIndex('idx_attendance_records_user_date').on(table.userId, table.date),
  dateIdx: index('idx_attendance_records_date').on(table.date),
  statusIdx: index('idx_attendance_records_status').on(table.status),
  userIdIdx: index('idx_attendance_records_user_id').on(table.userId),
}));

// ---------------------------------------------------------------------------
// 5. attendance_audit_logs (Immutable audit trail)
// ---------------------------------------------------------------------------
export const attendanceAuditLogs = sqliteTable('attendance_audit_logs', {
  id: text('id').primaryKey(),
  recordId: text('record_id')
    .notNull()
    .references(() => attendanceRecords.id, { onDelete: 'cascade' }),
  previousStatus: text('previous_status'),
  newStatus: text('new_status').notNull(),
  previousCheckIn: text('previous_check_in'),
  newCheckIn: text('new_check_in'),
  reason: text('reason').notNull(), // Mandatory textual justification
  clientSource: text('client_source', { enum: ['WEB', 'MOBILE'] }).notNull(),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
}, (table) => ({
  recordIdIdx: index('idx_attendance_audit_logs_record_id').on(table.recordId),
  createdAtIdx: index('idx_attendance_audit_logs_created_at').on(table.createdAt),
}));

// ---------------------------------------------------------------------------
// 6. push_device_tokens
// ---------------------------------------------------------------------------
export const pushDeviceTokens = sqliteTable('push_device_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => userSettings.id, { onDelete: 'cascade' }),
  token: text('token').notNull(),
  platform: text('platform', { enum: ['ios', 'android'] }).notNull(),
  deviceName: text('device_name'),
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
}, (table) => ({
  userTokenUnique: uniqueIndex('idx_push_device_tokens_user_token').on(table.userId, table.token),
  userIdIdx: index('idx_push_device_tokens_user_id').on(table.userId),
}));

// ---------------------------------------------------------------------------
// 7. presence_timeline (Secondary raw sensor event audit log)
// ---------------------------------------------------------------------------
export const presenceTimeline = sqliteTable('presence_timeline', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => userSettings.id, { onDelete: 'cascade' }),
  eventId: text('event_id').notNull().unique(), // UUIDv4 idempotency key
  eventType: text('event_type', { enum: ['ENTER', 'EXIT', 'DWELL'] }).notNull(),
  occurredAt: text('occurred_at').notNull(), // ISO 8601 UTC string
  source: text('source', { enum: ['GEOFENCE', 'WIFI_AUTO', 'MANUAL'] }).notNull(),
  rawPayload: text('raw_payload'), // Serialized JSON payload for forensic audit
  createdAt: text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
}, (table) => ({
  userIdIdx: index('idx_presence_timeline_user_id').on(table.userId),
  eventIdIdx: uniqueIndex('idx_presence_timeline_event_id').on(table.eventId),
  occurredAtIdx: index('idx_presence_timeline_occurred_at').on(table.occurredAt),
}));
```

---

## 5. Raw SQL DDL (Migration Baseline)

Below is the exact baseline DDL executed by `drizzle-kit migrate` during container initialization:

```sql
-- ---------------------------------------------------------------------------
-- 1. Table: user_settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_settings` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `username` TEXT NOT NULL,
  `password_hash` TEXT NOT NULL,
  `api_token_hash` TEXT NOT NULL,
  `timezone` TEXT DEFAULT 'UTC' NOT NULL,
  `created_at` TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `updated_at` TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_user_settings_username` ON `user_settings` (`username`);

-- ---------------------------------------------------------------------------
-- 2. Table: location_configs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `location_configs` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `user_id` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `latitude` REAL NOT NULL,
  `longitude` REAL NOT NULL,
  `radius_meters` INTEGER DEFAULT 100 NOT NULL,
  `wifi_ssid` TEXT,
  `wifi_bssid` TEXT,
  `is_active` INTEGER DEFAULT 1 NOT NULL,
  `created_at` TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `updated_at` TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `user_settings`(`id`) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `idx_location_configs_user_id` ON `location_configs` (`user_id`);
CREATE INDEX IF NOT EXISTS `idx_location_configs_active` ON `location_configs` (`is_active`);

-- ---------------------------------------------------------------------------
-- 3. Table: schedule_configs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `schedule_configs` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `user_id` TEXT NOT NULL,
  `day_of_week` INTEGER NOT NULL CHECK (`day_of_week` BETWEEN 0 AND 6),
  `is_work_day` INTEGER DEFAULT 1 NOT NULL,
  `window_start` TEXT NOT NULL,
  `window_end` TEXT NOT NULL,
  `late_cutoff` TEXT NOT NULL,
  `created_at` TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `updated_at` TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `user_settings`(`id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_schedule_configs_user_day` ON `schedule_configs` (`user_id`, `day_of_week`);
CREATE INDEX IF NOT EXISTS `idx_schedule_configs_user_id` ON `schedule_configs` (`user_id`);

-- ---------------------------------------------------------------------------
-- 4. Table: attendance_records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `attendance_records` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `user_id` TEXT NOT NULL,
  `date` TEXT NOT NULL,
  `status` TEXT NOT NULL CHECK (`status` IN ('PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'WFH')),
  `check_in_time` TEXT,
  `check_out_time` TEXT,
  `source` TEXT NOT NULL CHECK (`source` IN ('GEOFENCE', 'WIFI_AUTO', 'MANUAL')),
  `accuracy_meters` REAL,
  `notes` TEXT,
  `created_at` TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `updated_at` TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `user_settings`(`id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_attendance_records_user_date` ON `attendance_records` (`user_id`, `date`);
CREATE INDEX IF NOT EXISTS `idx_attendance_records_date` ON `attendance_records` (`date`);
CREATE INDEX IF NOT EXISTS `idx_attendance_records_status` ON `attendance_records` (`status`);
CREATE INDEX IF NOT EXISTS `idx_attendance_records_user_id` ON `attendance_records` (`user_id`);

-- ---------------------------------------------------------------------------
-- 5. Table: attendance_audit_logs (Append-Only Immutable Log)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `attendance_audit_logs` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `record_id` TEXT NOT NULL,
  `previous_status` TEXT,
  `new_status` TEXT NOT NULL,
  `previous_check_in` TEXT,
  `new_check_in` TEXT,
  `reason` TEXT NOT NULL,
  `client_source` TEXT NOT NULL CHECK (`client_source` IN ('WEB', 'MOBILE')),
  `created_at` TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  FOREIGN KEY (`record_id`) REFERENCES `attendance_records`(`id`) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `idx_attendance_audit_logs_record_id` ON `attendance_audit_logs` (`record_id`);
CREATE INDEX IF NOT EXISTS `idx_attendance_audit_logs_created_at` ON `attendance_audit_logs` (`created_at`);

-- ---------------------------------------------------------------------------
-- 6. Table: push_device_tokens
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `push_device_tokens` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `user_id` TEXT NOT NULL,
  `token` TEXT NOT NULL,
  `platform` TEXT NOT NULL CHECK (`platform` IN ('ios', 'android')),
  `device_name` TEXT,
  `created_at` TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  `updated_at` TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `user_settings`(`id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_push_device_tokens_user_token` ON `push_device_tokens` (`user_id`, `token`);
CREATE INDEX IF NOT EXISTS `idx_push_device_tokens_user_id` ON `push_device_tokens` (`user_id`);

-- ---------------------------------------------------------------------------
-- 7. Table: presence_timeline (Secondary Raw Event Log)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `presence_timeline` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `user_id` TEXT NOT NULL,
  `event_id` TEXT UNIQUE NOT NULL,
  `event_type` TEXT NOT NULL CHECK (`event_type` IN ('ENTER', 'EXIT', 'DWELL')),
  `occurred_at` TEXT NOT NULL,
  `source` TEXT NOT NULL CHECK (`source` IN ('GEOFENCE', 'WIFI_AUTO', 'MANUAL')),
  `raw_payload` TEXT,
  `created_at` TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `user_settings`(`id`) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_presence_timeline_event_id` ON `presence_timeline` (`event_id`);
CREATE INDEX IF NOT EXISTS `idx_presence_timeline_user_id` ON `presence_timeline` (`user_id`);
CREATE INDEX IF NOT EXISTS `idx_presence_timeline_occurred_at` ON `presence_timeline` (`occurred_at`);
```

---

## 6. Migration Strategy & Automated Startup Execution

### 6.1 Drizzle Kit Configuration (`drizzle.config.ts`)

```typescript
// apps/server/drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_PATH || '/data/attendance.db',
  },
  verbose: true,
  strict: true,
});
```

### 6.2 Automated Startup Migration Runner (`src/db/migrate.ts`)

The backend container executes migrations automatically prior to starting the Fastify HTTP listener. This eliminates manual database administration steps during updates.

```typescript
// apps/server/src/db/migrate.ts
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './client';
import path from 'node:path';

export function runMigrations(): void {
  const migrationsFolder = path.join(__dirname, '../../drizzle/migrations');
  console.log(`[Database] Applying database migrations from ${migrationsFolder}...`);
  try {
    migrate(db, { migrationsFolder });
    console.log('[Database] Migrations applied successfully.');
  } catch (error) {
    console.error('[Database] Migration failed:', error);
    process.exit(1);
  }
}
```

---

## 7. Initial Database Seeding Routine (`src/db/seed.ts`)

On fresh installations, when `user_settings` contains zero records, the application executes a default seeding routine to configure the administrator account and a standard Monday–Friday work schedule:

```typescript
// apps/server/src/db/seed.ts
import { db } from './client';
import { userSettings, scheduleConfigs, locationConfigs } from './schema';
import * as argon2 from 'argon2';
import crypto from 'node:crypto';

export async function seedInitialDataIfNeeded(): Promise<void> {
  const existingUsers = db.select().from(userSettings).all();
  if (existingUsers.length > 0) return;

  console.log('[Database] Empty database detected. Seeding initial user configuration...');

  const userId = crypto.randomUUID();
  const rawMasterPassword = process.env.INITIAL_MASTER_PASSWORD || 'ChangeMeImmediately123!';
  const rawApiToken = crypto.randomBytes(32).toString('hex');

  const passwordHash = await argon2.hash(rawMasterPassword, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const apiTokenHash = crypto.createHash('sha256').update(rawApiToken).digest('hex');

  db.transaction((tx) => {
    // 1. Create Default User
    tx.insert(userSettings).values({
      id: userId,
      username: 'admin',
      passwordHash,
      apiTokenHash,
      timezone: process.env.DEFAULT_TIMEZONE || 'UTC',
    }).run();

    // 2. Create Default Schedule (Monday - Friday 09:00 - 10:00, Cutoff 11:30)
    for (let day = 0; day <= 6; day++) {
      const isWorkDay = day >= 1 && day <= 5; // Mon-Fri = true, Sat-Sun = false
      tx.insert(scheduleConfigs).values({
        id: crypto.randomUUID(),
        userId,
        dayOfWeek: day,
        isWorkDay,
        windowStart: '09:00:00',
        windowEnd: '10:00:00',
        lateCutoff: '11:30:00',
      }).run();
    }

    // 3. Create Default Location (Placeholder Coordinates)
    tx.insert(locationConfigs).values({
      id: crypto.randomUUID(),
      userId,
      name: 'Primary Office',
      latitude: 0.0,
      longitude: 0.0,
      radiusMeters: 100,
      isActive: false, // Inactive until user sets on web map
    }).run();
  });

  console.log(`[Database] Seed complete.`);
  console.log(`[Database] Initial Web Login: Username: 'admin' | Password: '${rawMasterPassword}'`);
  console.log(`[Database] Initial Mobile Device API Token: '${rawApiToken}'`);
}
```

---

## 8. Backup, WAL Checkpointing & Disaster Recovery

### 8.1 Live Atomic Database Backups (`VACUUM INTO`)
SQLite supports live, point-in-time database snapshots without acquiring read or write locks on the live database. The nightly backup job executes:

```typescript
export function performNightlyBackup(sqlite: Database.Database, backupDir: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `attendance_backup_${timestamp}.db`);

  // First passive checkpoint to flush WAL frames to main file
  sqlite.pragma('wal_checkpoint(PASSIVE)');

  // Atomic live backup into new standalone SQLite file
  sqlite.prepare(`VACUUM INTO ?`).run(backupFile);

  return backupFile;
}
```

### 8.2 Disaster Recovery Procedure
To restore the database from a backup file:
1. Stop the attendance container: `docker compose down`.
2. Replace `/data/attendance.db` with the designated snapshot file:
   `cp /backups/attendance_backup_20261105.db /data/attendance.db`.
3. Remove stale WAL and SHM journal files:
   `rm -f /data/attendance.db-wal /data/attendance.db-shm`.
4. Restart the container: `docker compose up -d`.
5. Startup migrations verify the schema, and the server resumes immediately.
