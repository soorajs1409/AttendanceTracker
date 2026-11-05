# Self-Hosting, Deployment & Infrastructure Guide

This guide provides the complete, production-grade deployment and operations specification for **AttendanceTracker**. It details single-container Docker packaging, secure remote access architectures (Cloudflare Tunnels, Tailscale private mesh, and Caddy reverse proxy), push notification pipelines, SQLite WAL storage durability rules, zero-lock live backups, and disaster recovery runbooks.

---

## 1. Architectural Philosophy & Deployment Topologies

AttendanceTracker is designed from first principles as an automated, single-user system. This narrow operational scope enables an ultra-lean deployment model that eliminates multi-tenant database clusters, external caching daemons (Redis), and distributed message brokers.

### 1.1 Core Tenets
1. **Sub-65MB RAM Footprint**: The unified production container hosts both the Fastify REST API (`/api/v1/*`) and the compiled React Web SPA (`/*`) inside a single Node.js 20 Alpine process. Total idle RAM consumption remains under 45MB, peaking below 65MB during active requests.
2. **Embedded Zero-Daemon Storage**: SQLite running in Write-Ahead Logging (WAL) mode is embedded directly within the Fastify application process via `better-sqlite3`. No external PostgreSQL container or TCP network overhead is introduced.
3. **Strict Data Sovereignty**: All attendance history, geofence coordinates, schedules, and audit logs reside within a single atomic `.db` file on local host storage.
4. **Dual Network Topologies**: First-class support for both **Homelab deployments** (behind CGNAT with dynamic IPs via Cloudflare Tunnel) and **VPS deployments** (public IP with automated TLS termination via Caddy).

---

### 1.2 Deployment Topologies

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              TOPOLOGY A: VPS DEPLOYMENT                                │
│                              (Dedicated Public IPv4/IPv6)                              │
│                                                                                        │
│   [Internet Clients]                                                                   │
│   (Mobile App / Web Browser)                                                           │
│           │                                                                            │
│           │ HTTPS (Port 443 / TCP & UDP HTTP/3 QUIC)                                   │
│           ▼                                                                            │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │ Caddy 2.8 Reverse Proxy Container                                              │   │
│   │ - Automated ACME TLS (Let's Encrypt / ZeroSSL)                                  │   │
│   │ - Strict Security Headers (HSTS, CSP, X-Frame-Options)                         │   │
│   │ - HTTP/3 (QUIC) Termination & Gzip/Zstd Compression                            │   │
│   └───────────────────────────────────────┬────────────────────────────────────────┘   │
│                                           │ Upstream Proxy (http://127.0.0.1:3000)     │
│                                           ▼                                            │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │ AttendanceTracker Production Container                                         │   │
│   │ ┌────────────────────────────────────────────────────────────────────────────┐ │   │
│   │ │ Fastify Application Process (Node.js 20 LTS Alpine)                         │ │   │
│   │ │ - /api/v1/*  ──> Fastify REST Endpoints & Idempotency Engine               │ │   │
│   │ │ - /*         ──> @fastify/static (Pre-compiled React Web SPA)              │ │   │
│   │ │ - SQLite WAL ──> Embedded better-sqlite3 engine (/data/attendance.db)      │ │   │
│   │ └────────────────────────────────────────────────────────────────────────────┘ │   │
│   └───────────────────────────────────────┬────────────────────────────────────────┘   │
│                                           │ Local Host Mount                           │
│                                           ▼                                            │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │ Host Local Storage (NVMe / SSD)                                                │   │
│   │ ├── /data/attendance.db (SQLite Main DB)                                       │   │
│   │ ├── /data/attendance.db-wal (Write-Ahead Log)                                  │   │
│   │ └── /backups/ (Daily VACUUM INTO snapshots)                                    │   │
│   └────────────────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────────┐
│                            TOPOLOGY B: HOMELAB DEPLOYMENT                              │
│                     (Behind Home Router / CGNAT / Dynamic IP)                          │
│                                                                                        │
│   [Internet Clients]                                                                   │
│   (Mobile App / Web Browser)                                                           │
│           │                                                                            │
│           │ HTTPS (Port 443)                                                           │
│           ▼                                                                            │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │ Cloudflare Global Edge Network                                                 │   │
│   │ - Edge SSL/TLS Termination                                                     │   │
│   │ - Cloudflare Access Zero Trust (Secures Web UI /*)                             │   │
│   │ - Bypass Ingress Rule (/api/v1/attendance/* for Headless Mobile Geofence Pings)│   │
│   └───────────────────────────────────────┬────────────────────────────────────────┘   │
│                                           │ Outbound Encrypted Tunnel (No Open Ports)  │
│                                           ▼                                            │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │ Home Server / NAS (Docker Engine)                                              │   │
│   │                                                                                │   │
│   │  ┌─────────────────────────────────┐   Internal Docker Network                 │   │
│   │  │ cloudflared Tunnel Container    │─────────────────────────┐                 │   │
│   │  └─────────────────────────────────┘                         │                 │   │
│   │                                                              ▼                 │   │
│   │  ┌──────────────────────────────────────────────────────────────────────────┐  │   │
│   │  │ AttendanceTracker Production Container (Port 3000)                       │  │   │
│   │  │ Fastify Server + React Web SPA + Embedded SQLite WAL                     │  │   │
│   │  └────────────────────────┬─────────────────────────────────────────────────┘  │   │
│   │                           │ Mounted Local Storage Volume                       │   │
│   │                           ▼                                                    │   │
│   │  ┌──────────────────────────────────────────────────────────────────────────┐  │   │
│   │  │ Local SSD Host Directory (./data & ./backups)                            │  │   │
│   │  └────────────────────────┬─────────────────────────────────────────────────┘  │   │
│   │                           │ Read-Only Stream Inspection                        │   │
│   │                           ▼                                                    │   │
│   │  ┌──────────────────────────────────────────────────────────────────────────┐  │   │
│   │  │ Litestream Sidecar Container (Continuous WAL Streaming Replication)      │  │   │
│   │  └────────────────────────┬─────────────────────────────────────────────────┘  │   │
│   └───────────────────────────┼────────────────────────────────────────────────────┘   │
│                               │ Real-Time S3 Micro-Transactions (<1s RPO)              │
│                               ▼                                                        │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │ Remote S3 Object Storage (Cloudflare R2 / AWS S3 / MinIO)                      │   │
│   └────────────────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Containerization Architecture

### 2.1 Multi-Stage Docker Build (`docker/Dockerfile`)

The production container combines `apps/web` and `apps/server` into a single, hardened, minimal Alpine image. Native build tools (`python3`, `make`, `g++`) are utilized only in intermediate build stages to compile native C bindings for `better-sqlite3`, ensuring that the final execution container remains under 130MB on disk.

```dockerfile
# ==============================================================================
# Stage 1: Base Alpine Environment & Package Management
# ==============================================================================
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat dumb-init curl
RUN corepack enable && corepack prepare pnpm@9.1.0 --activate
WORKDIR /app

# ==============================================================================
# Stage 2: Dependencies & Native Build Tools
# ==============================================================================
FROM base AS dependencies
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/tsconfig/package.json ./packages/tsconfig/
RUN pnpm install --frozen-lockfile

# ==============================================================================
# Stage 3: Builder (Compile Shared, Web SPA & Fastify Server)
# ==============================================================================
FROM dependencies AS builder
COPY . .
# Build shared TypeScript package
RUN pnpm --filter @attendance/shared build
# Build React Web SPA to apps/web/dist
RUN pnpm --filter @attendance/web build
# Build Fastify backend TypeScript to apps/server/dist
RUN pnpm --filter @attendance/server build
# Prune development dependencies to isolate production runtime node_modules
RUN pnpm prune --prod

# ==============================================================================
# Stage 4: Hardened Production Runtime
# ==============================================================================
FROM node:20-alpine AS runner
LABEL maintainer="AttendanceTracker Engineering"
LABEL description="Unified Fastify API and React Web SPA Single-User Attendance Engine"

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATABASE_PATH=/data/attendance.db \
    NODE_OPTIONS="--max-old-space-size=128 --enable-source-maps=false"

RUN apk add --no-cache dumb-init curl sqlite

# Establish dedicated non-root application user and directories
WORKDIR /app
RUN mkdir -p /data /backups /app/apps/server/dist /app/apps/web/dist && \
    chown -R node:node /app /data /backups

# Copy compiled artifacts and production dependencies from builder
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder --chown=node:node /app/apps/server/dist ./apps/server/dist
COPY --from=builder --chown=node:node /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=builder --chown=node:node /app/apps/server/package.json ./apps/server/package.json
COPY --from=builder --chown=node:node /app/apps/web/dist ./apps/web/dist

# Switch to non-root user (UID 1000)
USER node

# Expose HTTP port and declare local storage mount
EXPOSE 3000
VOLUME ["/data", "/backups"]

# Healthcheck targeting Fastify liveness endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://127.0.0.1:3000/api/v1/health || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "apps/server/dist/index.js"]
```

### 2.2 Unified Web & API Routing in Fastify

The Fastify server simultaneously dispatches API routes and serves the pre-compiled Web SPA static assets:

```typescript
// apps/server/src/app.ts
import fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';

export async function buildApp() {
  const app = fastify({ logger: true });

  // 1. API Route Plugins (/api/v1/*)
  await app.register(import('./routes/health'), { prefix: '/api/v1/health' });
  await app.register(import('./routes/attendance'), { prefix: '/api/v1/attendance' });
  await app.register(import('./routes/schedules'), { prefix: '/api/v1/schedules' });
  await app.register(import('./routes/locations'), { prefix: '/api/v1/locations' });
  await app.register(import('./routes/auth'), { prefix: '/api/v1/auth' });

  // 2. Static Web SPA Assets (/*)
  const webDistPath = path.resolve(__dirname, '../../web/dist');
  await app.register(fastifyStatic, {
    root: webDistPath,
    prefix: '/',
    wildcard: false,
    maxAge: '1d',
    immutable: true
  });

  // 3. SPA Client-Side Routing Fallback
  // Non-API routes send index.html allowing React Router / TanStack Router to resolve client routes
  app.setNotFoundHandler((request, reply) => {
    if (request.raw.url && request.raw.url.startsWith('/api/')) {
      reply.status(404).send({ error: 'Not Found', message: `Route ${request.raw.url} not found` });
      return;
    }
    reply.sendFile('index.html', webDistPath);
  });

  return app;
}
```

### 2.3 Memory & Resource Guardrails
- **V8 Heap Constraint**: `NODE_OPTIONS="--max-old-space-size=128"` enforces garbage collection before the heap exceeds 128MB.
- **Docker Compose Hard Limits**:
  - `memory: 256M` (Hard kill limit)
  - `memory_reservation: 64M` (Soft baseline allocation)
  - `cpus: "0.50"` (Prevents runaway CPU consumption during intensive cryptographic hashing)
- **SQLite Cache Allocation**: `PRAGMA cache_size = -20000;` limits the internal in-memory page cache to exactly 20MB.

---

## 3. Secure Remote Access & Tunneling Architecture

### 3.1 Network Exposure Comparison

| Dimension | Cloudflare Tunnels (`cloudflared`) | Caddy Reverse Proxy | Tailscale Private Mesh | Direct Port Forwarding |
| :--- | :--- | :--- | :--- | :--- |
| **Primary Environment** | Homelab / CGNAT | Public VPS | Homelab Management | Not Recommended |
| **Inbound Port Openings** | **0 (Zero open ports)** | Ports 80 & 443 | 0 (Zero open ports) | Port 443 forwarded |
| **CGNAT & Dynamic IP Support** | **Native (Outbound QUIC)** | Requires public IPv4/IPv6 | Native (DERP NAT traversal)| Fails under CGNAT |
| **TLS Certificate Issuance** | Automatic Edge TLS | Automatic ACME Let's Encrypt | Tailscale MagicDNS Certs | Manual ACME / DDNS |
| **Mobile Geofence Check-in Reliability** | **100% Reliable** | **100% Reliable** | **Poor / High Battery Failure Risk** | High Risk (DDoS, Scanner sweeps) |
| **Zero Trust Access Integration** | Supported (Access Policies) | Requires custom plugin/OIDC | Native WireGuard IAM | None |

---

### 3.2 Homelab Setup: Cloudflare Tunnel (`cloudflared`)

Cloudflare Tunnels establish an outbound-only encrypted connection between the home server and Cloudflare's nearest edge data center. No router ports are forwarded, and the home IP address is completely shielded.

#### Step 1: Install & Authenticate Tunnel
On the host machine, log in to Cloudflare and create the named tunnel:
```bash
# Authenticate CLI with your Cloudflare account
cloudflared tunnel login

# Create tunnel for AttendanceTracker
cloudflared tunnel create attendance-tunnel

# Note the Tunnel ID (UUID) and credentials file generated at:
# ~/.cloudflared/<TUNNEL_UUID>.json
```

#### Step 2: Route DNS to Tunnel
Link your chosen subdomain (e.g., `attendance.example.com`) to the tunnel:
```bash
cloudflared tunnel route dns attendance-tunnel attendance.example.com
```

#### Step 3: Tunnel Configuration File (`cloudflared/config.yml`)
Create `config.yml` on your server host:
```yaml
tunnel: <TUNNEL_UUID>
credentials-file: /etc/cloudflared/credentials.json

# Protocol configuration: use QUIC or http2 for robust outbound streaming
protocol: quic

ingress:
  # Route traffic to internal Docker Compose service
  - hostname: attendance.example.com
    service: http://attendance-tracker:3000
    originRequest:
      connectTimeout: 10s
      noTLSVerify: false
      keepAliveTimeout: 1m
      http2Origin: false

  # Mandatory catch-all drop rule
  - service: http_status:404
```

#### Step 4: Cloudflare Access Zero Trust Auth Bypass for Mobile Geofencing
> **CRITICAL ARCHITECTURAL WARNING**: If you enable Cloudflare Access (Zero Trust) to protect `attendance.example.com` behind Google/GitHub SSO or One-Time PIN, **native mobile background check-ins will fail**.
>
> When iOS CoreLocation or Android GeofenceManager detects a boundary crossing, the OS wakes the mobile app in the background for ~15 seconds to send an HTTP POST request to `/api/v1/attendance/events`. If Cloudflare Access intercepts this request, it responds with an HTTP 302 redirect to the HTML login portal. The mobile background task cannot parse HTML or solve SSO challenges, causing the check-in to be dropped.

**The Solution: Granular Cloudflare Access Policies**
Configure two Access applications in the Cloudflare Zero Trust Dashboard:

1. **Policy 1: Mobile Geofence API & Health Bypass**
   - **Path**: `attendance.example.com/api/v1/*`
   - **Action**: `Bypass`
   - **Rule Criterion**: `Everyone` (or validate incoming custom header `X-Device-Id`)
   - **Security**: This endpoint is strictly authenticated at the application layer by Fastify using the cryptographically secure 256-bit Bearer token (`Authorization: Bearer <API_BEARER_TOKEN>`).
2. **Policy 2: Web Dashboard & Admin UI Protection**
   - **Path**: `attendance.example.com/*`
   - **Action**: `Allow`
   - **Rule Criterion**: Require Identity Provider login (e.g., specific email address via Google/GitHub SSO or Email OTP).

---

### 3.3 Homelab Private Mesh: Tailscale / WireGuard Setup & Battery Caveats

Tailscale creates a secure, point-to-point WireGuard mesh between your home server and your devices.

#### Tailscale Host Setup
```bash
# Install and authenticate Tailscale on the host
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname=attendance-server --ssh
```
Your service is now reachable at `http://attendance-server.<tailnet-name>.ts.net:3000`.

#### The Mobile Battery-Management & Background Sleep Trap
While Tailscale provides exceptional privacy, **it introduces severe reliability risks when used as the sole transport for mobile background geofencing**:

1. **OS Background Radio & Socket Teardown**: Both iOS (APNs/CoreLocation subsystem) and Android (Doze mode) aggressively suspend background network sockets. After 5–10 minutes of screen-off sleep, the mobile OS places the Tailscale/WireGuard VPN client into a suspended state and tears down active UDP keep-alive tunnels.
2. **The 10-Second Watchdog Limit**: When an OS geofence trigger wakes the app, `CLCircularRegion` grants a tight background execution window (typically 10 to 15 seconds) before the OS watchdog terminates the process with error code `0x8badf00d`.
3. **Handshake Latency over DERP**: If the phone transitions from cellular to Wi-Fi near the workplace, the Tailscale VPN interface must re-establish WireGuard keys. If direct UDP traversal fails and traffic must route through a Tailscale DERP relay, the round-trip handshake frequently takes 3 to 7 seconds.
4. **Failure Outcome**: The HTTP POST to `/api/v1/attendance/events` times out, the OS watchdog terminates the app, and the morning arrival is never registered.

**Recommendation**: 
Use Tailscale for private desktop and laptop access to the Web Portal. For the mobile background geofencing client, use **Cloudflare Tunnel** or a **VPS with public HTTPS**, both of which leverage native cellular edge routing with immediate socket handshakes (<300ms).

---

### 3.4 VPS Deployment: Caddy Reverse Proxy

For a VPS with a public IPv4/IPv6 address, Caddy is the recommended reverse proxy due to its automatic ACME TLS issuance, HTTP/3 (QUIC) capability, and simple configuration.

#### Production `Caddyfile`
Save as `./Caddyfile` alongside `docker-compose.yml`:
```caddy
{
    email admin@example.com
    # Enable HTTP/3 (QUIC) over UDP
    servers {
        protocol {
            experimental_http3
        }
    }
}

attendance.example.com {
    # Encode responses using modern compression algorithms
    encode zstd gzip

    # Strict Security Headers
    header {
        # Enforce HTTPS for 1 year including subdomains
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        # Prevent MIME type sniffing
        X-Content-Type-Options "nosniff"
        # Prevent clickjacking / framing
        X-Frame-Options "DENY"
        # Referrer policy
        Referrer-Policy "strict-origin-when-cross-origin"
        # Permissions policy disabling unnecessary device features
        Permissions-Policy "camera=(), microphone=(), geolocation=(self)"
        # Remove server identity header
        -Server
    }

    # Proxy all traffic to Fastify container on internal network
    reverse_proxy attendance-tracker:3000 {
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
        header_up X-Real-IP {remote_host}
        
        # Dial timeout and buffer optimizations
        transport http {
            dial_timeout 5s
            keepalive 1m
        }
    }

    # Logging with rotation
    log {
        output file /var/log/caddy/attendance.access.log {
            roll_size 10mb
            roll_keep 5
        }
        format json
    }
}
```

---

## 4. Push Notification Delivery Pipeline

When an attendance check-in is ingested or an arrival window expiration deadline approaches, the backend dispatches a high-priority push notification.

```
┌─────────────────────────┐
│ AttendanceTracker       │
│ Fastify Backend         │
└───────────┬─────────────┘
            │
            ├─────────────────────────────────────────┐
            │ 1. Primary Mobile Channel               │ 2. Optional Self-Hosted Channel
            ▼                                         ▼
┌─────────────────────────────┐           ┌─────────────────────────────┐
│ Expo Push API               │           │ Self-Hosted ntfy / Gotify   │
│ (https://exp.host/--/api/...) │         │ (Homelab Webhook Relay)     │
└───────────┬─────────────────┘           └───────────┬─────────────────┘
            │                                         │
    ┌───────┴───────┐                                 │
    ▼               ▼                                 ▼
┌───────┐       ┌───────┐                     ┌─────────────────┐
│ APNs  │       │ FCM   │                     │ Desktop Browser │
│(Apple)│       │(Google)                     │ Smartwatch / OS │
└───┬───┘       └───┬───┘                     └─────────────────┘
    │               │
    ▼               ▼
┌───────────────────────┐
│ Sleeping Mobile Phone │
│ (Instant Screen Wake) │
└───────────────────────┘
```

### 4.1 Primary Mobile Pipeline: Expo Push Notification Service
Because iOS and Android completely terminate third-party background WebSockets when the phone is locked, APNs and FCM are the only authorized channels that can wake a sleeping device to display an immediate alert without draining battery.

#### Backend Integration Module
```typescript
// apps/server/src/services/notification.service.ts
import { Expo, ExpoPushMessage } from 'expo-server-sdk';

const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
});

export async function sendArrivalNotification(
  pushToken: string,
  arrivalTimeStr: string,
  status: 'PRESENT' | 'LATE'
) {
  if (!Expo.isExpoPushToken(pushToken)) {
    console.error(`Invalid Expo push token: ${pushToken}`);
    return;
  }

  const message: ExpoPushMessage = {
    to: pushToken,
    sound: 'default',
    title: status === 'PRESENT' ? 'Check-In Confirmed' : 'Late Arrival Recorded',
    body: `Good morning! Marked ${status} at ${arrivalTimeStr}.`,
    data: { status, timestamp: new Date().toISOString() },
    priority: 'high',
    channelId: 'attendance-alerts',
    _displayInForeground: true,
  };

  try {
    const ticketChunk = await expo.sendPushNotificationsAsync([message]);
    console.log('Push ticket received:', ticketChunk);
  } catch (error) {
    console.error('Error dispatching push notification:', error);
  }
}
```

### 4.2 Self-Hosted Notification Alternative: `ntfy`
For users who prefer a self-hosted notification stream for desktop notifications, smartwatch alerts, or Android devices without Google Play Services:

#### Deployment via Docker
```bash
docker run -d \
  --name ntfy \
  --restart unless-stopped \
  -p 8080:80 \
  -v ./ntfy_cache:/var/cache/ntfy \
  binwiederhier/ntfy serve
```

#### Fastify Webhook Relay Dispatcher
```typescript
// apps/server/src/services/ntfy.service.ts
export async function sendNtfyAlert(title: string, message: string, priority: number = 3) {
  const ntfyUrl = process.env.NTFY_URL;
  if (!ntfyUrl) return;

  try {
    await fetch(ntfyUrl, {
      method: 'POST',
      headers: {
        'Title': title,
        'Priority': priority.toString(),
        'Tags': 'white_check_mark,briefcase',
        ...(process.env.NTFY_TOKEN && {
          'Authorization': `Bearer ${process.env.NTFY_TOKEN}`,
        }),
      },
      body: message,
    });
  } catch (err) {
    console.error('ntfy dispatch failed:', err);
  }
}
```

---

## 5. Storage Durability, Backups & Disaster Recovery

### 5.1 SQLite WAL Storage Architecture & Invariants

AttendanceTracker configures SQLite with Write-Ahead Logging (`WAL` mode) upon database connection initialization:
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;
```

#### Absolute Prohibition: Network Mounts (NFS / SMB / CIFS)
> **DANGER — DATA CORRUPTION HAZARD**: The SQLite `/data` directory **MUST NEVER** be hosted on an NFS, SMB, CIFS, or network-attached shared filesystem.

**Technical Root Cause**:
1. SQLite WAL mode requires POSIX shared-memory primitives. It creates a memory-mapped file ending in `-shm` (`attendance.db-shm`) alongside the write-ahead log (`attendance.db-wal`).
2. Network filesystems either do not implement `mmap()` locking semantics correctly or introduce asynchronous caching latency across clients.
3. Network blips cause broken byte-range advisory locks (`fcntl()`), leading immediately to `SQLITE_IOERR_LOCK` or catastrophic, silent database page corruption.
4. **Mandatory Storage Rule**: The Docker volume mount `./data:/data` must always point to a **local host block device** (NVMe SSD, SATA SSD, or direct SATA/SAS HDD formatted in ext4, XFS, APFS, or local ZFS dataset).

---

### 5.2 Live Lock-Free Backups via `VACUUM INTO`

SQLite 3.27+ provides the `VACUUM INTO` command, which produces an atomic, de-fragmented, read-consistent snapshot of the database while concurrent readers and writers continue operating without interruption.

#### Automated Backup Script (`scripts/backup-sqlite.sh`)
```bash
#!/usr/bin/env bash
# ==============================================================================
# AttendanceTracker - Live SQLite Lock-Free Backup Script
# Executes atomic VACUUM INTO, verifies integrity, and enforces retention pruning.
# ==============================================================================
set -euo pipefail

DB_PATH="/data/attendance.db"
BACKUP_DIR="/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
TARGET_FILE="${BACKUP_DIR}/attendance_backup_${TIMESTAMP}.db"

echo "[$(date -u)] Initiating live SQLite backup..."

# Step 1: Execute passive WAL checkpoint to minimize WAL file size
sqlite3 "${DB_PATH}" "PRAGMA wal_checkpoint(PASSIVE);"

# Step 2: Atomic VACUUM INTO backup target file
sqlite3 "${DB_PATH}" "VACUUM INTO '${TARGET_FILE}';"

# Step 3: Verify cryptographic and structural integrity of the newly created snapshot
INTEGRITY_CHECK=$(sqlite3 "${TARGET_FILE}" "PRAGMA integrity_check;")
if [ "${INTEGRITY_CHECK}" != "ok" ]; then
    echo "ERROR: Backup integrity check failed: ${INTEGRITY_CHECK}" >&2
    rm -f "${TARGET_FILE}"
    exit 1
fi

# Step 4: Compute SHA256 checksum
sha256sum "${TARGET_FILE}" > "${TARGET_FILE}.sha256"
echo "[$(date -u)] Backup created successfully: ${TARGET_FILE}"

# Step 5: Enforce Retention Policy
# Retention Rules:
# - Retain all daily backups for the last 30 days
# - Retain weekly backups (Sundays) for the last 12 weeks
# - Retain monthly backups (1st of month) for the last 12 months
find "${BACKUP_DIR}" -name "attendance_backup_*.db" -mtime +30 -exec rm -f {} +
find "${BACKUP_DIR}" -name "attendance_backup_*.db.sha256" -mtime +30 -exec rm -f {} +

echo "[$(date -u)] Retention pruning completed."
```

#### Crontab Automation
Schedule on host machine (`crontab -e`):
```cron
# Run daily lock-free backup at 02:00 AM local time
0 2 * * * docker exec attendance-tracker /bin/sh -c "/app/scripts/backup-sqlite.sh" >> /var/log/attendance_backup.log 2>&1
```

---

### 5.3 Continuous Streaming Replication via Litestream

For zero Recovery Point Objective (RPO < 1s), Litestream monitors SQLite WAL frame writes and streams LSN micro-transactions directly to any S3-compatible bucket (Cloudflare R2, MinIO, AWS S3, or Backblaze B2).

#### Litestream Configuration (`litestream.yml`)
```yaml
dbs:
  - path: /data/attendance.db
    replicas:
      - type: s3
        endpoint: https://${LITESTREAM_ENDPOINT}  # e.g. https://<account_id>.r2.cloudflaredstorage.com
        bucket: attendance-backups
        path: db
        access-key-id: ${LITESTREAM_ACCESS_KEY_ID}
        secret-access-key: ${LITESTREAM_SECRET_ACCESS_KEY}
        sync-interval: 1s
        retention: 720h # 30 days of continuous point-in-time recovery
```

#### Activating Litestream in Docker Compose
Activate Litestream alongside the core service:
```bash
docker compose --profile litestream up -d
```

---

### 5.4 Disaster Recovery Runbook

In the event of hardware failure, catastrophic server corruption, or accidental data loss, follow this procedure to restore full system state.

#### Scenario A: Restoring from a `VACUUM INTO` Daily Snapshot
1. **Stop Application Services**:
   ```bash
   docker compose down
   ```
2. **Locate Latest Valid Snapshot & Verify Checksum**:
   ```bash
   cd ./backups
   sha256sum -c attendance_backup_YYYYMMDD_HHMMSS.db.sha256
   ```
3. **Restore Database File**:
   ```bash
   # Remove corrupted database and any stray WAL/SHM artifacts
   rm -f ./data/attendance.db ./data/attendance.db-wal ./data/attendance.db-shm

   # Copy backup into data directory
   cp ./backups/attendance_backup_YYYYMMDD_HHMMSS.db ./data/attendance.db

   # Set ownership to non-root UID 1000
   chmod 600 ./data/attendance.db
   chown 1000:1000 ./data/attendance.db
   ```
4. **Verify Database Integrity**:
   ```bash
   sqlite3 ./data/attendance.db "PRAGMA integrity_check;"
   # Expected output: ok
   ```
5. **Start Application Services & Confirm Health**:
   ```bash
   docker compose up -d
   docker compose logs -f attendance-tracker
   ```

#### Scenario B: Restoring from Litestream Object Storage
If the local disk has suffered a total loss and only the S3 replica exists:
1. **Provision New Host & Clone Repository**:
   ```bash
   git clone <repo-url> AttendanceTracker
   cd AttendanceTracker
   mkdir -p ./data ./backups
   ```
2. **Execute Litestream Point-in-Time Restore**:
   ```bash
   docker run --rm \
     -v $(pwd)/litestream.yml:/etc/litestream.yml:ro \
     -v $(pwd)/data:/data \
     -e LITESTREAM_ACCESS_KEY_ID="${LITESTREAM_ACCESS_KEY_ID}" \
     -e LITESTREAM_SECRET_ACCESS_KEY="${LITESTREAM_SECRET_ACCESS_KEY}" \
     litestream/litestream:0.3.13 restore -config /etc/litestream.yml -o /data/attendance.db /data/attendance.db
   ```
3. **Fix File Permissions**:
   ```bash
   chmod 600 ./data/attendance.db
   chown -R 1000:1000 ./data
   ```
4. **Boot Containerized Services**:
   ```bash
   docker compose --profile homelab --profile litestream up -d
   ```

---

## 6. Configuration & Environment Variables Reference

AttendanceTracker relies on a single `.env` file located in the root repository directory alongside `docker-compose.yml`.

### 6.1 Environment Variables Reference Table

| Variable Name | Required | Default Value | Description | Production Example |
| :--- | :---: | :--- | :--- | :--- |
| `PORT` | Optional | `3000` | Internal HTTP listening port for Fastify | `3000` |
| `HOST` | Optional | `0.0.0.0` | Network interface binding | `0.0.0.0` |
| `NODE_ENV` | Optional | `production` | Node.js runtime environment mode | `production` |
| `DATABASE_PATH` | Optional | `/data/attendance.db` | Path to persistent SQLite database file inside container | `/data/attendance.db` |
| `SESSION_SECRET` | **Mandatory** | *None* | High-entropy 256-bit secret used to sign session cookies and JWTs | `a8f5c3b9e4...64-hex-chars` |
| `API_BEARER_TOKEN` | **Mandatory** | *None* | Pre-shared 256-bit token for mobile geofence check-in requests | `9e2d7f1a0b...64-hex-chars` |
| `DEFAULT_TIMEZONE` | Optional | `UTC` | Default IANA timezone for calendar date computation | `Asia/Kolkata` or `America/New_York` |
| `EXPO_ACCESS_TOKEN` | Optional | *None* | Expo Push Notification access token for rate-limit bypass | `1b8c_expo_access_token` |
| `NTFY_URL` | Optional | *None* | Endpoint URL for self-hosted ntfy notification topic | `https://ntfy.example.com/attendance` |
| `NTFY_TOKEN` | Optional | *None* | Optional Bearer token for protected ntfy topics | `tk_abc123456789` |
| `CORS_ORIGIN` | Optional | `*` | Allowed CORS origins for browser web requests | `https://attendance.example.com` |
| `CLOUDFLARE_TUNNEL_TOKEN` | Required (Homelab) | *None* | Tunnel credentials token from Cloudflare Zero Trust | `eyJhIjoiNj...tunnel_token` |
| `LITESTREAM_ACCESS_KEY_ID` | Required (Litestream) | *None* | S3 API Access Key ID for continuous replication | `AKIAIOSFODNN7EXAMPLE` |
| `LITESTREAM_SECRET_ACCESS_KEY` | Required (Litestream) | *None* | S3 API Secret Access Key for continuous replication | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` |
| `LITESTREAM_ENDPOINT` | Required (Litestream) | *None* | S3-compatible storage endpoint URL | `<account_id>.r2.cloudflaredstorage.com` |
| `LITESTREAM_BUCKET` | Required (Litestream) | *None* | Destination S3 bucket name | `attendance-backups` |

---

### 6.2 Secret Generation & Setup Script

Generate production credentials securely using OpenSSL:
```bash
# Generate 64-character (256-bit) cryptographically strong secrets
SESSION_SECRET=$(openssl rand -hex 32)
API_BEARER_TOKEN=$(openssl rand -hex 32)

# Create .env file with restricted read permissions (owner-only)
cat <<EOF > .env
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
DATABASE_PATH=/data/attendance.db
SESSION_SECRET=${SESSION_SECRET}
API_BEARER_TOKEN=${API_BEARER_TOKEN}
DEFAULT_TIMEZONE=Asia/Kolkata
EXPO_ACCESS_TOKEN=
NTFY_URL=
CORS_ORIGIN=https://attendance.example.com
EOF

chmod 600 .env
```

---

## 7. Step-by-Step Deployment Runbooks

### 7.1 Runbook 1: Homelab Quickstart (Cloudflare Tunnel)

1. **Prepare Host Directory & Permissions**:
   ```bash
   mkdir -p ./data ./backups
   chmod 700 ./data ./backups
   ```
2. **Generate Configuration & Secrets**:
   Create `.env` using the recipe in Section 6.2. Add `CLOUDFLARE_TUNNEL_TOKEN=<your-token>`.
3. **Launch Docker Services**:
   ```bash
   docker compose --profile homelab up -d
   ```
4. **Verify Container Health & Logs**:
   ```bash
   docker compose ps
   docker compose logs -f attendance-tracker
   ```
5. **Verify Edge Connectivity**:
   ```bash
   curl -i https://attendance.example.com/api/v1/health
   # Expected response: HTTP 200 OK {"status":"ok","timestamp":"..."}
   ```

---

### 7.2 Runbook 2: VPS Quickstart (Caddy Reverse Proxy)

1. **Configure DNS Records**:
   Point an `A` record for `attendance.example.com` to your VPS public IPv4 address, and an `AAAA` record to your IPv6 address.
2. **Prepare Host & Clone Repository**:
   ```bash
   git clone <repo-url> AttendanceTracker
   cd AttendanceTracker
   mkdir -p ./data ./backups
   chmod 700 ./data ./backups
   ```
3. **Configure Caddyfile**:
   Update `Caddyfile` with your domain (`attendance.example.com`) and contact email.
4. **Launch Docker Services with VPS Profile**:
   ```bash
   docker compose --profile vps up -d
   ```
5. **Verify Automatic TLS Issuance**:
   ```bash
   docker compose logs -f caddy
   ```
   Caddy will automatically contact Let's Encrypt, complete the ACME HTTP-01 or TLS-ALPN-01 challenge, issue certificates, and bind to ports 80, 443 (TCP), and 443 (UDP for HTTP/3).

---

## 8. Day-2 Maintenance & Operational Procedures

### 8.1 Monitoring Health & Metrics
- **Container Health**:
  ```bash
  docker inspect --format='{{json .State.Health}}' attendance-tracker | jq .
  ```
- **Live Memory Footprint**:
  ```bash
  docker stats --no-stream attendance-tracker
  ```
  *Expected baseline: CPU < 1%, Memory < 65MB.*

### 8.2 Database Migrations
Database schema migrations run automatically via Drizzle ORM on container startup before the Fastify server opens its listening socket. When upgrading to a new container version:
```bash
docker compose pull attendance-tracker
docker compose up -d attendance-tracker
```
Drizzle applies any pending `.sql` migration files within an isolated transaction. If a migration fails, the container aborts startup and keeps the previous database state intact.

### 8.3 Manual SQLite Defragmentation
Once per quarter, defragment and optimize the SQLite database pages:
```bash
docker exec attendance-tracker sqlite3 /data/attendance.db "PRAGMA optimize;"
```
