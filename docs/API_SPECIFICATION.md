# REST API Specification & OpenAPI 3.1 Contract

## 1. Overview & General Standards

The Attendance Tracker API is a RESTful interface designed for high-reliability communication between the centralized Fastify server and its two clients: the **Mobile App** (React Native / Expo) and the **Web Portal** (React / Vite).

### Standards & Conventions
- **Specification Format**: OpenAPI 3.1.0 compatible.
- **Base URL**: `/api/v1`
- **Data Serialization**: JSON (`application/json; charset=utf-8`) for standard endpoints; `text/csv` for CSV export.
- **Date & Time Formats**:
  - Timestamps: ISO 8601 extended UTC format with millisecond precision (e.g. `2026-11-05T09:14:22.123Z`).
  - Dates: Local calendar dates in `YYYY-MM-DD` format (e.g. `2026-11-05`), anchored to user's IANA timezone.
  - Times: 24-hour time strings in `HH:mm:ss` format (e.g. `09:00:00`).
- **Idempotency**: All arrival ingestion requests accept a unique `idempotency_key` (UUID v4) and enforce unique constraints on `(user_id, date)`.
- **Security Schemes**:
  1. `CookieAuth`: Signed HTTP-only session cookie named `session_token` for Web Portal.
  2. `BearerAuth`: High-entropy 64-character hex API token in `Authorization: Bearer <TOKEN>` for Mobile App.

---

## 2. Standard Error Model (RFC 9457 Problem Details)

All API errors return a standard RFC 9457 JSON response with HTTP status code matching the envelope:

```json
{
  "type": "https://attendance-tracker.local/errors/invalid-parameters",
  "title": "Unprocessable Entity",
  "status": 422,
  "detail": "Request body failed validation against target schema.",
  "instance": "/api/v1/attendance/events",
  "invalid_params": [
    {
      "name": "occurred_at",
      "reason": "Timestamp cannot be more than 5 minutes in the future."
    }
  ]
}
```

### Standard Status Codes
- `200 OK`: Request succeeded; returns data.
- `201 Created`: Resource created successfully.
- `400 Bad Request`: Malformed JSON or invalid syntax.
- `401 Unauthorized`: Missing or invalid session cookie / Bearer token.
- `403 Forbidden`: Authenticated subject lacks required permissions.
- `404 Not Found`: Target resource does not exist.
- `409 Conflict`: Resource state conflict (e.g., duplicate entity or conflicting status).
- `422 Unprocessable Entity`: Semantic validation failed (e.g. Zod schema violation, invalid timestamp range, missing dispute reason).
- `500 Internal Server Error`: Unhandled server exception (sanitized to prevent information disclosure).

---

## 3. Endpoints Matrix

| Group | Method | Path | Auth | Rate Limit | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **System** | `GET` | `/health` | None | None | Liveness & container healthcheck |
| **Auth** | `POST` | `/auth/login` | None | 5 req / min | Web login with master passphrase |
| **Auth** | `POST` | `/auth/logout` | Cookie | None | Invalidate session cookie |
| **Auth** | `GET` | `/auth/me` | Either | 60 req / min | Get authenticated user info & timezone |
| **Auth** | `POST` | `/auth/token/rotate` | Cookie | 5 req / min | Rotate mobile API token & display QR |
| **Ingestion** | `POST` | `/attendance/events` | Either | 60 req / min | Ingest single geofence/Wi-Fi event |
| **Ingestion** | `POST` | `/attendance/events/batch` | Either | 30 req / min | Batch offline queue replay |
| **Records** | `GET` | `/attendance/today` | Either | 60 req / min | Real-time status for current date |
| **Records** | `GET` | `/attendance/records` | Either | 60 req / min | Query records by date range |
| **Records** | `POST` | `/attendance/records/override`| Either | 30 req / min | Retroactive dispute/override with audit |
| **Schedule** | `GET` | `/schedules` | Either | 60 req / min | Retrieve weekly 7-day schedule |
| **Schedule** | `PUT` | `/schedules` | Either | 20 req / min | Update weekly schedule windows |
| **Location** | `GET` | `/locations` | Either | 60 req / min | Retrieve geofence boundaries |
| **Location** | `PUT` | `/locations` | Either | 20 req / min | Update geofence coordinates/radius |
| **Analytics**| `GET` | `/analytics/stats` | Either | 60 req / min | Calculate streaks, on-time %, averages |
| **Export** | `GET` | `/attendance/export` | Either | 10 req / min | Stream CSV or JSON historical backup |
| **Notify** | `POST` | `/notifications/register-token` | Either | 20 req / min | Register Expo push token |
| **Notify** | `DELETE`| `/notifications/register-token` | Either | 20 req / min | Unregister Expo push token |

---

## 4. Detailed Endpoint Specifications

### 4.1 System & Health

#### `GET /api/v1/health`
Checks container health and database connectivity.

- **Headers**: None
- **Response `200 OK`**:
  ```json
  {
    "status": "healthy",
    "timestamp": "2026-11-05T13:55:00.000Z",
    "uptime_seconds": 86420,
    "database": {
      "connected": true,
      "wal_mode": true
    },
    "version": "1.0.0"
  }
  ```
- **Response `500 Internal Server Error`**: Database connection failed or disk full.

---

### 4.2 Authentication Endpoints

#### `POST /api/v1/auth/login`
Authenticates the user using the master passphrase for the web portal.

- **Rate Limit**: 5 requests per minute (IP-based brute-force prevention).
- **Request Body**:
  ```json
  {
    "password": "CorrectMasterPassphraseHere"
  }
  ```
- **Response `200 OK`**:
  - Sets Header: `Set-Cookie: session_token=...; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=1209600`
  ```json
  {
    "user": {
      "id": "c1f7b0a8-3a21-4d1e-9876-123456789abc",
      "username": "admin",
      "timezone": "Asia/Kolkata"
    },
    "expires_at": "2026-11-19T13:55:00.000Z"
  }
  ```
- **Response `401 Unauthorized`**:
  ```json
  {
    "type": "https://attendance-tracker.local/errors/invalid-credentials",
    "title": "Unauthorized",
    "status": 401,
    "detail": "Invalid master passphrase supplied."
  }
  ```

---

#### `POST /api/v1/auth/logout`
Terminates the current web session.

- **Auth Required**: `CookieAuth`
- **Response `200 OK`**:
  - Sets Header: `Set-Cookie: session_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
  ```json
  {
    "message": "Successfully logged out."
  }
  ```

---

#### `GET /api/v1/auth/me`
Retrieves information about the currently authenticated user.

- **Auth Required**: `CookieAuth` OR `BearerAuth`
- **Response `200 OK`**:
  ```json
  {
    "id": "c1f7b0a8-3a21-4d1e-9876-123456789abc",
    "username": "admin",
    "timezone": "Asia/Kolkata",
    "auth_type": "WEB_SESSION"
  }
  ```
- **Response `401 Unauthorized`**: Missing or expired session.

---

#### `POST /api/v1/auth/token/rotate`
Generates a new mobile API Bearer token, invalidating any existing mobile tokens.

- **Auth Required**: `CookieAuth` (Must be invoked from web portal)
- **Response `200 OK`**:
  ```json
  {
    "api_token": "8f3b9c71a02e4d5f6b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a",
    "created_at": "2026-11-05T13:55:00.000Z",
    "instructions": "Enter this token into your mobile app or scan the displayed QR code."
  }
  ```

---

### 4.3 Ingestion Endpoints (Mobile Geofencing & Wi-Fi)

#### `POST /api/v1/attendance/events`
*(Backward-compatible alias: `POST /api/v1/attendance/check-in`)*

Ingests a single geofence boundary or Wi-Fi trigger event.

- **Auth Required**: `BearerAuth` OR `CookieAuth`
- **Request Headers**:
  - `Content-Type: application/json`
  - `Authorization: Bearer <API_TOKEN>`
- **Request Body (Zod: `AttendanceEventRequestSchema`)**:
  ```json
  {
    "event_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "user_id": "usr_01h8abc1234567890abcdef123",
    "event_type": "ENTER",
    "source": "GEOFENCE",
    "occurred_at": "2026-11-05T09:14:22.000Z",
    "latitude": 12.971598,
    "longitude": 77.594566,
    "accuracy_meters": 15.4,
    "client_dispatch_time": "2026-11-05T09:14:23.000Z",
    "monotonic_timestamp_ms": 12845678,
    "satellite_atomic_epoch": 1762334062,
    "battery_level": 0.84,
    "wifi_ssid": "Office_5G",
    "wifi_bssid": "00:14:22:01:23:45",
    "device_info": {
      "device_id": "iphone-15-pro-a2849",
      "platform": "IOS",
      "os_version": "18.1",
      "app_version": "1.0.0",
      "is_mock_provider": false
    }
  }
  ```
- **Validation Rules**:
  - `event_id`: Valid UUID v4 string (also accepts `idempotency_key` as alias).
  - `user_id`: Valid user UUID string.
  - `event_type`: Must be `'ENTER'`, `'EXIT'`, or `'DWELL'`.
  - `source`: Must be `'GEOFENCE'`, `'WIFI_AUTO'`, or `'MANUAL'`.
  - `occurred_at`: ISO 8601 UTC timestamp of hardware sensor breach.
  - `client_dispatch_time`: ISO 8601 UTC timestamp of HTTP dispatch (used to evaluate network/clock skew without misclassifying offline queue latency).
  - `latitude`: `[-90, 90]` (optional if source is `WIFI_AUTO`).
  - `longitude`: `[-180, 180]` (optional if source is `WIFI_AUTO`).
  - `accuracy_meters`: Positive float, nullable.
  - `monotonic_timestamp_ms`: Positive integer hardware uptime counter.
  - `battery_level`: Float between 0.0 and 1.0.
- **Response `201 Created` (Initial Check-In Recorded - `NEW_CHECK_IN`)**:
  ```json
  {
    "event_status": "CREATED",
    "record": {
      "id": "rec_01h8abc1234567890abcdef123",
      "date": "2026-11-05",
      "status": "PRESENT",
      "check_in_time": "2026-11-05T09:14:22.000Z",
      "check_out_time": null,
      "source": "GEOFENCE",
      "accuracy_meters": 15.4,
      "notes": null
    },
    "notification_dispatched": true
  }
  ```
- **Response `200 OK` (Idempotent Subsequent Entry - e.g. Returning from Lunch)**:
  ```json
  {
    "event_status": "ALREADY_RECORDED",
    "message": "Check-in for 2026-11-05 is already recorded; initial check-in time preserved.",
    "record": {
      "id": "rec_01h8abc1234567890abcdef123",
      "date": "2026-11-05",
      "status": "PRESENT",
      "check_in_time": "2026-11-05T09:14:22.000Z",
      "check_out_time": null,
      "source": "GEOFENCE",
      "accuracy_meters": 15.4,
      "notes": null
    },
    "notification_dispatched": false
  }
  ```
- **Response `200 OK` (Geofence Departure Recorded)**:
  ```json
  {
    "event_status": "CHECK_OUT_UPDATED",
    "record": {
      "id": "rec_01h8abc1234567890abcdef123",
      "date": "2026-11-05",
      "status": "PRESENT",
      "check_in_time": "2026-11-05T09:14:22.000Z",
      "check_out_time": "2026-11-05T17:30:15.000Z",
      "source": "GEOFENCE",
      "accuracy_meters": 12.1,
      "notes": null
    }
  }
  ```
- **Response `200 OK` (Delayed Offline Check-In Overwrote Auto-Reconciled Absence)**:
  ```json
  {
    "event_status": "RECONCILED_ABSENCE_OVERWRITTEN",
    "message": "Delayed offline check-in for 2026-11-05 overwrote auto-reconciled absence. Status updated to PRESENT.",
    "record": {
      "id": "rec_01h8abc1234567890abcdef123",
      "date": "2026-11-05",
      "status": "PRESENT",
      "check_in_time": "2026-11-05T09:14:22.000Z",
      "check_out_time": null,
      "source": "GEOFENCE",
      "accuracy_meters": 15.4,
      "notes": "Offline check-in replayed: overwrote auto-reconciled absence"
    }
  }
  ```
- **Response `200 OK` (EXIT Event Prior to Initial Check-In)**:
  ```json
  {
    "event_status": "IGNORED_NO_CHECK_IN",
    "message": "Ignored exit event on 2026-11-05 because no prior check-in exists. Preserving date for subsequent ENTER events.",
    "record": null
  }
  ```
- **Response `422 Unprocessable Entity`**: Terminal schema validation error (malformed payload, invalid coordinates, or unparseable UUID). Client moves event to `DEAD_LETTER`.
- **Response `500/502/503/504`**: Transient server error. Client increments retry count and retries with jittered exponential backoff.

---

#### `POST /api/v1/attendance/events/batch`
Drains the offline event queue from the mobile client when network connectivity is restored.

- **Auth Required**: `BearerAuth` OR `CookieAuth`
- **Request Body**:
  ```json
  {
    "events": [
      {
        "idempotency_key": "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d",
        "event_type": "ENTER",
        "source": "GEOFENCE",
        "occurred_at": "2026-11-04T09:12:00.000Z",
        "latitude": 12.971598,
        "longitude": 77.594566,
        "accuracy_meters": 20.0
      },
      {
        "idempotency_key": "b2c3d4e5-f6a1-4b2c-9d3e-4f5a6b7c8d9e",
        "event_type": "EXIT",
        "source": "GEOFENCE",
        "occurred_at": "2026-11-04T17:15:00.000Z",
        "latitude": 12.971598,
        "longitude": 77.594566,
        "accuracy_meters": 25.0
      }
    ]
  }
  ```
- **Processing Guarantees**:
  - Events are sorted ascending by `occurred_at` and processed sequentially within an atomic database transaction.
  - Returns array of individual event results with matching `idempotency_key`.
- **Response `200 OK`**:
  ```json
  {
    "processed_count": 2,
    "results": [
      {
        "idempotency_key": "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d",
        "status": "CREATED",
        "record_id": "rec_past_001"
      },
      {
        "idempotency_key": "b2c3d4e5-f6a1-4b2c-9d3e-4f5a6b7c8d9e",
        "status": "CHECK_OUT_UPDATED",
        "record_id": "rec_past_001"
      }
    ]
  }
  ```

---

### 4.4 Records & Override Endpoints

#### `GET /api/v1/attendance/today`
Returns the user's real-time attendance status and arrival state for today.

- **Auth Required**: `BearerAuth` OR `CookieAuth`
- **Response `200 OK` (Checked In Today)**:
  ```json
  {
    "date": "2026-11-05",
    "timezone": "Asia/Kolkata",
    "is_work_day": true,
    "schedule": {
      "window_start": "09:00:00",
      "window_end": "10:00:00",
      "late_cutoff": "11:30:00"
    },
    "record": {
      "id": "rec_01h8abc1234567890abcdef123",
      "status": "PRESENT",
      "check_in_time": "2026-11-05T09:14:22.000Z",
      "check_out_time": null,
      "source": "GEOFENCE"
    }
  }
  ```
- **Response `200 OK` (Not Yet Checked In)**:
  ```json
  {
    "date": "2026-11-05",
    "timezone": "Asia/Kolkata",
    "is_work_day": true,
    "schedule": {
      "window_start": "09:00:00",
      "window_end": "10:00:00",
      "late_cutoff": "11:30:00"
    },
    "record": null,
    "window_status": "OPEN",
    "minutes_remaining": 45
  }
  ```

---

#### `GET /api/v1/attendance/records`
Queries historical attendance records across a date range.

- **Auth Required**: `BearerAuth` OR `CookieAuth`
- **Query Parameters**:
  - `start_date` (required): `'YYYY-MM-DD'` (e.g. `'2026-11-01'`)
  - `end_date` (required): `'YYYY-MM-DD'` (e.g. `'2026-11-30'`)
  - `status` (optional): Filter by `'PRESENT'`, `'LATE'`, `'ABSENT'`, `'LEAVE'`, or `'WFH'`.
- **Response `200 OK`**:
  ```json
  {
    "start_date": "2026-11-01",
    "end_date": "2026-11-30",
    "total_records": 4,
    "records": [
      {
        "id": "rec_01",
        "date": "2026-11-03",
        "status": "PRESENT",
        "check_in_time": "2026-11-03T09:10:00.000Z",
        "check_out_time": "2026-11-03T17:35:00.000Z",
        "source": "GEOFENCE",
        "notes": null
      },
      {
        "id": "rec_02",
        "date": "2026-11-04",
        "status": "LATE",
        "check_in_time": "2026-11-04T10:15:00.000Z",
        "check_out_time": "2026-11-04T18:00:00.000Z",
        "source": "GEOFENCE",
        "notes": null
      }
    ]
  }
  ```
- **Response `400 Bad Request`**: `start_date` is later than `end_date`.

---

#### `POST /api/v1/attendance/records/override`
Manually adjusts, corrects, or creates an attendance entry for any date. Enforces mandatory audit justification.

- **Auth Required**: `BearerAuth` OR `CookieAuth`
- **Request Body (Zod: `ManualOverrideRequestSchema`)**:
  ```json
  {
    "date": "2026-11-04",
    "status": "PRESENT",
    "check_in_time": "2026-11-04T09:15:00.000Z",
    "check_out_time": "2026-11-04T17:30:00.000Z",
    "reason": "Phone ran out of battery at office entrance; verified via security gate badge.",
    "client_source": "WEB"
  }
  ```
- **Validation Rules**:
  - `date`: Valid calendar date string `'YYYY-MM-DD'`.
  - `status`: Must be one of `['PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'WFH']`.
  - `check_in_time`: Mandatory if status is `PRESENT` or `LATE`; must be null or omitted if `ABSENT` or `LEAVE`.
  - `reason`: Mandatory text string with minimum 5 characters explaining the modification.
  - `client_source`: `'WEB'` or `'MOBILE'`.
- **Response `200 OK`**:
  ```json
  {
    "record": {
      "id": "rec_02",
      "date": "2026-11-04",
      "status": "PRESENT",
      "check_in_time": "2026-11-04T09:15:00.000Z",
      "check_out_time": "2026-11-04T17:30:00.000Z",
      "source": "MANUAL",
      "notes": "Phone ran out of battery at office entrance; verified via security gate badge."
    },
    "audit_log": {
      "id": "aud_01h8xyz987",
      "record_id": "rec_02",
      "previous_status": "LATE",
      "new_status": "PRESENT",
      "reason": "Phone ran out of battery at office entrance; verified via security gate badge.",
      "client_source": "WEB",
      "created_at": "2026-11-05T13:58:00.000Z"
    }
  }
  ```
- **Response `422 Unprocessable Entity`**: Reason is missing or shorter than 5 characters.

---

### 4.5 Schedule Configuration Endpoints

#### `GET /api/v1/schedules`
Returns the 7-day weekly schedule configuration (Sunday=0 to Saturday=6).

- **Auth Required**: `BearerAuth` OR `CookieAuth`
- **Response `200 OK`**:
  ```json
  {
    "schedules": [
      {
        "id": "sch_0",
        "day_of_week": 0,
        "is_work_day": false,
        "window_start": "09:00:00",
        "window_end": "10:00:00",
        "late_cutoff": "11:30:00"
      },
      {
        "id": "sch_1",
        "day_of_week": 1,
        "is_work_day": true,
        "window_start": "09:00:00",
        "window_end": "10:00:00",
        "late_cutoff": "11:30:00"
      }
    ]
  }
  ```

---

#### `PUT /api/v1/schedules`
Updates the 7-day schedule configuration.

- **Auth Required**: `BearerAuth` OR `CookieAuth`
- **Request Body**:
  ```json
  {
    "schedules": [
      {
        "day_of_week": 1,
        "is_work_day": true,
        "window_start": "08:30:00",
        "window_end": "09:30:00",
        "late_cutoff": "11:00:00"
      }
    ]
  }
  ```
- **Validation Rules**:
  - `window_start < window_end < late_cutoff` in standard 24-hr format.
- **Response `200 OK`**: Updated schedule items returned.

---

### 4.6 Location Configuration Endpoints

#### `GET /api/v1/locations`
Retrieves the workplace geofence boundaries and Wi-Fi configurations.

- **Auth Required**: `BearerAuth` OR `CookieAuth`
- **Response `200 OK`**:
  ```json
  {
    "locations": [
      {
        "id": "loc_01",
        "name": "Headquarters",
        "latitude": 12.971598,
        "longitude": 77.594566,
        "radius_meters": 100,
        "wifi_ssid": "Office_Network",
        "wifi_bssid": "00:14:22:01:23:45",
        "is_active": true
      }
    ]
  }
  ```

---

#### `PUT /api/v1/locations`
Updates or sets the active workplace location.

- **Auth Required**: `BearerAuth` OR `CookieAuth`
- **Request Body**:
  ```json
  {
    "name": "Headquarters Tech Park",
    "latitude": 12.971598,
    "longitude": 77.594566,
    "radius_meters": 150,
    "wifi_ssid": "Office_Network_5G",
    "wifi_bssid": "00:14:22:01:23:45",
    "is_active": true
  }
  ```
- **Validation Rules**:
  - `radius_meters`: Integer between `50` and `500` (inclusive).
  - `latitude`: Float between `-90.0` and `90.0`.
  - `longitude`: Float between `-180.0` and `180.0`.
- **Response `200 OK`**: Returns updated location record.

---

### 4.7 Analytics & Statistics

#### `GET /api/v1/analytics/stats`
Computes key performance indicators (streak counter, on-time percentage, average arrival time) over a specified period.

- **Auth Required**: `BearerAuth` OR `CookieAuth`
- **Query Parameters**:
  - `month` (optional, e.g. `'2026-11'`): Defaults to current month in user's timezone.
- **Response `200 OK`**:
  ```json
  {
    "period": "2026-11",
    "metrics": {
      "total_work_days": 21,
      "days_present": 18,
      "days_late": 2,
      "days_absent": 1,
      "days_leave": 0,
      "on_time_percentage": 90.0,
      "current_streak_days": 12,
      "longest_streak_days": 24,
      "average_arrival_time": "09:16:30"
    }
  }
  ```

---

### 4.8 Data Export

#### `GET /api/v1/attendance/export?format=csv|json`
Streams an export of attendance history and audit logs.

- **Auth Required**: `BearerAuth` OR `CookieAuth`
- **Query Parameters**:
  - `start_date` (optional, default: 1 year ago)
  - `end_date` (optional, default: today)
  - `format` (required): `'csv'` or `'json'`
- **Response Headers (for `format=csv`)**:
  - `Content-Type: text/csv; charset=utf-8`
  - `Content-Disposition: attachment; filename="attendance_export_2026-11-05.csv"`
- **Response Body (CSV Example)**:
  ```csv
  Date,Status,CheckInTime,CheckOutTime,Source,AccuracyMeters,Notes
  2026-11-03,PRESENT,2026-11-03T09:10:00.000Z,2026-11-03T17:35:00.000Z,GEOFENCE,14.2,
  2026-11-04,LATE,2026-11-04T10:15:00.000Z,2026-11-04T18:00:00.000Z,GEOFENCE,18.0,
  ```

---

### 4.9 Push Device Token Registration

#### `POST /api/v1/notifications/register-token`
Registers a mobile device's Expo push token for arrival and warning notifications.

- **Auth Required**: `BearerAuth` OR `CookieAuth`
- **Request Body**:
  ```json
  {
    "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
    "platform": "ios",
    "device_name": "iPhone 15 Pro"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "registered": true,
    "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
  }
  ```

#### `DELETE /api/v1/notifications/register-token`
Unregisters a mobile device push token on logout or app removal.

- **Auth Required**: `BearerAuth` OR `CookieAuth`
- **Request Body**:
  ```json
  {
    "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "unregistered": true
  }
  ```
