# Mobile Geofencing & Background Execution Mechanics

**Document Version**: 1.0.0  
**Authoritative Scope**: Native iOS CoreLocation, Android GeofenceManager, Expo TaskManager, Power Optimizations, Durability Queues, Clock Integrity, and Idempotent Ingestion.  
**Target Systems**: iOS 15+ (CoreLocation), Android 10–15 (Google Play Services Geofencing), React Native / Expo Custom Development Builds, Centralized Self-Hosted Backend.

---

## 1. Executive Summary & Architectural Imperative

Automated attendance tracking requires reliable, zero-touch check-ins when an individual arrives at their workplace. However, modern mobile operating systems enforce aggressive power management policies to preserve battery life and protect user privacy:
1. **Web Browser Suspension**: Modern mobile browsers (Safari on WebKit, Chrome on Blink) completely suspend JavaScript runtimes, Web Workers, and W3C Geolocation API polling within 10 to 30 seconds after the screen locks or the application transitions to the background. Progressive Web Applications (PWAs) cannot maintain background boundary monitoring.
2. **Native Geofence Offloading**: Both Apple iOS (`CoreLocation`) and Google Android (`GeofencingClient`) provide dedicated operating system location daemons that offload boundary surveillance directly to low-power baseband processors and hardware sensor hubs (DSP/microcontrollers).
3. **The Dual-Client Architecture**: To satisfy zero-touch presence detection, the system pairs a native mobile client (handling hardware boundary interception) with a feature-equivalent web portal (handling visualization, schedule definition, and manual overrides), bound by a unified backend API and shared contract schemas.

This document defines the end-to-end technical mechanics of native boundary monitoring, background task execution, client-side offline durability, anti-tampering heuristics, and idempotent status evaluation.

```
+---------------------------------------------------------------------------------------------------+
|                                  PHYSICAL ENVIRONMENT SENSORS                                     |
|  +-----------------------------+  +-------------------------------+  +-------------------------+  |
|  |  Cellular Towers (Macro)    |  |  Wi-Fi Access Points (Meso)   |  |   GNSS Satellites (Micro)| |
|  +-----------------------------+  +-------------------------------+  +-------------------------+  |
+-------------------------------------------------+-------------------------------------------------+
                                                  |
                                                  v
+-------------------------------------------------+-------------------------------------------------+
|                                 NATIVE OS LOCATION SUBSYSTEM                                      |
|  [iOS: CoreLocation Daemon (locationd)]         |   [Android: Google Play Services Geofence Hub]  |
|  - CLCircularRegion Monitoring                  |   - GeofencingClient Hardware Offload           |
|  - Significant-Change Location Service (SLS)   |   - PendingIntent IntentService Wakeup          |
|  - Dwell Filter: 120s loitering delay           |   - Dwell Filter: 120s loitering delay          |
|  - Hysteresis Margin: Radius + 50m              |   - Hysteresis Margin: Radius + 50m             |
+-------------------------------------------------+-------------------------------------------------+
                                                  | Boundary Breach Wakeup
                                                  v
+-------------------------------------------------+-------------------------------------------------+
|                           HEADLESS BACKGROUND JAVASCRIPT RUNTIME                                  |
|   Expo TaskManager (`TaskManager.defineTask` declared in global module scope in `index.js`)       |
|                                                                                                   |
|   1. Extract Hardware Event Telemetry & GNSS Atomic Epoch                                         |
|   2. Sample Monotonic Clock (`SystemClock.elapsedRealtime()`)                                    |
|   3. Persist Event to Durable Local SQLite Queue (`geofence_event_queue` -> PENDING)              |
+-------------------------------------------------+-------------------------------------------------+
                                                  |
                         +------------------------+------------------------+
                         | Network Available?                              | Offline / Unreachable
                         v                                                 v
+------------------------+------------------------+      +-----------------+------------------------+
|   DISPATCH HTTP POST TO BACKEND API             |      | RETAIN IN SQLITE DURABILITY QUEUE        |
|   `POST /api/v1/attendance/events`              |      | - Trigger on NetInfo reconnect           |
|   Payload: GeofenceEventPayload                 |      | - Trigger on Expo BackgroundFetch        |
|                                                 |      | - Exponential backoff with full jitter   |
+------------------------+------------------------+      +------------------------------------------+
                         |
                         v
+------------------------+--------------------------------------------------------------------------+
|                            CENTRALIZED SERVER INGESTION & EVALUATION                              |
|   1. Validate Clock Skew: |Delta_skew| <= 300s                                                    |
|   2. Check Idempotency: Composite Unique Key (user_id, local_date)                                |
|   3. Evaluate Schedule Windows:                                                                   |
|      - T <= Window_End                 ==> PRESENT                                                |
|      - Window_End < T <= Late_Cutoff   ==> LATE                                                   |
|      - T > Late_Cutoff                 ==> LATE (Flagged) / ABSENT Reconciliation                 |
|   4. Update check_out_time on EXIT without mutating initial check_in_time or status               |
|   5. Dispatch APNs / FCM Push Notification Confirmation                                           |
+---------------------------------------------------------------------------------------------------+
```

---

## 2. Native iOS CoreLocation Integration

### 2.1 `CLCircularRegion` Monitoring Mechanics & Hardware Boundaries
Apple iOS delegates region monitoring to `locationd`, an unconstrained system-level location daemon. When an application registers a `CLCircularRegion`, the daemon configures baseband radio and Wi-Fi chipsets to monitor for signal characteristics matching the specified geographical boundary without keeping the application host process active in RAM.

- **Hardware Limits**: iOS permits any single third-party application to monitor a maximum of **20 geographic regions** simultaneously (`kCLLocationAccuracyBest` boundaries). The single-user attendance tracker uses 1 primary workplace region (with optional secondary branches), well within the 20-region ceiling.
- **Radius Constraints**: CoreLocation establishes circular boundaries defined by a center coordinate (`CLLocationCoordinate2D`) and radius ($R$) in meters. iOS enforces a practical lower bound of $50\text{ meters}$. Regions configured with $R < 50\text{m}$ cause erratic boundary triggers due to civilian GPS drift and multipath propagation.
- **Delegate Callbacks**:
  - `locationManager(_:didEnterRegion:)`: Invoked when device transitions into the monitored boundary.
  - `locationManager(_:didExitRegion:)`: Invoked when device exits boundary past the hysteresis margin.
  - `locationManager(_:didDetermineState:for:)`: Fired immediately upon registration or OS wake to report current containment (`CLRegionState.inside`, `CLRegionState.outside`, or `CLRegionState.unknown`).
  - `locationManager(_:monitoringDidFailFor:withError:)`: Intercepts system failures (e.g., location toggled off, hardware failure).

### 2.2 Apple 2-Step Permission Escalation Flow & Reduced Accuracy Handling
Apple's Human Interface Guidelines and privacy sandboxes prohibit requesting background location directly on initial application launch. Attempting to present an `Always` authorization prompt immediately will result in rejection during App Store review and high rates of user refusal.

```
+----------------------------------------------------------------------------------------------------+
|                                  APPLE 2-STEP PERMISSION ESCALATION                                |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  Step 1: Foreground Context (Onboarding Screen)                                                    |
|  Call: `CLLocationManager.requestWhenInUseAuthorization()`                                         |
|  OS Dialog: [Allow While Using App] | [Allow Once] | [Don't Allow]                                 |
|                                                                                                    |
|            |                                                                                       |
|            +--- User Selects "Allow While Using App"                                               |
|            |                                                                                       |
|            v                                                                                       |
|  Step 2: Escalation to Background (Triggered when User configures Geofence destination)            |
|  Call: `CLLocationManager.requestAlwaysAuthorization()`                                            |
|  OS Dialog: [Keep Only While Using] | [Change to Always Allow]                                     |
|                                                                                                    |
|            |                                                                                       |
|            +---> If "Change to Always Allow" selected: Background geofencing fully armed.          |
|            |                                                                                       |
|            +---> If "Keep Only While Using" selected:                                              |
|                  - App detects authorizationStatus != .authorizedAlways                            |
|                  - Geofencing fires ONLY while app is actively foregrounded.                       |
|                  - UI displays Persistent Warning Banner directing user to iOS Settings.          |
+----------------------------------------------------------------------------------------------------+
```

#### Precise Location Handling (`accuracyAuthorization`)
In iOS 14+, Apple introduced the "Precise: On/Off" toggle. When toggled to **Off**, iOS assigns the device a dynamic approximate coordinate region within an approximate mesh cell ($1\text{ to }5\text{ kilometers}$ wide).
- **Impact on Geofencing**: If `accuracyAuthorization == .reducedAccuracy`, all circular geofences with $R < 1000\text{m}$ fail to trigger or register false crossings.
- **Mitigation Sequence**:
  1. Detect accuracy state: `locationManager.accuracyAuthorization == .reducedAccuracy`.
  2. Request a one-time temporary full-accuracy upgrade via:
     ```swift
     locationManager.requestTemporaryFullAccuracyAuthorization(
       withPurposeKey: "GeofencePreciseLocationPurpose"
     )
     ```
  3. Declare `NSLocationTemporaryUsageDescriptionDictionary` in `Info.plist` with explicit justification for the workplace boundary check-in.

### 2.3 `Info.plist` Configuration & Background Capabilities
To permit background execution upon a location event, the application bundle must be compiled with specific capabilities and privacy strings:

```xml
<!-- Info.plist Background Execution Keys -->
<key>UIBackgroundModes</key>
<array>
    <string>location</string>
    <string>fetch</string>
    <string>processing</string>
</array>

<!-- Location Permission Justification Strings -->
<key>NSLocationWhenInUseUsageDescription</key>
<string>Attendance Tracker requires your location to display your workplace geofence on the interactive map and verify arrival.</string>

<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>Attendance Tracker monitors your workplace boundary in the background to automatically record your check-in when you arrive, eliminating manual entry.</string>

<key>NSLocationAlwaysUsageDescription</key>
<string>Continuous background location authorization enables seamless automated attendance tracking upon crossing your workplace perimeter.</string>

<!-- Reduced Accuracy Upgrade Purpose -->
<key>NSLocationTemporaryUsageDescriptionDictionary</key>
<dict>
    <key>GeofencePreciseLocationPurpose</key>
    <string>High-precision GPS coordinates are required to verify entry into your workplace perimeter and prevent boundary false triggers.</string>
</dict>
```

### 2.4 Significant-Change Location Service (SLS) Fallback
If an application is force-terminated by the user via the iOS App Switcher (swiping up), iOS terminates the process and suspends standard location updates. However, CoreLocation region monitoring and the **Significant-Change Location Service (SLS)** remain registered in `locationd`.
- **Operating Mechanics**: SLS triggers an OS wake event when the device switches cellular base stations or detects a macroscopic move ($\ge 500\text{ meters}$).
- **Recovery Architecture**:
  ```swift
  // Enqueued on app startup to serve as an architectural safety net
  locationManager.startMonitoringSignificantLocationChanges()
  ```
  When SLS fires, iOS relaunches the application in the background with launch option:
  `launchOptions[UIApplication.LaunchOptionsKey.location] != nil`
  The application initializes in headless mode, queries `locationManager.requestState(for: region)`, checks the local SQLite event queue for uncommitted boundary entries, and re-arms any dormant monitoring channels.

---

## 3. Native Android GeofenceManager Integration

### 3.1 Google Play Services `GeofencingClient` & Hardware Sensor Hub
On Android, native background geofences are managed by Google Play Services Location Services (`com.google.android.gms.location.GeofencingClient`). Rather than polling continuous GPS in the application layer, Google Play Services interfaces directly with the hardware Context Hub (Qualcomm Snapdragon Sensor Core or Samsung Exynos Sensor Hub).

- **Hardware Offload**: Geofence definitions are downloaded to the low-power sensor micro-controller. Cellular tower IDs and scanned Wi-Fi BSSIDs are monitored at the hardware level. The main application processor (CPU) remains in deep sleep.
- **PendingIntent Architecture**: When a boundary transition occurs, Google Play Services creates a wake-lock and broadcasts an explicit `PendingIntent` targeted at the application's internal `BroadcastReceiver`.
- **API Configuration**:
  ```java
  Geofence geofence = new Geofence.Builder()
      .setRequestId("WORKPLACE_PRIMARY_GEOFENCE")
      .setCircularRegion(latitude, longitude, radiusMeters)
      .setExpirationDuration(Geofence.NEVER_EXPIRE)
      .setTransitionTypes(
          Geofence.GEOFENCE_TRANSITION_ENTER |
          Geofence.GEOFENCE_TRANSITION_DWELL |
          Geofence.GEOFENCE_TRANSITION_EXIT
      )
      .setLoiteringDelay(120000) // 120 seconds dwell filter
      .setNotificationResponsiveness(30000) // 30 seconds power-optimized batching
      .build();

  GeofencingRequest request = new GeofencingRequest.Builder()
      .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER | GeofencingRequest.INITIAL_TRIGGER_DWELL)
      .addGeofence(geofence)
      .build();
  ```

### 3.2 Android 10+ and 14+ Permission Architecture
Android enforces strict permission segregation across modern API levels:

```
+----------------------------------------------------------------------------------------------------+
|                                 ANDROID PERMISSION PROGRESSION                                     |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  Android 9 and below (API <= 28):                                                                  |
|  `ACCESS_FINE_LOCATION` covers foreground and background monitoring.                              |
|                                                                                                    |
|  Android 10 & 11 (API 29 & 30):                                                                    |
|  `ACCESS_BACKGROUND_LOCATION` introduced. Must NOT be requested simultaneously with                |
|  `ACCESS_FINE_LOCATION`. Doing so causes Android 11 to throw an immediate security exception.      |
|                                                                                                    |
|  Request Flow:                                                                                     |
|  1. Request `ACCESS_FINE_LOCATION` in-app -> User grants "While using the app".                   |
|  2. Display educational modal explaining why automated attendance requires background access.     |
|  3. Request `ACCESS_BACKGROUND_LOCATION` -> Android routes user to System App Permissions screen.  |
|  4. User must explicitly select "Allow all the time".                                              |
|                                                                                                    |
|  Android 14+ (API 34+):                                                                            |
|  Mandates `FOREGROUND_SERVICE_LOCATION` if any foreground service is spawned to drain queues       |
|  or interact with location hardware.                                                              |
+----------------------------------------------------------------------------------------------------+
```

#### AndroidManifest.xml Specification
```xml
<!-- Core Location Permissions -->
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />

<!-- Android 14+ Foreground Service Requirements -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />

<!-- Battery Exemption & Network Listeners -->
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
```

### 3.3 Deep Doze Mode & Battery Saver Exemption
Android's **Doze Mode** restricts background network access, CPU locks, and alarms when a device is unplugged, stationary, and screen-off for $> 30\text{ minutes}$.
- **Doze Impact**: Google Play Services continues to detect geofence transitions during Doze because it executes on the hardware hub. However, when the `PendingIntent` fires and awakens the application's headless runner, the application's network requests (`fetch` / HTTP POST) are blocked by the OS network firewall until the next Doze maintenance window (which can be delayed by up to 6 hours).
- **Mitigation via Exemption**:
  The application must verify battery optimization exemption:
  ```java
  PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
  if (!pm.isIgnoringBatteryOptimizations(context.getPackageName())) {
      Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
      intent.setData(Uri.parse("package:" + context.getPackageName()));
      context.startActivity(intent);
  }
  ```
  Exemption allows the headless task to hold a `PartialWakeLock` and access network sockets immediately upon boundary breach during Doze.

### 3.4 OEM Aggressive Battery Killer Mitigation Guide
Custom Android distributions (OEM ROMs) implement proprietary task killers that terminate background headless tasks and drop pending intents regardless of standard Android API contracts.

| OEM / ROM | Threat Mechanism | Technical Mitigation Strategy | User Onboarding Instructions |
|---|---|---|---|
| **Xiaomi (MIUI / HyperOS)** | Automatically terminates all background processes upon screen lock; denies autostart permissions by default. | Detect manufacturer `Build.MANUFACTURER.equalsIgnoreCase("xiaomi")`; deep-link to MIUI Autostart activity (`com.miui.securitycenter`). | 1. Enable **Autostart** for Attendance Tracker.<br>2. Set Battery Saver to **No Restrictions**.<br>3. Lock app in Recent Apps overview. |
| **Samsung (OneUI)** | Puts background apps into "Sleeping Apps" or "Deep Sleeping Apps" after 3 days of non-interactive use. | Register `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`; detect if package is placed in `AppStandbyBucket.RESTRICTED`. | 1. Go to **Settings > Battery > Background usage limits**.<br>2. Add Attendance Tracker to **Never sleeping apps**.<br>3. Disable "Put unused apps to sleep". |
| **Huawei (EMUI / HarmonyOS)** | Strict `PowerGenie` background killer blocks `PendingIntent` broadcasts to non-whitelisted apps. | Dispatch explicit intent to `com.huawei.systemmanager/.startupmgr.ui.StartupNormalAppListActivity`. | 1. Open **Battery > App Launch**.<br>2. Locate Attendance Tracker and switch from "Manage automatically" to **Manage manually**.<br>3. Enable Auto-launch, Secondary launch, and Run in background. |
| **OnePlus / Oppo / Realme (ColorOS / OxygenOS)** | "Quick Freeze" freezes background CPU slices after 3 minutes of background idle. | Direct user to "Advanced Battery Settings" to exempt app from "Optimize Battery Use". | 1. Navigate to **App Management > Attendance Tracker > Battery Usage**.<br>2. Enable **Allow background activity** and **Allow auto-launch**. |

---

## 4. React Native & Expo TaskManager Execution

### 4.1 Headless Execution Model & `expo-task-manager`
React Native applications run JavaScript code within a JavaScript VM instance (Hermes). When the mobile app is in the foreground, JavaScript execution is tied to the native view hierarchy. When the app is suspended, closed, or terminated, boundary crossings must awaken the JavaScript VM in a **headless state** (no React DOM, no visible UI views).

- **Task Execution Flow**:
  1. Native OS location daemon detects geofence boundary event.
  2. Native module (`expo-location` / `EXLocationManager`) receives delegate/PendingIntent.
  3. `expo-task-manager` spawns a headless Hermes JS runtime environment and acquires a background execution window (~30 seconds on iOS, partial wake-lock on Android).
  4. The registered task executor function executes, processes the payload, performs local SQLite operations, and dispatches an HTTP request.
  5. The headless runner signals completion to the OS (`BackgroundFetchResult.NewData`), releasing the wake-lock.

### 4.2 Global Module Scope Requirement (`index.js`)
A critical failure mode in Expo background task implementations is defining tasks inside React component lifecycles (e.g., inside `App.tsx` or a `useEffect` hook).
- **The Failure Mechanics**: When the OS wakes an application headlessly, `App.tsx` is **never rendered**. If `TaskManager.defineTask` was declared inside a component, the headless engine queries the global task registry, finds no registered handler for the task name, and silently drops the event.
- **The Mandated Rule**: `TaskManager.defineTask` **must be declared at the absolute global module scope in `index.js`**, before `registerRootComponent(App)` is invoked.

```typescript
// ============================================================================
// File: index.js (Application Root Entrypoint)
// ============================================================================
import { registerRootComponent } from 'expo';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import App from './src/App';
import { handleGeofenceTransition } from './src/services/geofenceHandler';

export const GEOFENCE_TASK_NAME = 'WORKPLACE_ATTENDANCE_GEOFENCE_TASK';

// CRITICAL: Must be defined at global module level.
// Executed by native OS background runners even when UI is not mounted.
TaskManager.defineTask(GEOFENCE_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error(`[TaskManager] Geofence task error: ${error.message}`);
    return;
  }

  if (data) {
    const { eventType, region } = data as {
      eventType: Location.GeofencingEventType;
      region: Location.LocationRegion;
    };

    console.log(`[TaskManager] Background geofence event: ${eventType} on ${region.identifier}`);
    await handleGeofenceTransition(eventType, region);
  }
});

// Mount the standard React component tree for interactive UI
registerRootComponent(App);
```

### 4.3 Expo Go Limitations & Custom Development Build Requirement
Standard **Expo Go** is a precompiled sandbox binary. It does **not** include background location entitlements or custom native `UIBackgroundModes` due to Apple and Google sandbox restrictions.
- **Expo Go Failure**: Running `Location.startGeofencingAsync()` inside Expo Go will either throw `ERR_LOCATION_UNSUPPORTED` or silently fail to deliver background transitions when the screen locks.
- **Mandated Build Strategy**: The project requires an **Expo Custom Development Build** generated via `expo prebuild`:
  ```bash
  # Generate native android/ and ios/ directories with custom entitlements
  npx expo prebuild --clean

  # Run on native hardware or simulators
  npx expo run:ios --device
  npx expo run:android --device
  ```

### 4.4 Expo Config Plugins (`app.config.ts`)
To configure the native manifest and `Info.plist` entries declaratively during `expo prebuild`, the project uses Expo Config Plugins:

```typescript
// app.config.ts
import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'AttendanceTracker',
  slug: 'attendance-tracker',
  version: '1.0.0',
  ios: {
    bundleIdentifier: 'com.attendance.tracker',
    infoPlist: {
      UIBackgroundModes: ['location', 'fetch', 'processing'],
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'Attendance Tracker monitors your workplace boundary in the background to automatically record attendance.',
      NSLocationWhenInUseUsageDescription:
        'Attendance Tracker uses your location to configure geofences and verify arrivals.',
      NSLocationAlwaysUsageDescription:
        'Continuous background location authorization enables automatic check-in when you arrive at work.',
    },
  },
  android: {
    package: 'com.attendance.tracker',
    permissions: [
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_LOCATION',
      'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      'ACCESS_NETWORK_STATE',
      'ACCESS_WIFI_STATE',
      'RECEIVE_BOOT_COMPLETED',
    ],
  },
  plugins: [
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'Attendance Tracker monitors your workplace boundary in the background to automatically record attendance.',
        isAndroidBackgroundLocationEnabled: true,
      },
    ],
  ],
});
```

---

## 5. Power Optimization & Battery-Efficient Boundary Tracking

### 5.1 Multi-Tier Sensor Trilateration
To achieve $< 1.5\%$ total battery consumption per 24-hour cycle, the mobile location engine operates in a hierarchical multi-tier sensor architecture:

```
+----------------------------------------------------------------------------------------------------+
|                                MULTI-TIER SENSOR POSITIONING ARCHITECTURE                          |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  Tier 1: MACRO ZONE (> 5 kilometers from workplace)                                               |
|  - Radio: Cellular Base Station ID (Cell-ID) monitoring only.                                     |
|  - Power Draw: ~0.0 mA incremental (piggybacks on existing cellular keep-alives).                 |
|  - GNSS GPS: Fully powered DOWN.                                                                   |
|  - Behavior: Device monitors macro tower handoffs.                                                 |
|                                                                                                    |
|  Tier 2: MESO ZONE (500 meters to 5 kilometers from workplace)                                     |
|  - Radio: Wi-Fi Access Point Scan / Base Station Trilateration.                                    |
|  - Power Draw: ~5–10 mA intermittent sampling (every 3–5 minutes).                                 |
|  - GNSS GPS: Powered DOWN.                                                                        |
|  - Behavior: OS checks proximity against registered regional Wi-Fi beacon tables.                  |
|                                                                                                    |
|  Tier 3: MICRO ZONE (< 500 meters from workplace boundary)                                         |
|  - Radio: Hardware GNSS (GPS, GLONASS, Galileo) + Wi-Fi RTT.                                       |
|  - Power Draw: ~30–50 mA active burst (duty-cycled, active only near border).                      |
|  - Behavior: Precision circular perimeter monitoring armed. GPS samples boundary crossing.        |
+----------------------------------------------------------------------------------------------------+
```

### 5.2 Dwell Time Filtering (Loitering Delay)
A primary source of false-positive attendance records in naive geofencing implementations is **transit clipping**: a user driving past their workplace on a highway, bus route, or pausing at an adjacent traffic intersection.
- **Loitering Filter**: The geofence is configured with a strict **loitering delay of $120\text{ seconds}$ ($2\text{ minutes}$)**.
- **Filter Mechanics**:
  - Crossing boundary triggers internal timer inside hardware location hub.
  - If device leaves boundary at $t = 45\text{s}$, the trigger is discarded.
  - Only when device remains continuously inside the perimeter for $t \ge 120\text{s}$ does the OS fire `GEOFENCE_TRANSITION_DWELL`.
  - The attendance check-in event is dispatched using the initial entry timestamp ($t_0$), preserving true arrival time.

### 5.3 Spatial Hysteresis & Urban Canyon Multipath Smoothing
Tall urban glass structures introduce multipath signal reflections, causing reported GPS coordinates to jitter by $\pm 25\text{ to }40\text{ meters}$. If a device is stationed near a window or desk on the edge of the geofence perimeter, this jitter can cause alternating `ENTER` and `EXIT` events ("boundary bounce").

```
             Spatial Hysteresis Buffer Zone
    +--------------------------------------------------+
    |                                                  |
    |      +------------------------------------+      |
    |      |                                    |      |
    |      |         GEOFENCE INTERIOR          |      |
    |      |         Radius = R (e.g. 100m)     |      |
    |      |                                    |      |
    |      +-----------------+------------------+      |
    |                        |                         |
    |                        |<--- Hysteresis Margin ->|
    |                        |       (+50 meters)      |
    +------------------------+-------------------------+
                     EXIT BOUNDARY (R + 50m)
```

- **Hysteresis Logic**:
  - Entry Trigger Threshold: Distance to center $d \le R$.
  - Exit Trigger Threshold: Distance to center $d > R + 50\text{ meters}$.
  - Boundary Debounce: An `EXIT` event is suppressed if received within $180\text{ seconds}$ of an `ENTER` event unless verified by a secondary Wi-Fi disconnect broadcast.

### 5.4 Geofence Radius Sizing Guidelines

```
Recommended Geofence Radius Spectrum:

  50m                    100m                                      500m
---|-----------------------|-----------------------------------------|--->
 Minimum              Default Target                               Maximum
 [Caution: Jitter]   [Optimal Balance]                   [Risk: Early False Trigger]
```

- **$100\text{ meters}$ (Default Target)**: Optimal balance for modern commercial office buildings, campus courtyards, and standard suburban workplaces. Consistently intercepted by cell/Wi-Fi transitions.
- **$50\text{ meters}$ (Absolute Minimum)**: Permitted only for compact, isolated buildings with clear sky visibility. Mobile UI flags an amber warning if $R < 100\text{m}$.
- **$500\text{ meters}$ (Maximum Safe Boundary)**: Used for expansive industrial parks, universities, or corporate campuses. Radii exceeding $500\text{m}$ are rejected by client validation because they trigger arrivals while the employee is still commuting on arterial transit links.

---

## 6. Indoor & Basement Fallback Triggers (Wi-Fi SSID/BSSID)

### 6.1 The Indoor Satellite Signal Attenuation Problem
Standard L1 GPS signals ($1575.42\text{ MHz}$) experience severe attenuation when penetrating reinforced concrete, metallized low-E glass, and underground parking basements (attenuation often exceeds $20\text{ to }30\text{ dB}$). An employee entering an underground parking garage may experience total GNSS satellite unlock, causing the native geofence `ENTER` event to fail to trigger.

### 6.2 Wi-Fi Network Listener & Matching Logic
To guarantee 100% arrival capture indoors, the mobile app monitors network connectivity state transitions. When the device associates with an IEEE 802.11 access point, the connection details are matched against the user's configured workplace network.

```typescript
// Wi-Fi Connection Trigger Handler
import * as Network from 'expo-network';
import { getStoredLocationConfig } from './storage';
import { enqueueGeofenceEvent } from './queue';

export async function onNetworkStateChange(networkState: Network.NetworkState) {
  if (!networkState.isConnected || networkState.type !== Network.NetworkStateType.WIFI) {
    return;
  }

  const config = await getStoredLocationConfig();
  if (!config || !config.wifi_ssid || !config.is_active) {
    return;
  }

  // Dedicated native module (e.g., react-native-wifi-reborn) retrieves active SSID/BSSID
  // (expo-network only exposes IP address, not SSID/BSSID)
  const networkInfo = await getNativeWifiDetails();

  if (networkInfo.ssid === config.wifi_ssid) {
    // Verify optional BSSID hardware MAC to defeat rogue hotspot spoofing
    if (config.wifi_bssid && networkInfo.bssid !== config.wifi_bssid) {
      console.warn('[WiFi-Fallback] SSID matches but BSSID hardware mismatch. Skipping trigger.');
      return;
    }

    console.log('[WiFi-Fallback] Matched workplace Wi-Fi. Dispatching auto check-in.');
    await enqueueGeofenceEvent({
      eventType: 'ENTER',
      source: 'WIFI_AUTO',
      accuracyMeters: 10.0, // Wi-Fi association implies physical indoor presence <= 15m
      latitude: config.latitude,
      longitude: config.longitude,
    });
  }
}
```

### 6.3 OS Permissions & Entitlements for Network SSID Access
Because Wi-Fi SSIDs can be cross-referenced against global BSSID geolocation registries (e.g., Skyhook, Google Location Services), modern mobile operating systems classify reading the active Wi-Fi SSID as a **high-risk location leak**:
- **Android 10+**: Reading Wi-Fi SSID requires active `ACCESS_FINE_LOCATION` runtime permission and system Location Services toggled ON. Attempting to call `WifiManager.getConnectionInfo()` without fine location returns `<unknown ssid>`.
- **iOS 13+**: Reading Wi-Fi SSID requires:
  1. Active Location Authorization (`authorizedWhenInUse` or `authorizedAlways`).
  2. The **Access Wi-Fi Information** entitlement enabled in Xcode / provisioning profile (`com.apple.developer.networking.wifi-info`).
  3. Invocation of `NEHotspotNetwork.fetchCurrent(completionHandler:)`.

### 6.4 BSSID Hardware MAC Validation & Anti-Spoofing
Anyone can configure a personal mobile hotspot to broadcast an identical SSID string (e.g., "Workplace-Corporate-Guest").
- **Anti-Spoofing Guard**: The system supports configuring the workplace router's physical hardware **BSSID (MAC Address)** (e.g., `a4:b2:39:12:ef:90`).
- While SSID can be trivially spoofed on portable hotspots, BSSID filtering ensures check-ins are restricted to the physical enterprise access points installed inside the facility.

---

## 7. Geofence Event Payload & Ingestion Contract

### 7.1 JSON Schema Specification (`GeofenceEventPayload`)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "GeofenceEventPayload",
  "type": "object",
  "required": [
    "event_id",
    "user_id",
    "event_type",
    "occurred_at",
    "latitude",
    "longitude",
    "accuracy_meters",
    "source"
  ],
  "properties": {
    "event_id": {
      "type": "string",
      "format": "uuid",
      "description": "Unique client-generated idempotency key (UUIDv4). Wire alias: idempotency_key."
    },
    "user_id": {
      "type": "string",
      "format": "uuid",
      "description": "System user ID asserting attendance."
    },
    "event_type": {
      "type": "string",
      "enum": ["ENTER", "EXIT", "DWELL"],
      "description": "Boundary transition classification."
    },
    "occurred_at": {
      "type": "string",
      "format": "date-time",
      "description": "ISO 8601 UTC timestamp recorded by hardware sensor clock at event trigger."
    },
    "latitude": {
      "type": "number",
      "minimum": -90.0,
      "maximum": 90.0,
      "description": "WGS 84 latitude coordinate."
    },
    "longitude": {
      "type": "number",
      "minimum": -180.0,
      "maximum": 180.0,
      "description": "WGS 84 longitude coordinate."
    },
    "accuracy_meters": {
      "type": "number",
      "minimum": 0.0,
      "description": "Horizontal positioning accuracy radius in meters."
    },
    "source": {
      "type": "string",
      "enum": ["GEOFENCE", "WIFI_AUTO", "MANUAL"],
      "description": "Sensor origin of boundary breach."
    },
    "client_dispatch_time": {
      "type": "string",
      "format": "date-time",
      "description": "ISO 8601 UTC timestamp recorded at the exact moment of HTTP transmission."
    },
    "monotonic_timestamp_ms": {
      "type": "integer",
      "minimum": 0,
      "description": "Hardware system uptime in milliseconds since device boot."
    },
    "battery_level": {
      "type": "number",
      "minimum": 0.0,
      "maximum": 1.0,
      "description": "Device battery percentage at time of event dispatch."
    },
    "satellite_atomic_epoch": {
      "type": ["integer", "null"],
      "description": "UTC epoch extracted directly from GNSS satellite navigation frame."
    },
    "wifi_ssid": {
      "type": "string",
      "description": "Active connected Wi-Fi SSID."
    },
    "wifi_bssid": {
      "type": "string",
      "description": "Hardware BSSID MAC address of the connected access point."
    },
    "device_info": {
      "type": "object",
      "required": ["device_id", "platform", "os_version", "app_version", "is_mock_provider"],
      "properties": {
        "device_id": { "type": "string" },
        "platform": { "type": "string", "enum": ["IOS", "ANDROID"] },
        "os_version": { "type": "string" },
        "app_version": { "type": "string" },
        "is_mock_provider": { "type": "boolean" }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

### 7.2 TypeScript Interface Definitions

```typescript
// packages/shared/src/types/geofence.ts

export type GeofenceTransitionType = 'ENTER' | 'EXIT' | 'DWELL';
export type GeofenceEventSource = 'GEOFENCE' | 'WIFI_AUTO' | 'MANUAL';
export type ClientPlatform = 'IOS' | 'ANDROID';

export interface DeviceTelemetryInfo {
  device_id: string;
  platform: ClientPlatform;
  os_version: string;
  app_version: string;
  is_mock_provider: boolean; // Flagged true if mock location app detected on Android
}

export interface GeofenceEventPayload {
  event_id: string; // UUIDv4 idempotency key
  user_id: string;  // UUIDv4
  event_type: GeofenceTransitionType;
  occurred_at: string; // ISO 8601 UTC
  latitude: number;
  longitude: number;
  accuracy_meters: number;
  source: GeofenceEventSource;
  client_dispatch_time?: string; // ISO 8601 UTC dispatch time
  monotonic_timestamp_ms?: number;
  battery_level?: number;
  satellite_atomic_epoch?: number | null;
  wifi_ssid?: string;
  wifi_bssid?: string;
  device_info?: DeviceTelemetryInfo;
}

export interface GeofenceIngestResponse {
  event_status: 'CREATED' | 'NEW_CHECK_IN' | 'ALREADY_RECORDED' | 'CHECK_OUT_UPDATED' | 'RECONCILED_ABSENCE_OVERWRITTEN' | 'IGNORED_NO_CHECK_IN' | 'NON_WORK_DAY_RECORDED';
  record: any | null;
  message?: string;
  notification_dispatched?: boolean;
}
```

---

## 8. Client-Side Durability & Offline Event Queue

### 8.1 Local SQLite Event Queue Schema (`geofence_event_queue`)
Mobile connectivity is inherently intermittent (e.g., deep basement garages, subway lines, network dead spots, or server maintenance). A geofence event cannot rely on immediate network transmission. Every boundary crossing is **committed to local SQLite storage before any HTTP dispatch is attempted**.

```sql
-- SQLite Local Schema (managed via expo-sqlite)
CREATE TABLE IF NOT EXISTS geofence_event_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT UNIQUE NOT NULL,            -- UUIDv4 idempotency key
    user_id TEXT NOT NULL,
    event_type TEXT NOT NULL,                  -- 'ENTER', 'EXIT', 'DWELL'
    payload_json TEXT NOT NULL,                -- Complete serialized GeofenceEventPayload
    status TEXT NOT NULL DEFAULT 'PENDING',    -- 'PENDING', 'DISPATCHING', 'ACKNOWLEDGED', 'DEAD_LETTER'
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 10,
    next_retry_at INTEGER NOT NULL,            -- Millisecond epoch for next scheduled retry
    last_error TEXT,
    created_at INTEGER NOT NULL,               -- Millisecond epoch of insertion
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_queue_drain 
ON geofence_event_queue (status, next_retry_at);
```

### 8.2 Queue State Machine Transitions

```
                    +--------------------+
                    |  Boundary Breach   |
                    +---------+----------+
                              |
                              v
                    +--------------------+
                    |      PENDING       | <─────────────────────────────+
                    +---------+----------+                               │
                              |                                          │
                              v (Drain Initiated)                        │
                    +--------------------+                               │
                    |    DISPATCHING     |                               │
                    +----+----------+----+                               │
                         |          |                                    │
          HTTP 200 / 201 |          | Network Disconnected / Offline     │
                         |          v (NetInfo.isConnected === false)    │
                         |  +--------------------+                       │
                         |  |   PAUSED / WAIT    |                       │
                         |  | (Retry count not   |                       │
                         |  |  incremented;      |                       │
                         |  |  awaits NetInfo /  | ──────────────────────+ (On Reconnect)
                         |  |  foreground resume)│
                         |  +--------------------+
                         |          |
                         |          | HTTP 5xx Server Error
                         |          v
                         |  +--------------------+
                         |  | Calculate Backoff  |
                         |  | (Retry Count < 10) | ──────────────────────+
                         |  +---------+----------+
                         |            |
                         |            | HTTP 4xx Client Error (400, 422 Unrecoverable)
                         v            v
             +----------------+  +--------------------+
             |  ACKNOWLEDGED  |  |    DEAD_LETTER     |
             | (Purged after  |  | (Alert dispatched  |
             |    7 days)     |  |   to user UI)      |
             +----------------+  +--------------------+
```

#### Dead-Lettering & Retry Policy Specification
- **HTTP 4xx (Client Validation Errors - 400, 422)**:
  These errors indicate malformed payload schemas, unparseable UUIDs, or unrecoverable client-side corruption. Because retrying identical payloads against the server cannot succeed, the event transitions immediately to `DEAD_LETTER` to prevent battery drain. A local diagnostic notification is posted to the user interface.
- **Network Connectivity Errors (`Network request failed`, Timeout, DNS failure, `NetInfo.isConnected === false`)**:
  Network disconnections in underground parking garages, subways, or transit tunnels are temporary and expected. **Network errors DO NOT increment `retry_count` and NEVER transition events to `DEAD_LETTER`.** Instead, the queue processor immediately pauses exponential backoff, enters a dormant `PAUSED` state, and registers an OS `NetInfo` event listener. As soon as cellular or Wi-Fi connectivity returns (`isInternetReachable === true`), the queue processor resumes draining pending events.
- **HTTP 5xx (Server-Side Errors - 500, 502, 503, 504)**:
  Transient backend outages increment `retry_count` ($1 \le N \le 10$) and schedule retries via exponential backoff with full jitter. If the 10th retry attempt still encounters an HTTP 5xx error, the queue processor **does NOT dead-letter** the event; it pauses active polling and remains dormant in `PENDING` until the next OS `NetInfo` reconnect event, app foreground resume, or periodic background fetch wakes the queue. Valid check-in records are never lost due to prolonged server downtime.

### 8.3 Exponential Backoff with Full Jitter
To prevent a thundering herd on the self-hosted backend when network restores or the server recovers from downtime, retries for HTTP 5xx errors utilize **exponential backoff with full jitter**:

$$t_{\text{backoff}} = \min\left(t_{\max},\; t_{\text{base}} \times 2^N\right)$$

$$t_{\text{scheduled}} = \text{UniformRandom}\left(0,\; t_{\text{backoff}}\right)$$

Where:
- $t_{\text{base}} = 2\text{ seconds}$
- $t_{\max} = 300\text{ seconds}$ ($5\text{ minutes}$)
- $N = \text{current server retry count}$ ($0 \le N \le 10$)

```typescript
// src/services/retryPolicy.ts

export function calculateNextRetryEpoch(retryCount: number): number {
  const BASE_DELAY_SECONDS = 2;
  const MAX_DELAY_SECONDS = 300; // 5 minute ceiling

  // Exponential ceiling: 2 * 2^N
  const exponentialDelay = Math.min(
    MAX_DELAY_SECONDS,
    BASE_DELAY_SECONDS * Math.pow(2, retryCount)
  );

  // Full jitter: uniformly distributed between 0 and exponentialDelay
  const jitteredDelay = Math.random() * exponentialDelay;

  return Date.now() + Math.floor(jitteredDelay * 1000);
}
```

### 8.4 Network Drain Triggers: Reactive `NetInfo` & Periodic `BackgroundFetch`
The queue processor is awakened by two independent mechanisms:
1. **Reactive Network Trigger (`@react-native-community/netinfo`)**:
   Monitors OS network interface changes. The moment `isConnected === true` and `isInternetReachable === true`, an immediate queue drain routine executes with a 5-second debounce.
2. **Periodic Backup Drain (`expo-background-fetch`)**:
   Registers a periodic OS background task running at a $15\text{ to }30\text{ minute}$ cadence (`BackgroundFetch.registerTaskAsync`). This ensures that even if the app was terminated and network restored silently while locked, the pending queue is emptied without user intervention.

---

## 9. Clock Integrity, Temporal Anti-Tampering & Fraud Prevention

### 9.1 Threat Vectors in Client Time Manipulation
In an automated attendance system, malicious or inadvertent device clock tampering represents a direct integrity threat:
- **Threat Vector 1**: A user running late manually sets their phone clock backward (e.g., from 10:30 AM to 09:15 AM) in system settings prior to crossing the workplace boundary to falsely trigger a `PRESENT` status.
- **Threat Vector 2**: Device battery dies; upon rebooting without cellular NTP sync, the clock initializes to the hardware RTC baseline (or Jan 1, 1970).

### 9.2 Device Monotonic Clock Verification
Modern mobile operating systems maintain a hardware monotonic clock that counts CPU clock cycles elapsed since device boot:
- **Android**: `SystemClock.elapsedRealtime()`
- **iOS**: `clock_gettime(CLOCK_MONOTONIC_RAW)`

The monotonic clock **cannot be modified by user settings, timezone shifts, or NTP adjustments**. The client logs `monotonicTimestampMs` with every event. 
- **Delta Comparison**:
  $$\Delta_{\text{wall}} = T_{\text{wall, event}} - T_{\text{wall, prior}}$$
  $$\Delta_{\text{mono}} = T_{\text{mono, event}} - T_{\text{mono, prior}}$$
  If $|\Delta_{\text{wall}} - \Delta_{\text{mono}}| > 60\text{ seconds}$, a local clock alteration occurred while the device was running.

### 9.3 GNSS Satellite Atomic Epoch Validation
When an entry event is captured via GNSS GPS hardware (`source: GEOFENCE`), the location fix payload contains a satellite epoch:
- GPS satellites broadcast atomic clock timestamps derived from on-board rubidium/cesium frequency standards.
- The hardware GPS chip decodes this signal independently of the mobile OS system clock.
- The client extracts `location.timestamp` directly from the raw NMEA frame/CLLocation fix and sends it as `satelliteAtomicEpoch`.
- The server validates that `satelliteAtomicEpoch` aligns with true UTC within signal propagation bounds ($\le 2\text{ seconds}$).

### 9.4 Server-Client HTTP `Server-Time` Header NTP Skew Calculation
Every API response dispatched by the backend includes an authoritative high-precision header: `Server-Time: <ISO8601-UTC>`.

```
Client Dispatch (T_sent) ---------------------> Server Ingests (T_server)
                                                      |
Client Receives (T_recv) <---------------------+ Returns HTTP Response + `Server-Time`
```

1. **Round-Trip Delay ($RTT$)**:
   $$RTT = T_{\text{recv}} - T_{\text{sent}}$$
2. **Estimated Clock Skew ($\Delta_{\text{skew}}$)**:
   $$\Delta_{\text{skew}} = T_{\text{server}} - \left(T_{\text{sent}} + \frac{RTT}{2}\right)$$
3. **Threshold Enforcement**:
   - If $|\Delta_{\text{skew}}| \le 300\text{ seconds}$ ($5\text{ minutes}$): Accept clock as synchronized.
   - If $|\Delta_{\text{skew}}| > 300\text{ seconds}$:
     - Server accepts the event but flags it with status `FLAGGED_SKEW`.
     - Ingestion pipeline logs an audit warning in `attendance_audit_logs`.
     - Automatic `PRESENT` grant is withheld until the user or administrator reviews the audit flag in the web portal.

---

## 10. Status Computation State Machine & Idempotency Rules

### 10.1 Daily Schedule Window Matrix & Timezone Anchor
Attendance evaluation is strictly calculated against the user's localized day based on their configured IANA timezone string in `user_settings.timezone` (e.g., `"Asia/Kolkata"` or `"America/New_York"`).

```
Day Schedule Parameter Window:

00:00:00                Window_Start         Window_End         Late_Cutoff              23:59:59
---|--------------------------|-------------------|-------------------|---------------------|--->
   |        EARLY             |     ON-TIME       |       LATE        |     EXCEEDED        |
   | (Evaluated as PRESENT)   |    (PRESENT)      |      (LATE)       | (ABSENT Reconciliation)
```

- $W_{\text{start}}$: Window Start Time (e.g., `09:00:00`)
- $W_{\text{end}}$: Window End Time (e.g., `10:00:00`)
- $L_{\text{cutoff}}$: Grace / Late Cutoff Time (e.g., `11:30:00`)

### 10.2 Status Transition State Machine

```
                      +-----------------------------+
                      | Event Ingestion: occurredAt |
                      +--------------+--------------+
                                     |
                                     v
                       Is today an active work day?
                        /                         \
                   YES /                           \ NO
                      v                             v
       Does an existing record exist?          RECORD OFF-DAY /
            /                 \                VOLUNTARY PRESENCE
       NO  /                   \ YES           (No streak penalty)
          v                     v
    Evaluate Window         IDEMPOTENT CHECK:
    - T <= W_end            - Check-in time IMMUTABLE
      ==> PRESENT           - Status IMMUTABLE
    - W_end < T <= L_cutoff - If EXIT event:
      ==> LATE                update check_out_time
    - T > L_cutoff          - Acknowledge HTTP 200
      ==> LATE (Flagged)
```

### 10.3 Edge Cases: Early Arrivals & Post-Cutoff Transitions
1. **Early Arrival ($T < W_{\text{start}}$)**:
   - An employee arriving at 08:30 AM for a 09:00 AM window is fully on-time.
   - **Resolution**: Evaluated as **`PRESENT`**. The `check_in_time` is recorded as `08:30:00 AM`. It is never discarded or marked late.
2. **Post-Cutoff Arrival ($T > L_{\text{cutoff}}$)**:
   - An employee arrives at 12:15 PM when the late cutoff was 11:30 AM.
   - **Resolution**: Rather than leaving the employee unrecorded (which would falsely mark them absent at day end), the system records the check-in with status **`LATE`** and sets `cutoff_exceeded: true` in the record metadata.
3. **Automated Absenteeism Reconciliation**:
   - A server-side cron runs daily at 23:59:00 in the user's local timezone.
   - For all scheduled work days where no `attendance_records` row exists and no pre-planned `LEAVE` or `WFH` is logged, the system inserts an automated row:
     `status: 'ABSENT'`, `source: 'MANUAL'`, `check_in_time: NULL`.
   - **Offline Replay Exception**: If a mobile device was offline (e.g., dead battery, subway transit) and subsequently replays its authentic sensor check-in with `occurred_at` within the work window, Rule C of the backend transaction allows the authentic check-in to overwrite the auto-reconciled absence (`status: 'PRESENT'` or `'LATE'`, `check_in_time: occurred_at`, `source: 'GEOFENCE'`).

### 10.4 Idempotent Multi-Entry Enforcement (Lunch Breaks & Perimeter Bounce)
Employees frequently depart the office premises during the work day (e.g., stepping out for lunch, meeting clients, or crossing the geofence perimeter).
- **Core Idempotency Rule**: **The initial check-in time and evaluated status for a calendar day are permanent and immutable.** Subsequent geofence crossings on that date cannot alter the established attendance record.
- **EXIT-Before-ENTER Protection**:
  If an OS geofence `EXIT` event arrives on date D when no check-in record exists yet (e.g. perimeter bounce during morning commute or transient cell tower jump), the backend **does NOT create an attendance record** setting `check_in_time = exit_time`. Instead, it logs the exit transition in `presence_timeline` with a note `"EXIT without prior check-in"` and returns HTTP 200 with status `IGNORED_NO_CHECK_IN`. This preserves date D for subsequent valid `ENTER` arrivals.
- **Database Unique Constraint**:
  ```sql
  CONSTRAINT idx_attendance_records_user_date UNIQUE (user_id, date)
  ```
- **SQLite Upsert Semantics**:
  ```sql
  -- SQLite Atomic Check-In Ingestion Query (via better-sqlite3 / Drizzle ORM)
  INSERT INTO attendance_records (
      id, user_id, date, status, source, check_in_time, 
      accuracy_meters, notes, created_at, updated_at
  ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT (user_id, date) DO UPDATE SET
      -- Check-in time and status are preserved; only updated_at touches on idempotent hits
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  RETURNING *;
  ```
- **Handling `EXIT` Transitions**:
  When an `EXIT` event arrives:
  ```sql
  -- SQLite Monotonic Check-Out Update
  UPDATE attendance_records
  SET check_out_time = CASE 
          WHEN check_out_time IS NULL OR ? > check_out_time THEN ? 
          ELSE check_out_time 
      END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE user_id = ? AND date = ?;
  ```
- **Secondary Presence Timeline**:
  While the primary daily attendance record remains idempotent, all raw `ENTER` and `EXIT` events are appended to a secondary SQLite table `presence_timeline` for auditability, anomaly detection, and work-duration tracking:
  ```sql
  -- SQLite Schema (matching docs/DATABASE_SCHEMA.md)
  CREATE TABLE IF NOT EXISTS presence_timeline (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      event_id TEXT UNIQUE NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('ENTER', 'EXIT', 'DWELL')),
      occurred_at TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('GEOFENCE', 'WIFI_AUTO', 'MANUAL')),
      raw_payload TEXT,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
      FOREIGN KEY (user_id) REFERENCES user_settings(id) ON DELETE CASCADE
  );
  ```

---

## 11. End-to-End Failure Modes & Recovery Matrix

| # | Failure Mode | Root Cause | Observable Symptom | Automated Recovery / Mitigation |
|---|---|---|---|---|
| **F-01** | **Silent Task Drop on OS Wake** | `TaskManager.defineTask` placed inside a React component or hook. | Geofence triggers in native logs, but zero events are recorded in SQLite or backend. | Architectural rule: declare task at global module scope in `index.js`. |
| **F-02** | **App Force-Killed by User** | User swiped app away in iOS App Switcher. | App process dead; memory purged. | `locationd` retains circular region. When perimeter breached, iOS relaunches app into background via `launchOptions[location]`. |
| **F-03** | **Basement GPS Blackout** | L1 satellite attenuation in reinforced concrete or subterranean parking. | Device enters office parking garage; GPS fix fails; no geofence trigger. | Wi-Fi network change listener detects association with workplace SSID/BSSID; dispatches `WIFI_AUTO` check-in. |
| **F-04** | **Server Outage During Arrival** | Self-hosted backend offline, VPS rebooting, or home tunnel down. | Client receives HTTP 502/503/Timeout upon boundary trigger. | Event committed to local SQLite queue (`status: PENDING`). Exponential backoff with full jitter schedules retries; NetInfo reconnect drains queue. |
| **F-05** | **Device Clock Tampering** | User rolled device wall clock back to fake on-time arrival. | Ingested `occurredAt` does not match real-world arrival time. | Multi-tier defense: Monotonic delta check, GNSS satellite atomic epoch check, and Server HTTP header $|\Delta_{\text{skew}}| > 300\text{s}$ flag. Event routed to `FLAGGED_SKEW`. |
| **F-06** | **Urban Canyon Boundary Bounce** | GPS multipath reflections off glass skyscrapers cause location jitter ($\pm 40\text{m}$). | Rapid alternating `ENTER` and `EXIT` events triggered within 60 seconds. | 1. Spatial hysteresis ($R + 50\text{m}$).<br>2. 120-second dwell filter (`loiteringDelay`).<br>3. Server-side database idempotency ignores duplicate entries. |
| **F-07** | **Highway Transit Clipping** | Commuter drives past workplace on an adjacent highway or sits at red light. | Brief entry into circular geofence boundary while in transit. | Hardware loitering filter (`setLoiteringDelay(120000)`): event discarded unless device resides continuously inside radius for $\ge 120\text{s}$. |
| **F-08** | **OEM Battery Optimization Kill** | Xiaomi MIUI / Samsung OneUI kills headless background runners. | Check-ins only fire when user manually unlocks phone and launches app. | Client prompts user during onboarding to whitelist app from battery optimization (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`) and enable OEM Autostart. |
| **F-09** | **iOS Approximate Location Mode** | User selected "Precise: Off" in iOS 14+ permissions. | Region radius $< 1000\text{m}$ fails to register with `locationd`. | App checks `accuracyAuthorization == .reducedAccuracy` and prompts for one-time temporary full accuracy authorization via `requestTemporaryFullAccuracyAuthorization`. |
| **F-10** | **Unrecoverable Payload Error** | Corrupt database row or invalid UUID in payload causes HTTP 422. | Repeated retries flood server and drain device battery. | Ingestion engine returns HTTP 4xx (non-retryable). Client queue moves event to `DEAD_LETTER`, halts retries, and posts a diagnostic notification. |

---

## 12. Operational Verification & Testing Protocols

### 12.1 Native Simulator Testing & Mock GPX Trails
Because hardware background geofencing requires physical spatial transitions, testing must combine automated simulation with real-world field verification:
1. **iOS Simulator Location Simulation**:
   Load a custom GPX trail into Xcode (`Debug > Simulate Location > Add GPX File`):
   ```xml
   <?xml version="1.0"?>
   <gpx version="1.1" creator="Xcode">
       <!-- Approach Route: 1 km away -->
       <wpt lat="37.7749" lon="-122.4194"><time>2026-11-05T08:50:00Z</time></wpt>
       <!-- Enter Perimeter: radius 100m -->
       <wpt lat="37.7833" lon="-122.4167"><time>2026-11-05T09:05:00Z</time></wpt>
       <!-- Dwell inside workplace for > 120 seconds -->
       <wpt lat="37.7833" lon="-122.4167"><time>2026-11-05T09:07:30Z</time></wpt>
   </gpx>
   ```
2. **Android ADB Mock Location Injection**:
   Using `adb` to inject geofence boundary coordinates into an Android Virtual Device (AVD):
   ```bash
   # Set mock location to boundary exterior
   adb emu geo fix -122.4194 37.7749 10 5

   # Move inside workplace geofence radius
   adb emu geo fix -122.4167 37.7833 10 5

   # Wait 125 seconds to verify loitering delay triggers PendingIntent
   sleep 125

   # Inspect headless background task logs
   adb logcat -s ExpoTaskManager EXLocation
   ```

### 12.2 Durability Queue Verification Command Suite
To verify the offline SQLite queue on an attached Android device or simulator:
```bash
# Pull local SQLite database from application container
adb exec-out run-as com.attendance.tracker cat databases/attendance.db > /tmp/attendance.db

# Query queued event state machine
sqlite3 /tmp/attendance.db "SELECT id, event_id, event_type, status, retry_count, last_error FROM geofence_event_queue;"

# Verify acknowledged vs dead-letter status
sqlite3 /tmp/attendance.db "SELECT status, COUNT(*) FROM geofence_event_queue GROUP BY status;"
```

### 12.3 Idempotency Validation Protocol
1. Dispatch identical payload twice via `curl`:
   ```bash
   curl -X POST https://attendance.yourdomain.com/api/v1/attendance/events \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <TOKEN>" \
     -d '{
       "event_id": "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
       "user_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
       "event_type": "ENTER",
       "occurred_at": "2026-11-05T09:14:22.000Z",
       "latitude": 37.7833,
       "longitude": -122.4167,
       "accuracy_meters": 8.5,
       "source": "GEOFENCE",
       "monotonic_timestamp_ms": 14209581,
       "battery_level": 0.88,
       "device_info": {
         "device_id": "DEVICE_TEST_UUID",
         "platform": "IOS",
         "os_version": "18.1",
         "app_version": "1.0.0",
         "is_mock_provider": false
       }
     }'
   ```
2. **Expected Verification Result**:
   - First call: HTTP 201 Created (`status: "PRESENT"`).
   - Second call: HTTP 200 OK (`status: "DUPLICATE_ACK"` or `"PRESENT"`).
   - Database inspection verifies `attendance_records.check_in_time` is unaltered and exactly one row exists for that calendar date.
