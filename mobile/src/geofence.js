const {
  submitCheckIn,
  enqueuePendingCheckIn,
  getCachedWorkplaceSettings,
  formatTime12h,
} = require('./api');

const GEOFENCE_TASK_NAME = 'WORK_ATTENDANCE_TASK';
const WORK_REGION_IDENTIFIER = 'work-location';
const EARTH_RADIUS_METERS = 6371000;

// Active foreground GPS watcher fallback for Expo Go on iOS (where Info.plist lacks Always key)
let activeLiveWatcher = null;
let liveWatcherTriggeredDate = null;

function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_METERS * c * 10) / 10;
}

/**
 * Extracts local YYYY-MM-DD, HH:MM:SS, HH:MM, and day-of-week (0=Sun..6=Sat)
 * from a Date object on the mobile device.
 */
function getDeviceLocalParts(dateObj = new Date()) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  const hours = String(dateObj.getHours()).padStart(2, '0');
  const minutes = String(dateObj.getMinutes()).padStart(2, '0');
  const seconds = String(dateObj.getSeconds()).padStart(2, '0');

  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${minutes}:${seconds}`,
    shortTime: `${hours}:${minutes}`,
    dayOfWeek: dateObj.getDay(),
    totalMinutes: dateObj.getHours() * 60 + dateObj.getMinutes(),
  };
}

function parseHhMmToMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * Lazily resolves Expo native modules so unit tests in Node.js can run
 * with injected mocks without requiring the React Native bridge.
 */
function getDefaultNativeModules(deps = {}) {
  return {
    Location: deps.Location || require('expo-location'),
    TaskManager:
      deps.TaskManager ||
      (deps.Location && !deps.needTaskManager
        ? null
        : require('expo-task-manager')),
    Notifications:
      deps.Notifications ||
      (deps.Location && !deps.needNotifications
        ? null
        : require('expo-notifications')),
  };
}

async function sendLocalNotification(
  { title, body },
  notificationsModule = null
) {
  try {
    const Notifications =
      notificationsModule ||
      getDefaultNativeModules({ needNotifications: true }).Notifications;
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
      },
      trigger: null, // Immediate local notification
    });
  } catch {
    // Ignore notification errors if user disabled notifications or in Expo Go
  }
}

/**
 * Core handler invoked when the OS detects entry into the workplace geofence
 * (or when triggered via the 'Simulate Geofence Entry' test button or live GPS watcher).
 */
async function processGeofenceEnterEvent(
  {
    latitude = null,
    longitude = null,
    now = new Date(),
    bypassScheduleGuard = false,
  } = {},
  deps = {}
) {
  const local = getDeviceLocalParts(now);
  const cachedSettings = await getCachedWorkplaceSettings(deps.storage);

  if (cachedSettings && !bypassScheduleGuard) {
    // 1. Skip non-working days (e.g. Saturday/Sunday)
    if (
      Array.isArray(cachedSettings.work_days) &&
      !cachedSettings.work_days.includes(local.dayOfWeek)
    ) {
      return {
        skipped: true,
        reason: 'non_work_day',
      };
    }

    // 2. Skip middle-of-the-night pass-bys (allow up to 3 hours before window_start)
    const startMins = parseHhMmToMinutes(cachedSettings.window_start);
    if (startMins !== null) {
      const earliestAllowed = Math.max(0, startMins - 180);
      if (local.totalMinutes < earliestAllowed) {
        return {
          skipped: true,
          reason: 'before_early_arrival_buffer',
        };
      }
    }
  }

  try {
    const result = await submitCheckIn(
      {
        latitude,
        longitude,
        trigger: 'GEOFENCE',
      },
      deps
    );

    // Notify only on the first check-in of the day (stay quiet on post-lunch re-entries)
    if (!result.already_existed) {
      const placeName = cachedSettings?.work_name || 'Work';
      await sendLocalNotification(
        {
          title:
            result.status === 'PRESENT'
              ? `Marked Present at ${placeName}`
              : `Marked Late at ${placeName}`,
          body: `Checked in automatically at ${formatTime12h(result.time)}.`,
        },
        deps.Notifications
      );
    }

    return {
      skipped: false,
      queuedOffline: false,
      result,
    };
  } catch (err) {
    // Network unreachable (e.g. underground parking): queue exact arrival timestamp locally
    await enqueuePendingCheckIn(
      {
        date: local.date,
        time: local.time,
        latitude,
        longitude,
        trigger: 'GEOFENCE',
      },
      deps.storage
    );

    await sendLocalNotification(
      {
        title: 'Arrival Recorded Offline',
        body: `Logged arrival at ${formatTime12h(local.time)}. Will sync when online.`,
      },
      deps.Notifications
    );

    return {
      skipped: false,
      queuedOffline: true,
      error: err.message,
    };
  }
}

/**
 * Defines the headless OS background task at top-level module scope.
 * Must be called in `mobile/index.js` before `registerRootComponent(App)`.
 */
function registerBackgroundGeofenceTask(deps = {}) {
  const { Location, TaskManager, Notifications } = {
    ...getDefaultNativeModules({
      ...deps,
      needTaskManager: true,
      needNotifications: true,
    }),
    ...deps,
  };

  if (!TaskManager || TaskManager.isTaskDefined(GEOFENCE_TASK_NAME)) {
    return;
  }

  TaskManager.defineTask(GEOFENCE_TASK_NAME, async ({ data, error }) => {
    if (error) {
      console.warn('Geofence background task error:', error.message || error);
      return;
    }
    if (!data) return;

    const { eventType, region } = data;
    if (eventType === Location.GeofencingEventType.Enter) {
      await processGeofenceEnterEvent(
        {
          latitude: region?.latitude ?? null,
          longitude: region?.longitude ?? null,
          now: new Date(),
        },
        { ...deps, Notifications }
      );
    }
  });
}

/**
 * Starts a foreground GPS boundary watcher (`watchPositionAsync`) as a seamless fallback
 * when running inside Expo Go on iOS (where Apple's App Store Expo Go binary does not include
 * the background `NSLocationAlwaysAndWhenInUseUsageDescription` Info.plist key).
 */
async function startLiveForegroundGeofenceWatcher(
  { targetLat, targetLng, radius },
  deps = {}
) {
  const { Location, Notifications } = {
    ...getDefaultNativeModules(deps),
    ...deps,
  };

  if (activeLiveWatcher && typeof activeLiveWatcher.remove === 'function') {
    activeLiveWatcher.remove();
    activeLiveWatcher = null;
  }

  if (typeof Location.watchPositionAsync !== 'function') {
    return false;
  }

  activeLiveWatcher = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy ? Location.Accuracy.Balanced : 3,
      timeInterval: 10000,
      distanceInterval: 10,
    },
    async (pos) => {
      const lat = pos?.coords?.latitude;
      const lng = pos?.coords?.longitude;
      if (typeof lat !== 'number' || typeof lng !== 'number') return;

      const dist = calculateDistanceMeters(lat, lng, targetLat, targetLng);
      const todayDate = getDeviceLocalParts(new Date()).date;

      if (dist <= radius && liveWatcherTriggeredDate !== todayDate) {
        liveWatcherTriggeredDate = todayDate;
        await processGeofenceEnterEvent(
          {
            latitude: lat,
            longitude: lng,
            now: new Date(),
          },
          { ...deps, Notifications }
        );
      }
    }
  );

  return true;
}

/**
 * Requests OS location permissions and registers the workplace geofence.
 * Automatically falls back to Live GPS Geofence Monitoring in Expo Go on iOS
 * if `NSLocationAlwaysAndWhenInUseUsageDescription` is absent in the host binary's Info.plist.
 */
async function syncGeofenceRegistration(settings, deps = {}) {
  const { Location, Notifications } = {
    ...getDefaultNativeModules(deps),
    ...deps,
  };

  if (
    !settings ||
    (Number(settings.work_latitude) === 0 &&
      Number(settings.work_longitude) === 0)
  ) {
    return {
      active: false,
      reason: 'Work coordinates not configured yet.',
    };
  }

  const targetLat = Number(settings.work_latitude);
  const targetLng = Number(settings.work_longitude);
  const radius = Math.max(50, Number(settings.radius_meters) || 100);

  // 1. Request Foreground ("When In Use") Permission
  let fg;
  try {
    fg = await Location.requestForegroundPermissionsAsync();
  } catch (err) {
    return {
      active: false,
      reason: `Location permission error: ${err?.message || err}`,
    };
  }

  if (fg?.status !== 'granted') {
    return {
      active: false,
      reason: 'Foreground location permission denied.',
    };
  }

  if (
    Notifications &&
    typeof Notifications.requestPermissionsAsync === 'function'
  ) {
    try {
      await Notifications.requestPermissionsAsync();
    } catch {
      // Non-fatal if notifications permission is declined
    }
  }

  // 2. Try Native Background Geofencing (works in Dev Builds, Standalone Apps & Android)
  try {
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg?.status === 'granted') {
      await Location.startGeofencingAsync(GEOFENCE_TASK_NAME, [
        {
          identifier: WORK_REGION_IDENTIFIER,
          latitude: targetLat,
          longitude: targetLng,
          radius,
          notifyOnEnter: true,
          notifyOnExit: false,
        },
      ]);

      return {
        active: true,
        mode: 'native_background',
        radius,
        latitude: targetLat,
        longitude: targetLng,
      };
    }
  } catch {
    // In Expo Go on iOS, requestBackgroundPermissionsAsync rejects with ERR_LOCATION_INFO_PLIST
    // because the store Expo Go binary only includes WhenInUse in Info.plist.
    // Fall through to Live Foreground Geofence Watcher below!
  }

  // 3. Fallback: Live GPS Boundary Watcher (works inside Expo Go on iOS!)
  try {
    const startedLive = await startLiveForegroundGeofenceWatcher(
      { targetLat, targetLng, radius },
      deps
    );
    if (startedLive) {
      return {
        active: true,
        mode: 'expo_go_live',
        radius,
        latitude: targetLat,
        longitude: targetLng,
        note: 'Armed in Expo Go Live GPS mode (auto check-in active while app is open).',
      };
    }
  } catch (err) {
    return {
      active: false,
      reason: err?.message || 'Could not start geofence watcher.',
    };
  }

  return {
    active: false,
    reason:
      'Background ("Always Allow") location permission is required for background check-ins.',
  };
}

async function stopGeofenceRegistration(deps = {}) {
  const { Location } = {
    ...getDefaultNativeModules(deps),
    ...deps,
  };

  if (activeLiveWatcher && typeof activeLiveWatcher.remove === 'function') {
    activeLiveWatcher.remove();
    activeLiveWatcher = null;
  }

  try {
    const started = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME);
    if (started) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME);
    }
  } catch {
    // Ignore if not supported in Expo Go
  }

  return { active: false };
}

async function getGeofenceStatus(deps = {}) {
  const { Location } = {
    ...getDefaultNativeModules(deps),
    ...deps,
  };

  let fgGranted = false;
  let bgGranted = false;
  let nativeStarted = false;

  try {
    const fg = await Location.getForegroundPermissionsAsync();
    fgGranted = fg?.status === 'granted';
  } catch {
    fgGranted = false;
  }

  try {
    const bg = await Location.getBackgroundPermissionsAsync();
    bgGranted = bg?.status === 'granted';
  } catch {
    bgGranted = false;
  }

  try {
    nativeStarted = Boolean(
      await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME)
    );
  } catch {
    nativeStarted = false;
  }

  const liveActive = Boolean(activeLiveWatcher);

  return {
    active: nativeStarted || liveActive,
    mode: nativeStarted
      ? 'native_background'
      : liveActive
        ? 'expo_go_live'
        : 'inactive',
    foregroundGranted: fgGranted,
    backgroundGranted: bgGranted,
  };
}

module.exports = {
  GEOFENCE_TASK_NAME,
  WORK_REGION_IDENTIFIER,
  calculateDistanceMeters,
  getDeviceLocalParts,
  processGeofenceEnterEvent,
  registerBackgroundGeofenceTask,
  syncGeofenceRegistration,
  stopGeofenceRegistration,
  getGeofenceStatus,
};
