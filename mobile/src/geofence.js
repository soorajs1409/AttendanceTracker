const {
  submitCheckIn,
  enqueuePendingCheckIn,
  getCachedWorkplaceSettings,
  formatTime12h,
} = require('./api');

const GEOFENCE_TASK_NAME = 'WORK_ATTENDANCE_TASK';
const WORK_REGION_IDENTIFIER = 'work-location';

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
function getDefaultNativeModules() {
  const Location = require('expo-location');
  const TaskManager = require('expo-task-manager');
  const Notifications = require('expo-notifications');
  return { Location, TaskManager, Notifications };
}

async function sendLocalNotification(
  { title, body },
  notificationsModule = null
) {
  try {
    const Notifications =
      notificationsModule || getDefaultNativeModules().Notifications;
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
      },
      trigger: null, // Immediate local notification
    });
  } catch {
    // Ignore notification errors if user disabled notifications
  }
}

/**
 * Core handler invoked when the OS detects entry into the workplace geofence
 * (or when triggered via the 'Simulate Geofence Entry' test button).
 */
async function processGeofenceEnterEvent(
  { latitude = null, longitude = null, now = new Date(), bypassScheduleGuard = false } = {},
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
    ...getDefaultNativeModules(),
    ...deps,
  };

  if (TaskManager.isTaskDefined(GEOFENCE_TASK_NAME)) {
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
 * Requests OS foreground + background location permissions and registers
 * the single circular geofence around the configured workplace.
 */
async function syncGeofenceRegistration(settings, deps = {}) {
  const { Location, Notifications } = {
    ...getDefaultNativeModules(),
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

  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') {
    return {
      active: false,
      reason: 'Foreground location permission denied.',
    };
  }

  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') {
    return {
      active: false,
      reason:
        'Background ("Always Allow") location permission is required for automatic check-ins.',
    };
  }

  try {
    await Notifications.requestPermissionsAsync();
  } catch {
    // Non-fatal if notifications permission is declined
  }

  const radius = Math.max(50, Number(settings.radius_meters) || 100);

  await Location.startGeofencingAsync(GEOFENCE_TASK_NAME, [
    {
      identifier: WORK_REGION_IDENTIFIER,
      latitude: Number(settings.work_latitude),
      longitude: Number(settings.work_longitude),
      radius,
      notifyOnEnter: true,
      notifyOnExit: false,
    },
  ]);

  return {
    active: true,
    radius,
    latitude: Number(settings.work_latitude),
    longitude: Number(settings.work_longitude),
  };
}

async function stopGeofenceRegistration(deps = {}) {
  const { Location } = {
    ...getDefaultNativeModules(),
    ...deps,
  };
  const started = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME);
  if (started) {
    await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME);
  }
  return { active: false };
}

async function getGeofenceStatus(deps = {}) {
  const { Location } = {
    ...getDefaultNativeModules(),
    ...deps,
  };
  try {
    const [fg, bg, started] = await Promise.all([
      Location.getForegroundPermissionsAsync(),
      Location.getBackgroundPermissionsAsync(),
      Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME),
    ]);
    return {
      active: Boolean(started),
      foregroundGranted: fg.status === 'granted',
      backgroundGranted: bg.status === 'granted',
    };
  } catch {
    return {
      active: false,
      foregroundGranted: false,
      backgroundGranted: false,
    };
  }
}

module.exports = {
  GEOFENCE_TASK_NAME,
  WORK_REGION_IDENTIFIER,
  getDeviceLocalParts,
  processGeofenceEnterEvent,
  registerBackgroundGeofenceTask,
  syncGeofenceRegistration,
  stopGeofenceRegistration,
  getGeofenceStatus,
};
