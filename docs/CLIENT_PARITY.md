# Client Parity Specification: Web Portal vs Mobile Application

> **Document Version**: 1.0.0 (Milestone 1 Authoritative Specification)  
> **Clients Covered**: Web Portal (`apps/web` - React 18, Vite, Tailwind CSS) & Mobile App (`apps/mobile` - React Native, Expo SDK 51+)  
> **Objective**: Establish complete functional, visual, and behavioral equivalence across both client platforms backed by shared TypeScript contracts (`packages/shared`).

---

## 1. Parity Philosophy & Overview

### 1.1 Complete Functional Equivalence
A single-user attendance management system must provide seamless continuity between desktop workstations and mobile handhelds. Whether configuring workplace boundaries at an office desk, reviewing monthly attendance compliance on an iPad, or checking in automatically while walking through the lobby with a smartphone, both clients operate against the same unified domain model.

### 1.2 Unified Business Rules & Contract Sharing
- **Zero Schema Drift**: Every form input, validation rule, API request DTO, and domain entity originates from `packages/shared`.
- **Shared Validation Logic**: Arrival window constraints (`window_start < window_end < late_cutoff`), geofence radius bounds (`50m` to `500m`), and mandatory audit reasons ($\ge 5$ characters) are validated identically in both clients before any API request is dispatched.
- **Identical State Semantics**: Statuses (`PRESENT`, `LATE`, `ABSENT`, `LEAVE`, `WFH`) and status colors are standardized across web and mobile viewports.

---

## 2. The 5 Core Parity Pillars

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 5 CORE PARITY PILLARS                                  │
├─────────────────────┬─────────────────────┬─────────────────────┬──────────────────────┤
│ 1. Destination Map  │ 2. Schedule Config  │ 3. Activity Heatmap │ 4. Manual Overrides  │
│ Web: MapLibre GL    │ 7-day weekly matrix │ 52-week GitHub grid │ Form + mandatory     │
│ Mobile: RN Maps     │ Mon-Sun arrival     │ Monthly calendar    │ reason + immutable   │
│ Pin drop, geocoding │ windows + cutoff    │ Status colors       │ audit history drawer │
│ & radius slider     │ validation logic    │ Drilldown sheets    │ & visual badge       │
├─────────────────────┴─────────────────────┴─────────────────────┴──────────────────────┤
│ 5. Real-Time Status Widget & Connectivity Sync Pill                                    │
│ Live header banner with 6 dynamic states + offline queue indicator (Green/Amber/Blue/Red)│
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### Pillar 1: Interactive Geofence Destination Map

Both clients render an interactive mapping interface allowing the user to view, define, and tune their primary workplace location.

```
+--------------------------------------------------------------------------------+
|  [Search address or workplace...]                                [Current Loc] |
| +----------------------------------------------------------------------------+ |
| |                                                                            | |
| |                                                                            | |
| |                                 ( Pin )                                    | |
| |                             /             \                                | |
| |                           /   100m Radius   \                              | |
| |                          |     Boundary      |                             | |
| |                           \                 /                              | |
| |                             \             /                                | |
| |                                                                            | |
| +----------------------------------------------------------------------------+ |
|  Latitude: 12.9716° N     Longitude: 77.5946° E      Current Accuracy: ±15m     |
|                                                                                |
|  Geofence Radius: 100 meters                                                   |
|  [--|------------------------------------------------------------------------] |
|  50m (Min)                           100m (Default)                 500m (Max) |
|  ⚠ Warning: Radii under 100m may experience GPS boundary bounce in urban areas.|
+--------------------------------------------------------------------------------+
```

#### Feature Comparison & Implementation Details

| Capability | Web Portal (`apps/web`) | Mobile App (`apps/mobile`) | Parity Guarantee |
| :--- | :--- | :--- | :--- |
| **Map Rendering Engine** | **MapLibre GL** with OpenStreetMap vector tiles | **react-native-maps** (Apple Maps on iOS, Google Maps on Android) | Visual equivalence with circular boundary polygon. |
| **Pin Drop & Coordinate Selection** | Map click event captures `[lng, lat]` coordinates; marker updates position. | Long-press or draggable marker captures `{ latitude, longitude }`. | Identical numeric precision (6 decimal places WGS 84). |
| **Search & Forward Geocoding** | Search input with OpenStreetMap Nominatim or MapLibre geocoder integration. | Native Expo geocoding (`Location.geocodeAsync`) or Nominatim wrapper. | Converts textual addresses to lat/lng with address snippet display. |
| **Radius Configuration Slider** | HTML5 range slider (`50m` to `500m`, step `10m`) styled with Tailwind CSS. | React Native `@react-native-community/slider` (`50m` to `500m`, step `10m`). | Both bind to `radius_meters` with real-time circular polygon scaling. |
| **Circular Boundary Visualizer** | MapLibre GeoJSON circular polygon layer with semi-transparent fill and stroke. | `react-native-maps` `<Circle />` component with `fillColor` and `strokeColor`. | Styling: Stroke `#2563EB`, Fill `rgba(37, 99, 235, 0.20)`. |
| **Urban Jitter Alert** | Warning banner displayed if radius is configured between $50\text{m}$ and $99\text{m}$. | Amber warning callout displayed if radius is configured between $50\text{m}$ and $99\text{m}$. | Alert: "Radii under 100m may experience boundary bounce from GPS drift in urban canyons." |
| **Tile Load Failure Fallback** | Displays SVG coordinate grid with warning banner and manual coordinate inputs. | Displays native map fallback with manual coordinate text fields. | App remains fully usable even if tile server fails or device is offline. |

#### Shared Map Contract (`packages/shared`)
```typescript
export interface GeofenceMapState {
  latitude: number;
  longitude: number;
  radiusMeters: number; // 50 - 500
  addressSnippet?: string;
  isMapLoaded: boolean;
  error?: string | null;
}
```

---

### Pillar 2: Daily Schedule Window Configuration

The schedule configuration screen allows the user to specify working days, arrival time windows, and late cutoffs across a 7-day Monday through Sunday matrix.

```
+--------------------------------------------------------------------------------+
|  WORK SCHEDULE CONFIGURATION                               [ Copy to Weekdays ] |
+--------------------------------------------------------------------------------+
|  Day        Work?  Window Start    Window End      Late Cutoff     Status      |
|  ────────────────────────────────────────────────────────────────────────────  |
|  Monday     [x]    [ 09:00 AM ]    [ 10:00 AM ]    [ 11:30 AM ]    Valid ✓     |
|  Tuesday    [x]    [ 09:00 AM ]    [ 10:00 AM ]    [ 11:30 AM ]    Valid ✓     |
|  Wednesday  [x]    [ 09:00 AM ]    [ 10:00 AM ]    [ 11:30 AM ]    Valid ✓     |
|  Thursday   [x]    [ 09:00 AM ]    [ 10:00 AM ]    [ 11:30 AM ]    Valid ✓     |
|  Friday     [x]    [ 09:00 AM ]    [ 09:30 AM ]    [ 11:00 AM ]    Valid ✓     |
|  Saturday   [ ]    ── Off Day ──   ── Off Day ──   ── Off Day ──   Disabled    |
|  Sunday     [ ]    ── Off Day ──   ── Off Day ──   ── Off Day ──   Disabled    |
|                                                                                |
|  [ Save Schedule Changes ]                                                     |
+--------------------------------------------------------------------------------+
```

#### Client Validation Rules & Implementation Details

1. **7-Day Matrix Representation**:
   - Both clients render an ordered list: Monday (1), Tuesday (2), Wednesday (3), Thursday (4), Friday (5), Saturday (6), Sunday (0).
   - Toggling `is_work_day` to `false` disables the time inputs for that day and visually mutes the row.
2. **Strict Time Sequence Validation**:
   - For any active work day, the client enforces:
     $$\text{window\_start} < \text{window\_end} < \text{late\_cutoff}$$
   - Times are entered and stored as 24-hour `HH:MM:SS` strings (e.g. `09:00:00`, `10:00:00`, `11:30:00`).
   - If a user inputs `window_end` earlier than `window_start`, an inline validation message appears:
     *"Window end (10:00 AM) must be after window start (09:00 AM)."*
   - The "Save Schedule" button is immediately disabled until all active days satisfy validation.
3. **Productivity Shortcut: "Copy to All Weekdays"**:
   - Both Web and Mobile feature a prominent shortcut button: **"Copy Monday to All Weekdays"**. Tapping this button copies Monday's `window_start`, `window_end`, and `late_cutoff` across Tuesday through Friday, setting `is_work_day: true` for all five days.

| Capability | Web Portal (`apps/web`) | Mobile App (`apps/mobile`) |
| :--- | :--- | :--- |
| **Input Controls** | Native HTML `<input type="time" step="60">` or custom Tailwind time picker dropdown. | Native iOS wheel picker / Android time picker via `@react-native-community/datetimepicker`. |
| **Validation Feedback** | Inline red error text below invalid input fields; border color toggles to `border-red-500`. | Inline red error label below input rows; vibration haptic feedback on invalid input. |
| **Save State** | Async mutation with spinner, success toast notification, and optimistic UI update. | Async mutation with floating bottom toast and subtle success haptic feedback. |

---

### Pillar 3: Attendance Calendar Heatmaps

Attendance tracking requires rapid visual assessment of compliance streaks, tardiness patterns, and historical trends. Both clients implement a dual-view attendance heatmap system:
1. **Monthly Calendar Grid**: Traditional month view for day-by-day inspection and drilldown.
2. **GitHub-Style 52-Week Activity Grid**: High-density horizontal annual matrix showing consistency over time.

```
+--------------------------------------------------------------------------------+
|  ATTENDANCE HEATMAP (52 WEEKS)                                     [ 2026 v ]  |
|  Mon  [ ][ ][■][■][■][■][ ][ ][■][■][■][■][ ][ ][■][■][■][■] ...               |
|  Wed  [ ][ ][■][▲][■][■][ ][ ][■][■][■][▲][ ][ ][■][■][■][■] ...               |
|  Fri  [ ][ ][■][■][●][■][ ][ ][■][■][■][■][ ][ ][■][■][■][■] ...               |
|                                                                                |
|  Legend:  ■ Present (Green)  ▲ Late (Amber)  ● Absent (Red)  ◆ Leave (Blue)   |
|  Current Streak: 14 Days   •   On-Time Rate: 94.2%   •   Avg Arrival: 09:14 AM |
+--------------------------------------------------------------------------------+
```

#### Canonical Status Color & Badge Tokens
Both Web and Mobile strictly share the following semantic color system:

| Status Enum | Semantic Meaning | Tailwind Class | Hex Code | Visual Badge Icon |
| :--- | :--- | :--- | :--- | :--- |
| `PRESENT` | Arrived on or before `window_end` | `bg-emerald-500` | `#10B981` | Checkmark Circle (✓) |
| `LATE` | Arrived within `(window_end, late_cutoff]` | `bg-amber-500` | `#F59E0B` | Clock Alert (⏰) |
| `ABSENT` | No check-in registered on active work day | `bg-red-500` | `#EF4444` | Exclamation Circle (!) |
| `LEAVE` | Planned or recorded annual/sick leave | `bg-blue-500` | `#3B82F6` | Calendar Minus (-) |
| `WFH` | Approved Work-From-Home day | `bg-purple-500` | `#8B5CF6` | Home Outline (🏠) |
| `OFF_DAY` | Scheduled non-working day (e.g. weekend) | `bg-zinc-700` | `#3F3F46` | Subtle Muted Dot (·) |

#### Day Detail Drilldown Modal / Bottom Sheet
Tapping any calendar cell or heatmap square opens a comprehensive Day Detail view:
- **Header**: Localized date string (e.g. *"Thursday, November 5, 2026"*), Status Badge (`PRESENT`).
- **Timing Metrics**:
  - Check-In Time: `09:14:22 AM` (local time).
  - Check-Out Time: `05:32:10 PM` (local time).
  - Total Work Duration: `8 hrs 17 mins`.
- **Verification Source Badge**:
  - `GEOFENCE`: Displays coordinates `(12.9716° N, 77.5946° E)`, sensor accuracy `±12m`, and mini static map snapshot.
  - `WIFI_AUTO`: Displays SSID name `Office-Secure-5G` and BSSID `00:14:22:01:23:45`.
  - `MANUAL`: Displays Audit Badge with user note and editor icon.
- **Action Trigger**: Prominent button: **"Adjust / Dispute Record"**, which opens the Manual Override Workflow.

| Presentation | Web Portal (`apps/web`) | Mobile App (`apps/mobile`) |
| :--- | :--- | :--- |
| **Modal Experience** | Centered floating modal dialog with backdrop blur (shadcn/ui `Dialog`). | Native animated bottom sheet modal (slide-up sheet with gesture drag handle). |
| **52-Week Grid Scrolling** | Fully expanded responsive CSS grid fitting desktop displays cleanly. | Horizontally scrollable container with inertia panning and month label sticky header. |

---

### Pillar 4: Manual Adjustment & Override Workflow

When real-world anomalies occur (forgotten phone, dead battery, indoor sensor loss, doctor appointment), the user must be able to adjust historical records retroactively without compromising data integrity.

```
+--------------------------------------------------------------------------------+
|  MANUAL ATTENDANCE ADJUSTMENT                                          [ X ]   |
+--------------------------------------------------------------------------------+
|  Date: Thursday, November 5, 2026                                              |
|                                                                                |
|  Attendance Status:                                                            |
|  ( ) PRESENT    (•) LATE    ( ) ABSENT    ( ) LEAVE    ( ) WFH                 |
|                                                                                |
|  Check-In Time:     [ 10:15 AM ]                                               |
|  Check-Out Time:    [ 05:45 PM ] (Optional)                                    |
|                                                                                |
|  Mandatory Reason / Justification: (Min 5 characters)                          |
|  +--------------------------------------------------------------------------+  |
|  | Forgot phone at home during morning commute. Arrived at desk at 10:15 AM.|  |
|  +--------------------------------------------------------------------------+  |
|  Character count: 74 / 500                                                     |
|                                                                                |
|  [ Cancel ]                                          [ Confirm Adjustment ]    |
+--------------------------------------------------------------------------------+
|  AUDIT TRAIL HISTORY FOR THIS DATE:                                            |
|  • 2026-11-05 18:30:12 UTC by WEB_PORTAL                                       |
|    Changed status: ABSENT -> LATE. Check-in set to 10:15 AM.                   |
|    Reason: "Forgot phone at home during morning commute."                      |
+--------------------------------------------------------------------------------+
```

#### Workflow & Integrity Guarantees
1. **Mandatory Justification Rule**:
   - The adjustment form strictly enforces a minimum justification length of 5 non-whitespace characters. Submitting an empty reason is blocked client-side and rejected by server schema validation (`422 Unprocessable Entity`).
2. **Visual Audit Indicator on Heatmap**:
   - Any attendance record modified or created through manual override displays a visible **Audit Pencil Badge** (✏️) in the corner of its calendar cell on both Web and Mobile.
3. **Immutable Audit History Drawer**:
   - Both clients feature a dedicated **Audit Trail Drawer** inspecting `attendance_audit_logs`.
   - Displays a chronological list of every historical edit for that date, showing:
     - Timestamp of modification in UTC and local time.
     - Origin client (`WEB_PORTAL` or `MOBILE_APP`).
     - Previous status $\rightarrow$ New status.
     - Previous check-in/out times $\rightarrow$ New check-in/out times.
     - Stated justification reason.

---

### Pillar 5: Real-Time Attendance Status Widget & Sync Pill

The home dashboard on both platforms features a live, persistent status badge keeping the user informed of their current daily attendance state, remaining window time, and backend synchronization status.

```
+--------------------------------------------------------------------------------+
|  [ ATTENDANCE STATUS: PRESENT ✓ ]                    [ • SYNCED (Online) ]     |
|  Marked PRESENT at 09:14 AM via Geofence                                       |
|  Workplace: Headquarters (100m Radius) • Work Duration: 4 hrs 12 mins          |
+--------------------------------------------------------------------------------+
```

#### The 6 Dynamic Widget States

| State | Condition | Display Badge | Visual Accent |
| :--- | :--- | :--- | :--- |
| **`AWAITING_WINDOW`** | Current time < `window_start` | *"Window opens in 45m at 09:00 AM"* | Subtle Slate / Zinc Ring |
| **`WINDOW_OPEN`** | Within `[window_start, window_end]` without check-in | *"Arrival window open • 28m remaining"* | Pulsing Emerald Green Ring |
| **`PRESENT`** | Checked in on-time | *"Marked PRESENT at 09:14 AM"* | Solid Emerald Green Badge |
| **`LATE`** | Checked in during grace period | *"Marked LATE at 10:22 AM"* | Solid Amber / Orange Badge |
| **`WINDOW_MISSED`** | Past `window_end` but before `late_cutoff` without check-in | *"Window missed • Cutoff in 14m at 11:30 AM"* | Pulsing Amber Warning Banner |
| **`ON_LEAVE` / `WFH`** | Date pre-marked as Leave or WFH | *"Scheduled Leave Today"* | Solid Sapphire Blue / Violet Badge |

#### Sync & Connectivity Status Indicator (The Sync Pill)
To ensure complete transparency regarding offline durability, a small status pill appears in the top navigation bar of both clients:
- **Green ("Synced")**: All local events are acknowledged by the server; WebSocket/polling confirms backend reachability.
- **Blue ("Syncing...")**: Outbound network requests are actively transmitting pending check-in payloads.
- **Amber ("Offline: N queued")**: Network connection is lost; $N$ geofence events are safely stored in local device SQLite queue awaiting reconnect.
- **Red ("Sync Error")**: Network is reachable but backend returned a non-retryable error (e.g. invalid API token or expired session); prompts user to inspect settings.

---

## 3. Parity Comparison Matrix

| Domain Feature | Web Portal (`apps/web`) | Mobile Application (`apps/mobile`) | Shared Contract / Source | Parity Status |
| :--- | :--- | :--- | :--- | :--- |
| **Map Rendering Engine** | MapLibre GL (Vector tiles) | `react-native-maps` (Native Apple/Google Maps) | `LocationConfigSchema` | **100% Parity** |
| **Geofence Pin Placement** | Mouse click / drag marker | Long-press / draggable pin | `{ latitude, longitude }` | **100% Parity** |
| **Radius Slider & Visualization** | HTML range slider (50–500m) + GeoJSON polygon | `@react-native-community/slider` + Map Circle | `radius_meters` | **100% Parity** |
| **7-Day Schedule Matrix** | Grid table with HTML time inputs | Vertical list with native OS time pickers | `ScheduleConfigItemSchema` | **100% Parity** |
| **Schedule Validation** | Instant inline feedback + disabled button | Instant inline feedback + disabled button | `ScheduleConfigItemSchema.refine` | **100% Parity** |
| **"Copy to All Weekdays"** | Clickable top button | Floating action button / tap link | UI action utility | **100% Parity** |
| **Monthly Calendar Grid** | Responsive month grid with status dots | Month calendar view with swipe navigation | `AttendanceRecordSchema` | **100% Parity** |
| **52-Week Activity Heatmap** | GitHub-style responsive horizontal grid | Horizontally scrollable high-density grid | Matrix rendering utility | **100% Parity** |
| **Status Color System** | Emerald, Amber, Red, Blue, Purple | Emerald, Amber, Red, Blue, Purple | `AttendanceStatusEnum` | **100% Parity** |
| **Day Detail Drilldown** | Centered modal dialog (`Dialog`) | Animated bottom sheet (`BottomSheet`) | `DayDetailModalProps` | **100% Parity** |
| **Manual Override Form** | Time picker + reason textarea | Native time picker + reason text input | `ManualOverrideSchema` | **100% Parity** |
| **Mandatory Reason ($\ge 5$ chars)**| Client form validation + error text | Client form validation + error text | `ManualOverrideSchema` | **100% Parity** |
| **Audit Trail History Drawer** | Slide-out side drawer | Full-screen drilldown modal | `AttendanceAuditLogSchema` | **100% Parity** |
| **Visual Audit Indicator (✏️)** | Badge on calendar cell | Badge on calendar cell | Cell badge component | **100% Parity** |
| **Live Status Card Widget** | Top header dashboard banner | Top home screen status card | `computeAttendanceStatus` | **100% Parity** |
| **Sync / Connectivity Pill** | Network status indicator | Network status + SQLite queue counter | Network listener / queue count | **100% Parity** |
| **Data Export (CSV & JSON)** | Direct browser file download stream | File system share / export action sheet | `/api/v1/export` | **100% Parity** |
| **Single-User Authentication** | Argon2id master password $\rightarrow$ JWT cookie | Pre-shared Bearer API Token $\rightarrow$ Keystore | Auth headers | **100% Parity** |

---

## 4. Shared State Contracts & Component Props

To guarantee structural consistency, both applications implement identical component prop interfaces defined in `packages/shared`.

### 4.1 Geofence Map Component Contract
```typescript
export interface GeofenceMapProps {
  initialLatitude: number;
  initialLongitude: number;
  initialRadiusMeters: number;
  onLocationChange: (coords: { latitude: number; longitude: number }) => void;
  onRadiusChange: (radiusMeters: number) => void;
  interactive?: boolean;
  showAccuracyCircle?: boolean;
  accuracyRadiusMeters?: number;
}
```

### 4.2 Schedule Editor Component Contract
```typescript
export interface ScheduleEditorProps {
  initialSchedule: ScheduleConfigItem[];
  onSaveSchedule: (updatedSchedule: ScheduleConfigItem[]) => Promise<void>;
  isLoading: boolean;
  isSaving: boolean;
}
```

### 4.3 Activity Heatmap Component Contract
```typescript
export interface AttendanceHeatmapProps {
  records: AttendanceRecord[];
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  onSelectDate: (date: string) => void;
  selectedDate?: string | null;
}
```

### 4.4 Manual Override Modal Contract
```typescript
export interface ManualOverrideModalProps {
  isOpen: boolean;
  onClose: () => void;
  recordDate: string; // YYYY-MM-DD
  existingRecord?: AttendanceRecord | null;
  auditHistory: AttendanceAuditLog[];
  onSubmitOverride: (payload: ManualOverride) => Promise<void>;
  isSubmitting: boolean;
}
```

### 4.5 Real-Time Status Widget Contract
```typescript
export interface RealTimeStatusWidgetProps {
  currentStatus: AttendanceStatus | 'AWAITING_WINDOW' | 'WINDOW_OPEN' | 'WINDOW_MISSED';
  todayRecord?: AttendanceRecord | null;
  todaySchedule?: ScheduleConfigItem | null;
  currentTime: string; // HH:MM:SS local
  syncState: 'SYNCED' | 'SYNCING' | 'OFFLINE' | 'ERROR';
  offlineQueueCount: number;
}
```
