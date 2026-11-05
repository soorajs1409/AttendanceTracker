const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');

describe('Attendance Tracker — Server (PRESENT / ABSENT model)', () => {
  let store;
  let server;
  const TEST_API_KEY = 'test_secret_key_999';
  const auth = { 'X-API-Key': TEST_API_KEY };
  const jsonAuth = { 'Content-Type': 'application/json', ...auth };

  // Fixed clock: Thursday, 2026-11-05 at 09:15:30 IST (03:45:30 UTC)
  let currentClock = new Date('2026-11-05T03:45:30.000Z');

  before(() => {
    store = createDatabase(':memory:');
    server = createApp({
      store,
      apiKey: TEST_API_KEY,
      timezone: 'Asia/Kolkata',
      clock: () => currentClock,
    });
  });

  after(() => {
    store.close();
  });

  it('GET /api/health responds 200 without requiring X-API-Key', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/health' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');
  });

  it('rejects requests without valid X-API-Key header with 401', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/status' });
    assert.equal(res.status, 401);

    const wrongRes = await server.inject({
      method: 'GET',
      url: '/api/status',
      headers: { 'X-API-Key': 'wrong_key' },
    });
    assert.equal(wrongRes.status, 401);
  });

  it('GET /api/status returns default settings and an unmarked day', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/status', headers: auth });
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.today.date, '2026-11-05');
    assert.equal(data.today.status, null);
    assert.equal(data.today.checked_in, false);
    assert.equal(data.today.is_work_day, true);
    assert.equal(data.settings.window_start, '09:00');
    assert.equal(data.settings.window_end, '10:00');
    assert.deepEqual(data.settings.work_days, [1, 2, 3, 4, 5]);
  });

  it('does not auto-mark ABSENT while the work location is not configured', () => {
    currentClock = new Date('2026-11-05T06:00:00.000Z'); // 11:30 IST, after window
    const result = server.runAbsenceCheck();
    assert.equal(result.marked, false);
    assert.equal(result.reason, 'location_not_configured');
    assert.equal(store.getAttendanceByDate('2026-11-05'), null);
    currentClock = new Date('2026-11-05T03:45:30.000Z');
  });

  it('POST /api/settings updates work location, radius, and arrival window', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/settings',
      headers: jsonAuth,
      body: {
        work_name: 'Tech Park HQ',
        work_latitude: 12.9716,
        work_longitude: 77.5946,
        radius_meters: 150,
        window_start: '08:45',
        window_end: '10:00',
        work_days: [1, 2, 3, 4, 5],
      },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.settings.work_name, 'Tech Park HQ');
    assert.equal(data.settings.radius_meters, 150);
    assert.equal(data.settings.window_start, '08:45');
  });

  it('POST /api/settings validates invalid coordinates and time formats', async () => {
    const badLatRes = await server.inject({
      method: 'POST',
      url: '/api/settings',
      headers: jsonAuth,
      body: { work_latitude: 125 },
    });
    assert.equal(badLatRes.status, 400);

    const badTimeRes = await server.inject({
      method: 'POST',
      url: '/api/settings',
      headers: jsonAuth,
      body: { window_start: '25:99' },
    });
    assert.equal(badTimeRes.status, 400);
  });

  it('arrival within the window marks PRESENT and repeat arrivals are idempotent', async () => {
    const res1 = await server.inject({
      method: 'POST',
      url: '/api/checkin',
      headers: jsonAuth,
      body: { latitude: 12.9718, longitude: 77.5947, trigger: 'GEOFENCE' },
    });

    assert.equal(res1.status, 201);
    const data1 = await res1.json();
    assert.equal(data1.date, '2026-11-05');
    assert.equal(data1.time, '09:15:30');
    assert.equal(data1.status, 'PRESENT');
    assert.equal(data1.within_geofence, true);

    // Re-entering after lunch must not change anything
    currentClock = new Date('2026-11-05T08:00:00.000Z'); // 13:30 IST
    const res2 = await server.inject({
      method: 'POST',
      url: '/api/checkin',
      headers: jsonAuth,
      body: { latitude: 12.9718, longitude: 77.5947, trigger: 'GEOFENCE' },
    });
    const data2 = await res2.json();
    assert.equal(res2.status, 200);
    assert.equal(data2.already_existed, true);
    assert.equal(data2.time, '09:15:30');
    assert.equal(data2.status, 'PRESENT');

    // Absence check must leave a PRESENT day untouched
    assert.equal(server.runAbsenceCheck().marked, false);
    assert.equal(store.getAttendanceByDate('2026-11-05').status, 'PRESENT');
  });

  it('arrival after window end marks ABSENT but still logs the arrival time', async () => {
    // Friday, 2026-11-06 at 10:42:10 IST
    currentClock = new Date('2026-11-06T05:12:10.000Z');

    const res = await server.inject({
      method: 'POST',
      url: '/api/checkin',
      headers: jsonAuth,
      body: { latitude: 12.9716, longitude: 77.5946, trigger: 'GEOFENCE' },
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.date, '2026-11-06');
    assert.equal(data.time, '10:42:10');
    assert.equal(data.status, 'ABSENT');
  });

  it('auto-marks a workday ABSENT only after the window closes with no arrival', () => {
    // Sunday 2026-11-08 11:00 IST — non-working day, never auto-marked
    currentClock = new Date('2026-11-08T05:30:00.000Z');
    assert.equal(server.runAbsenceCheck().reason, 'non_work_day');
    assert.equal(store.getAttendanceByDate('2026-11-08'), null);

    // Monday 2026-11-09 09:59 IST — window still open
    currentClock = new Date('2026-11-09T04:29:00.000Z');
    assert.equal(server.runAbsenceCheck().reason, 'window_open');
    assert.equal(store.getAttendanceByDate('2026-11-09'), null);

    // Monday 10:01 IST — window closed, nothing recorded -> ABSENT
    currentClock = new Date('2026-11-09T04:31:00.000Z');
    const result = server.runAbsenceCheck();
    assert.equal(result.marked, true);
    const rec = store.getAttendanceByDate('2026-11-09');
    assert.equal(rec.status, 'ABSENT');
    assert.equal(rec.trigger_type, 'AUTO');
    assert.equal(rec.check_in_time, null);

    // Running again is a no-op
    assert.equal(server.runAbsenceCheck().marked, false);
  });

  it('an offline-queued arrival from inside the window upgrades an auto-ABSENT day to PRESENT', async () => {
    // Phone reached work at 09:40 but was offline; replays at 11:15
    currentClock = new Date('2026-11-09T05:45:00.000Z');
    const res = await server.inject({
      method: 'POST',
      url: '/api/checkin',
      headers: jsonAuth,
      body: { date: '2026-11-09', time: '09:40:00', trigger: 'GEOFENCE' },
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.status, 'PRESENT');
    assert.equal(data.time, '09:40:00');
    assert.equal(data.trigger, 'GEOFENCE');
  });

  it('PUT /api/attendance/:date manually marks ABSENT, then PRESENT, then clears the day', async () => {
    const absentRes = await server.inject({
      method: 'PUT',
      url: '/api/attendance/2026-11-10',
      headers: jsonAuth,
      body: { status: 'ABSENT', notes: 'Sick leave' },
    });
    assert.equal(absentRes.status, 200);
    const absent = await absentRes.json();
    assert.equal(absent.record.status, 'ABSENT');
    assert.equal(absent.record.trigger_type, 'MANUAL');
    assert.equal(absent.record.notes, 'Sick leave');

    // A geofence arrival must not override an explicit manual choice
    currentClock = new Date('2026-11-10T03:45:00.000Z'); // 09:15 IST
    const arrival = await server.inject({
      method: 'POST',
      url: '/api/checkin',
      headers: jsonAuth,
      body: { trigger: 'GEOFENCE' },
    });
    const arrivalData = await arrival.json();
    assert.equal(arrivalData.already_existed, true);
    assert.equal(arrivalData.status, 'ABSENT');

    const presentRes = await server.inject({
      method: 'PUT',
      url: '/api/attendance/2026-11-10',
      headers: jsonAuth,
      body: { status: 'PRESENT', time: '09:05' },
    });
    const present = await presentRes.json();
    assert.equal(present.record.status, 'PRESENT');
    assert.equal(present.record.check_in_time, '09:05:00');

    const clearRes = await server.inject({
      method: 'PUT',
      url: '/api/attendance/2026-11-10',
      headers: jsonAuth,
      body: { status: null },
    });
    assert.equal(clearRes.status, 200);
    assert.equal(store.getAttendanceByDate('2026-11-10'), null);
  });

  it('PUT /api/attendance/:date rejects statuses other than PRESENT / ABSENT', async () => {
    for (const status of ['LATE', 'MANUAL', 'whatever']) {
      const res = await server.inject({
        method: 'PUT',
        url: '/api/attendance/2026-11-11',
        headers: jsonAuth,
        body: { status },
      });
      assert.equal(res.status, 400);
    }
  });

  it('GET /api/history returns only marked days with present / absent counts', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/history?month=2026-11',
      headers: auth,
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.month, '2026-11');
    // 05 PRESENT, 06 ABSENT (arrived late), 09 PRESENT (upgraded). 10 was cleared.
    assert.deepEqual(data.summary, { present: 2, absent: 1 });
    assert.deepEqual(
      data.records.map((r) => [r.date, r.status]),
      [
        ['2026-11-05', 'PRESENT'],
        ['2026-11-06', 'ABSENT'],
        ['2026-11-09', 'PRESENT'],
      ]
    );
  });

  it('GET / serves the compiled Web Portal SPA when web/dist exists', async (t) => {
    const indexPath = path.join(__dirname, '..', '..', 'web', 'dist', 'index.html');
    if (!fs.existsSync(indexPath)) {
      t.skip('web/dist not built');
      return;
    }
    const res = await server.inject({ method: 'GET', url: '/' });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('<title>Attendance Tracker</title>'));
  });
});

describe('Attendance Tracker — legacy database migration', () => {
  it('converts old LATE / MANUAL rows to the PRESENT / ABSENT model', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-migrate-'));
    const dbPath = path.join(dir, 'legacy.db');

    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE attendance_log (
        date TEXT PRIMARY KEY,
        check_in_time TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('PRESENT', 'LATE', 'MANUAL')),
        trigger_type TEXT DEFAULT 'GEOFENCE',
        latitude REAL,
        longitude REAL,
        notes TEXT
      );
      INSERT INTO attendance_log (date, check_in_time, status) VALUES
        ('2026-10-01', '09:10:00', 'PRESENT'),
        ('2026-10-02', '10:40:00', 'LATE'),
        ('2026-10-03', '09:00:00', 'MANUAL');
    `);
    legacy.close();

    const migrated = createDatabase(dbPath);
    try {
      assert.equal(migrated.getAttendanceByDate('2026-10-01').status, 'PRESENT');
      assert.equal(migrated.getAttendanceByDate('2026-10-02').status, 'ABSENT');
      assert.equal(migrated.getAttendanceByDate('2026-10-02').check_in_time, '10:40:00');
      assert.equal(migrated.getAttendanceByDate('2026-10-03').status, 'PRESENT');

      // New schema allows ABSENT days with no arrival time
      assert.equal(migrated.markAbsentIfMissing('2026-10-05'), true);
    } finally {
      migrated.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
