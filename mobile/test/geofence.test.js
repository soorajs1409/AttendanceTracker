const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../../server/src/db');
const { createApp } = require('../../server/src/app');
const {
  saveConnectionConfig,
  saveSettings,
  getPendingCheckIns,
  flushPendingCheckIns,
  setDayAttendance,
  isOnboardingCompleted,
  setOnboardingCompleted,
  resetOnboarding,
  loginUser,
  updateProfile,
  getAuthUser,
  logoutUser,
} = require('../src/api');
const {
  GEOFENCE_TASK_NAME,
  WORK_REGION_IDENTIFIER,
  syncGeofenceRegistration,
  processGeofenceEnterEvent,
} = require('../src/geofence');

function createMockStorage() {
  const map = new Map();
  return {
    getItem: async (k) => (map.has(k) ? map.get(k) : null),
    setItem: async (k, v) => {
      map.set(k, String(v));
    },
    removeItem: async (k) => {
      map.delete(k);
    },
  };
}

describe('Attendance Tracker — Stage 3 Mobile Geofencing & Offline Queue Tests', () => {
  let dbStore;
  let server;
  let mobileStorage;
  let notificationsSent;
  let startedRegions;
  const TEST_KEY = 'mobile_secret_777';

  // Thursday 2026-11-05 at 09:12:00 IST
  let serverClock = new Date('2026-11-05T03:42:00.000Z');
  let simulateNetworkOutage = false;

  // Bridge mobile fetch() directly to server.inject()
  const fetchBridge = async (fullUrl, opts = {}) => {
    if (simulateNetworkOutage) {
      throw new Error('Network request failed (offline)');
    }
    const parsed = new URL(fullUrl);
    const res = await server.inject({
      method: opts.method || 'GET',
      url: `${parsed.pathname}${parsed.search}`,
      headers: opts.headers || {},
      body: opts.body || null,
    });
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      headers: {
        get: (name) =>
          res.headers[name] || res.headers[name.toLowerCase()] || 'application/json',
      },
      json: res.json,
    };
  };

  const mockLocationModule = {
    GeofencingEventType: { Enter: 1, Exit: 2 },
    requestForegroundPermissionsAsync: async () => ({ status: 'granted' }),
    requestBackgroundPermissionsAsync: async () => ({ status: 'granted' }),
    startGeofencingAsync: async (taskName, regions) => {
      startedRegions = { taskName, regions };
    },
  };

  const mockNotificationsModule = {
    requestPermissionsAsync: async () => ({ status: 'granted' }),
    scheduleNotificationAsync: async (payload) => {
      notificationsSent.push(payload);
    },
  };

  before(async () => {
    dbStore = createDatabase(':memory:');
    server = createApp({
      store: dbStore,
      apiKey: TEST_KEY,
      timezone: 'Asia/Kolkata',
      clock: () => serverClock,
    });
    mobileStorage = createMockStorage();
    notificationsSent = [];
    startedRegions = null;

    await saveConnectionConfig(
      { serverUrl: 'http://homelab.local:3000', apiKey: TEST_KEY },
      mobileStorage
    );
  });

  after(() => {
    dbStore.close();
  });

  it('saves workplace settings from mobile and arms OS circular geofence region', async () => {
    const res = await saveSettings(
      {
        work_name: 'Downtown Studio',
        work_latitude: 12.9716,
        work_longitude: 77.5946,
        radius_meters: 150,
        window_start: '09:00',
        window_end: '10:00',
        work_days: [1, 2, 3, 4, 5],
      },
      { storage: mobileStorage, fetchImpl: fetchBridge }
    );

    const geo = await syncGeofenceRegistration(res.settings, {
      Location: mockLocationModule,
      Notifications: mockNotificationsModule,
    });

    assert.equal(geo.active, true);
    assert.equal(startedRegions.taskName, GEOFENCE_TASK_NAME);
    assert.equal(startedRegions.regions.length, 1);
    assert.equal(startedRegions.regions[0].identifier, WORK_REGION_IDENTIFIER);
    assert.equal(startedRegions.regions[0].radius, 150);
    assert.equal(startedRegions.regions[0].notifyOnEnter, true);
    assert.equal(startedRegions.regions[0].notifyOnExit, false);
  });

  it('skips geofence auto check-in on non-working days (e.g. Sunday)', async () => {
    // Sunday Nov 8, 2026 at 09:30 local
    const sundayMorning = new Date(2026, 10, 8, 9, 30, 0);
    const out = await processGeofenceEnterEvent(
      { latitude: 12.9716, longitude: 77.5946, now: sundayMorning },
      {
        storage: mobileStorage,
        fetchImpl: fetchBridge,
        Notifications: mockNotificationsModule,
      }
    );

    assert.equal(out.skipped, true);
    assert.equal(out.reason, 'non_work_day');
    assert.equal(notificationsSent.length, 0);
  });

  it('marks WFO on workday geofence entry and suppresses duplicate lunch re-entry notifications', async () => {
    // Thursday Nov 5, 2026 at 09:12 local
    const thursdayMorning = new Date(2026, 10, 5, 9, 12, 0);
    const out1 = await processGeofenceEnterEvent(
      { latitude: 12.9717, longitude: 77.5945, now: thursdayMorning },
      {
        storage: mobileStorage,
        fetchImpl: fetchBridge,
        Notifications: mockNotificationsModule,
      }
    );

    assert.equal(out1.skipped, false);
    assert.equal(out1.queuedOffline, false);
    assert.equal(out1.result.status, 'WFO');
    assert.equal(out1.result.already_existed, false);
    assert.equal(notificationsSent.length, 1);
    assert.ok(notificationsSent[0].content.title.includes('Marked WFO'));

    // Re-enter after lunch at 13:30 — must remain WFO at 09:12 and send 0 new notifications
    const postLunch = new Date(2026, 10, 5, 13, 30, 0);
    const out2 = await processGeofenceEnterEvent(
      { latitude: 12.9717, longitude: 77.5945, now: postLunch },
      {
        storage: mobileStorage,
        fetchImpl: fetchBridge,
        Notifications: mockNotificationsModule,
      }
    );

    assert.equal(out2.result.already_existed, true);
    assert.equal(out2.result.status, 'WFO');
    assert.equal(notificationsSent.length, 1);
  });

  it('queues arrival timestamp offline when cellular drops and syncs cleanly on reconnect', async () => {
    // Friday Nov 6, 2026 at 09:25 local — underground garage (no network)
    simulateNetworkOutage = true;
    serverClock = new Date('2026-11-06T03:55:00.000Z');
    const fridayMorning = new Date(2026, 10, 6, 9, 25, 15);

    const offlineOut = await processGeofenceEnterEvent(
      { latitude: 12.9716, longitude: 77.5946, now: fridayMorning },
      {
        storage: mobileStorage,
        fetchImpl: fetchBridge,
        Notifications: mockNotificationsModule,
      }
    );

    assert.equal(offlineOut.queuedOffline, true);
    const pendingBefore = await getPendingCheckIns(mobileStorage);
    assert.equal(pendingBefore.length, 1);
    assert.equal(pendingBefore[0].date, '2026-11-06');
    assert.equal(pendingBefore[0].time, '09:25:15');

    // Reconnect 2 hours later (11:25 IST) — queued 09:25:15 timestamp must still evaluate as WFO!
    simulateNetworkOutage = false;
    serverClock = new Date('2026-11-06T05:55:00.000Z');

    const flushResult = await flushPendingCheckIns({
      storage: mobileStorage,
      fetchImpl: fetchBridge,
    });
    assert.equal(flushResult.flushed, 1);
    assert.equal(flushResult.remaining, 0);

    const savedRecord = dbStore.getAttendanceByDate('2026-11-06');
    assert.equal(savedRecord.check_in_time, '09:25:15');
    assert.equal(savedRecord.status, 'WFO');
  });

  it('marks WFH on workday geofence entry after window has closed', async () => {
    // Monday Nov 9, 2026 at 10:15 local (window ends at 10:00)
    serverClock = new Date('2026-11-09T04:45:00.000Z');
    const lateArrival = new Date(2026, 10, 9, 10, 15, 0);

    const out = await processGeofenceEnterEvent(
      { latitude: 12.9717, longitude: 77.5945, now: lateArrival },
      {
        storage: mobileStorage,
        fetchImpl: fetchBridge,
        Notifications: mockNotificationsModule,
      }
    );

    assert.equal(out.skipped, false);
    assert.equal(out.result.status, 'WFH');
    const saved = dbStore.getAttendanceByDate('2026-11-09');
    assert.equal(saved.status, 'WFH');
    assert.equal(saved.check_in_time, '10:15:00');
    assert.ok(notificationsSent[notificationsSent.length - 1].content.title.includes('Marked WFH'));
  });

  it('allows mobile setDayAttendance to manually mark LEAVE, WFH, and unmark a day', async () => {
    // Manually mark Nov 10 as LEAVE
    const resLeave = await setDayAttendance(
      '2026-11-10',
      { status: 'LEAVE', notes: 'Personal leave' },
      { storage: mobileStorage, fetchImpl: fetchBridge }
    );
    assert.equal(resLeave.success, true);
    assert.equal(resLeave.record.status, 'LEAVE');
    let rec = dbStore.getAttendanceByDate('2026-11-10');
    assert.equal(rec.status, 'LEAVE');
    assert.equal(rec.notes, 'Personal leave');

    // Unmark Nov 10 (status: null)
    const resClear = await setDayAttendance(
      '2026-11-10',
      { status: null },
      { storage: mobileStorage, fetchImpl: fetchBridge }
    );
    assert.equal(resClear.success, true);
    assert.equal(resClear.record, null);
    rec = dbStore.getAttendanceByDate('2026-11-10');
    assert.equal(rec, null);
  });

  it('manages first-time onboarding state cleanly via storage helpers', async () => {
    // Fresh storage initially returns false
    const initiallyDone = await isOnboardingCompleted(mobileStorage);
    assert.equal(initiallyDone, false);

    // After completing setup
    await setOnboardingCompleted(true, mobileStorage);
    const completed = await isOnboardingCompleted(mobileStorage);
    assert.equal(completed, true);

    // Resetting onboarding returns it to false
    await resetOnboarding(mobileStorage);
    const afterReset = await isOnboardingCompleted(mobileStorage);
    assert.equal(afterReset, false);
  });

  it('gracefully catches iOS Expo Go NSLocation*UsageDescription Info.plist error and falls back to live GPS geofencing', async () => {
    let watchCallback = null;
    const expoGoIosLocationMock = {
      Accuracy: { Balanced: 3 },
      requestForegroundPermissionsAsync: async () => ({ status: 'granted' }),
      requestBackgroundPermissionsAsync: async () => {
        throw new Error(
          'One of the `NSLocation*UsageDescription` keys must be present in Info.plist to be able to use geolocation.'
        );
      },
      watchPositionAsync: async (_opts, cb) => {
        watchCallback = cb;
        return { remove: () => {} };
      },
    };

    const res = await syncGeofenceRegistration(
      {
        work_latitude: 12.9716,
        work_longitude: 77.5946,
        radius_meters: 150,
      },
      {
        Location: expoGoIosLocationMock,
        Notifications: mockNotificationsModule,
        storage: mobileStorage,
        fetchImpl: fetchBridge,
      }
    );

    assert.equal(res.active, true);
    assert.equal(res.mode, 'expo_go_live');
    assert.equal(typeof watchCallback, 'function');
  });

  it('supports mobile login (sunil / test), profile update, and logout', async () => {
    const loginRes = await loginUser(
      { username: 'sunil', password: 'test' },
      { storage: mobileStorage, fetchImpl: fetchBridge }
    );
    assert.equal(loginRes.user.username, 'sunil');

    const storedUser = await getAuthUser(mobileStorage);
    assert.equal(storedUser.username, 'sunil');

    const updated = await updateProfile(
      { username: 'sunil', password: 'test' },
      { storage: mobileStorage, fetchImpl: fetchBridge }
    );
    assert.equal(updated.success, true);

    await logoutUser(mobileStorage);
    const afterLogout = await getAuthUser(mobileStorage);
    assert.equal(afterLogout, null);
  });
});
