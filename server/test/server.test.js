const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');

describe('Attendance Tracker — Server (WFO / WFH / LEAVE model)', () => {
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

  it('does not auto-mark WFH while the work location is not configured', () => {
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

  it('arrival within the window marks WFO and repeat arrivals are idempotent', async () => {
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
    assert.equal(data1.status, 'WFO');
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
    assert.equal(data2.status, 'WFO');

    // Absence check must leave a WFO day untouched
    assert.equal(server.runAbsenceCheck().marked, false);
    assert.equal(store.getAttendanceByDate('2026-11-05').status, 'WFO');
  });

  it('arrival after window end marks WFH but still logs the arrival time', async () => {
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
    assert.equal(data.status, 'WFH');
  });

  it('auto-marks a workday WFH only after the window closes with no arrival', () => {
    // Sunday 2026-11-08 11:00 IST — non-working day, never auto-marked
    currentClock = new Date('2026-11-08T05:30:00.000Z');
    assert.equal(server.runAbsenceCheck().reason, 'non_work_day');
    assert.equal(store.getAttendanceByDate('2026-11-08'), null);

    // Monday 2026-11-09 09:59 IST — window still open
    currentClock = new Date('2026-11-09T04:29:00.000Z');
    assert.equal(server.runAbsenceCheck().reason, 'window_open');
    assert.equal(store.getAttendanceByDate('2026-11-09'), null);

    // Monday 10:01 IST — window closed, nothing recorded -> WFH
    currentClock = new Date('2026-11-09T04:31:00.000Z');
    const result = server.runAbsenceCheck();
    assert.equal(result.marked, true);
    const rec = store.getAttendanceByDate('2026-11-09');
    assert.equal(rec.status, 'WFH');
    assert.equal(rec.trigger_type, 'AUTO');
    assert.equal(rec.check_in_time, null);

    // Running again is a no-op
    assert.equal(server.runAbsenceCheck().marked, false);
  });

  it('an offline-queued arrival from inside the window upgrades an auto-WFH day to WFO', async () => {
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
    assert.equal(data.status, 'WFO');
    assert.equal(data.time, '09:40:00');
    assert.equal(data.trigger, 'GEOFENCE');
  });

  it('PUT /api/attendance/:date manually marks LEAVE, then WFO, then clears the day', async () => {
    const leaveRes = await server.inject({
      method: 'PUT',
      url: '/api/attendance/2026-11-10',
      headers: jsonAuth,
      body: { status: 'LEAVE', notes: 'Personal leave' },
    });
    assert.equal(leaveRes.status, 200);
    const leaveData = await leaveRes.json();
    assert.equal(leaveData.record.status, 'LEAVE');
    assert.equal(leaveData.record.trigger_type, 'MANUAL');
    assert.equal(leaveData.record.notes, 'Personal leave');

    // A geofence arrival must not override an explicit manual leave
    currentClock = new Date('2026-11-10T03:45:00.000Z'); // 09:15 IST
    const arrival = await server.inject({
      method: 'POST',
      url: '/api/checkin',
      headers: jsonAuth,
      body: { trigger: 'GEOFENCE' },
    });
    const arrivalData = await arrival.json();
    assert.equal(arrivalData.already_existed, true);
    assert.equal(arrivalData.status, 'LEAVE');

    const wfoRes = await server.inject({
      method: 'PUT',
      url: '/api/attendance/2026-11-10',
      headers: jsonAuth,
      body: { status: 'WFO', time: '09:05' },
    });
    const wfoData = await wfoRes.json();
    assert.equal(wfoData.record.status, 'WFO');
    assert.equal(wfoData.record.check_in_time, '09:05:00');

    const clearRes = await server.inject({
      method: 'PUT',
      url: '/api/attendance/2026-11-10',
      headers: jsonAuth,
      body: { status: null },
    });
    assert.equal(clearRes.status, 200);
    assert.equal(store.getAttendanceByDate('2026-11-10'), null);
  });

  it('PUT /api/attendance/:date rejects statuses other than WFO / WFH / LEAVE / HOLIDAY', async () => {
    for (const status of ['PRESENT', 'ABSENT', 'LATE', 'whatever']) {
      const res = await server.inject({
        method: 'PUT',
        url: '/api/attendance/2026-11-11',
        headers: jsonAuth,
        body: { status },
      });
      assert.equal(res.status, 400);
    }
  });

  it('GET /api/history computes total_working_days (excluding Sat, Sun, Leave, Holiday) and WFO/WFH percentages based on working days', async () => {
    // Add a LEAVE on 2026-11-12 (Thursday) and a HOLIDAY on 2026-11-13 (Friday)
    await server.inject({
      method: 'PUT',
      url: '/api/attendance/2026-11-12',
      headers: jsonAuth,
      body: { status: 'LEAVE', notes: 'Doctor appointment' },
    });
    const holidayRes = await server.inject({
      method: 'PUT',
      url: '/api/attendance/2026-11-13',
      headers: jsonAuth,
      body: { status: 'HOLIDAY', notes: 'Public Holiday' },
    });
    assert.equal(holidayRes.status, 200);
    const holidayData = await holidayRes.json();
    assert.equal(holidayData.record.status, 'HOLIDAY');

    const res = await server.inject({
      method: 'GET',
      url: '/api/history?month=2026-11',
      headers: auth,
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.month, '2026-11');
    // Nov 2026 has 30 days, 9 weekend days -> 21 weekdays.
    // Subtract 1 weekday LEAVE (Nov 12) and 1 weekday HOLIDAY (Nov 13) -> 19 total working days.
    assert.equal(data.summary.calendar_days, 30);
    assert.equal(data.summary.weekend_days, 9);
    assert.equal(data.summary.total_working_days, 19);
    assert.equal(data.summary.wfo, 2);
    assert.equal(data.summary.wfh, 1);
    assert.equal(data.summary.leave, 1);
    assert.equal(data.summary.holiday, 1);
    // Percentages based on 19 working days: 2/19 = 10.5%, 1/19 = 5.3%
    assert.equal(data.summary.wfo_percent, 10.5);
    assert.equal(data.summary.wfh_percent, 5.3);
    assert.equal(data.summary.wfo_ratio, undefined);
    assert.equal(data.summary.wfh_ratio, undefined);
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
  it('converts old rows to the WFO / WFH / LEAVE model', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-migrate-'));
    const dbPath = path.join(dir, 'legacy.db');

    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE attendance_log (
        date TEXT PRIMARY KEY,
        check_in_time TEXT,
        status TEXT NOT NULL CHECK(status IN ('PRESENT', 'ABSENT')),
        trigger_type TEXT DEFAULT 'GEOFENCE',
        latitude REAL,
        longitude REAL,
        notes TEXT
      );
      INSERT INTO attendance_log (date, check_in_time, status) VALUES
        ('2026-10-01', '09:10:00', 'PRESENT'),
        ('2026-10-02', '10:40:00', 'ABSENT'),
        ('2026-10-03', '09:00:00', 'PRESENT');
    `);
    legacy.close();

    const migrated = createDatabase(dbPath);
    try {
      assert.equal(migrated.getAttendanceByDate('2026-10-01').status, 'WFO');
      assert.equal(migrated.getAttendanceByDate('2026-10-02').status, 'WFH');
      assert.equal(migrated.getAttendanceByDate('2026-10-02').check_in_time, '10:40:00');
      assert.equal(migrated.getAttendanceByDate('2026-10-03').status, 'WFO');

      // New schema allows auto-marking WFH
      assert.equal(migrated.markWfhIfMissing('2026-10-05'), true);
      assert.equal(migrated.getAttendanceByDate('2026-10-05').status, 'WFH');
    } finally {
      migrated.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Attendance Tracker — User Authentication & Profile', () => {
  it('authenticates default user (sunil / test) and allows profile update', async () => {
    const store = createDatabase(':memory:');
    const app = createApp({ store, apiKey: 'secret_key_123' });

    try {
      // 1. Default login succeeds even before X-API-Key is configured
      const loginOk = await app.inject({
        method: 'POST',
        url: '/api/login',
        body: { username: 'sunil', password: 'test' },
      });
      assert.equal(loginOk.status, 200);
      const loginBody = await loginOk.json();
      assert.equal(loginBody.success, true);
      assert.equal(loginBody.user.username, 'sunil');

      // 2. Wrong password fails with 401
      const loginBad = await app.inject({
        method: 'POST',
        url: '/api/login',
        body: { username: 'sunil', password: 'wrong' },
      });
      assert.equal(loginBad.status, 401);

      // 3. Update profile username & password via PUT /api/profile
      const updateRes = await app.inject({
        method: 'PUT',
        url: '/api/profile',
        headers: { 'X-API-Key': 'secret_key_123' },
        body: { username: 'sunil_admin', password: 'newpassword' },
      });
      assert.equal(updateRes.status, 200);
      const updateData = await updateRes.json();
      assert.equal(updateData.user.username, 'sunil_admin');

      // 4. Old credentials fail, new credentials succeed
      const oldLogin = await app.inject({
        method: 'POST',
        url: '/api/login',
        body: { username: 'sunil', password: 'test' },
      });
      assert.equal(oldLogin.status, 401);

      const newLogin = await app.inject({
        method: 'POST',
        url: '/api/login',
        body: { username: 'sunil_admin', password: 'newpassword' },
      });
      assert.equal(newLogin.status, 200);
    } finally {
      store.close();
    }
  });
});

describe('Attendance Tracker — Spreadsheet Import (.xlsx / .csv) & Excel Export', () => {
  it('dynamically scrapes Holiday Reference, Monthly Off-Dates, WFO/WFH/LEAVE/PH, Login/Logout, NSA, On Call, CR notes, and exports/re-imports .xlsx', async () => {
    const store = createDatabase(':memory:');
    const app = createApp({ store, apiKey: 'sheet_key_123' });
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': 'sheet_key_123',
    };

    const sampleCsv = [
      '2024-01-01,21',
      ',,,Holidays,January,October,November',
      'Date,Name,,2024-11-01,2026-01-03,2026-10-02,2026-11-01',
      '2024-01-15,Makara Sankranti,,2024-11-02,2026-01-15,2026-10-20,2026-11-10',
      '2024-01-26,Republic Day,,,2026-01-26,,',
      '2024-10-02,Gandhi Jayanti,,,,,',
      '',
      ',Date,Day,Login,Logout,Description,,NSA,ON Call,,,,January,,,,No of Working Days,,,2026-01-01,20',
      ',2026-01-01,Thu,12:00:00,22:00:00,WFH,,Yes,Yes,rcvd,,WFO (RGA),15,75',
      ',2026-01-02,Fri,12:00:00,22:00:00,WFO,,Yes,,,,WFH(Remote),5,25',
      ',2026-01-03,Sat,,,,,,Yes,rcvd,,Public Holiday,1,5',
      ',2026-01-15,Thu,,,,,,,,,,Leave,0,0',
      ',2026-01-26,Mon,,,PH,,,,,',
      '',
      ',Date,Day,Login,Logout,Description,,NSA,ON Call,,,,October,,,,No of Working Days,,,2026-01-01,17',
      ',2026-10-02,Fri,,,PH,,,,,',
      ',2026-10-05,Mon,,,Leave,,,,,',
      ',2026-10-10,Sat,,,CR implementation - CHG0095532,,,Yes',
      ',2026-10-20,Tue,,,PH - Worked on CSA policy creation,,,Yes',
      '',
      ',Date,Day,Login,Logout,Description,,NSA,ON Call,,,,November,,,,No of Working Days,,,,20',
      ',2026-11-01,Sun,,,CR- Spring Park LB Upgrade,,,Yes',
      ',2026-11-06,Fri,Thu,12:00:00,WFO,,Yes,',
      ',2026-11-10,Tue,,,,,,,,,',
    ].join('\n');

    try {
      // 1. Import via CSV text
      const importRes = await app.inject({
        method: 'POST',
        url: '/api/import',
        headers,
        body: {
          filename: 'Shift_2026.csv',
          csv_text: sampleCsv,
          mode: 'replace',
        },
      });
      assert.equal(importRes.status, 200);
      const importData = await importRes.json();
      assert.equal(importData.success, true);
      assert.equal(importData.imported_holidays, 3);
      assert.deepEqual(importData.months, ['2026-01', '2026-10', '2026-11']);

      // 2. Verify January history: 2026-01-15 auto-detected as HOLIDAY ('Makara Sankranti') from top reference grid
      const janRes = await app.inject({
        method: 'GET',
        url: '/api/history?month=2026-01',
        headers: { 'X-API-Key': 'sheet_key_123' },
      });
      assert.equal(janRes.status, 200);
      const janData = await janRes.json();
      assert.equal(janData.summary.wfo, 1);
      assert.equal(janData.summary.wfh, 1);
      assert.equal(janData.summary.holiday, 2); // 2026-01-15 + 2026-01-26
      assert.equal(janData.summary.nsa_count, 2);
      assert.equal(janData.summary.on_call_count, 2);
      assert.equal(janData.summary.total_working_days, 20); // 22 weekdays - 2 holidays = 20

      const jan15 = store.getAttendanceByDate('2026-01-15');
      assert.equal(jan15.status, 'HOLIDAY');
      assert.equal(jan15.notes, 'Makara Sankranti');

      const jan01 = store.getAttendanceByDate('2026-01-01');
      assert.equal(jan01.check_in_time, '12:00:00');
      assert.equal(jan01.check_out_time, '22:00:00');
      assert.equal(jan01.nsa, 1);
      assert.equal(jan01.on_call, 1);
      assert.equal(jan01.remarks, 'rcvd');

      // 3. Verify October special cases: weekend CR on-call & 'PH - Worked on CSA policy creation'
      const oct10 = store.getAttendanceByDate('2026-10-10');
      assert.equal(oct10.status, null);
      assert.equal(oct10.on_call, 1);
      assert.equal(oct10.notes, 'CR implementation - CHG0095532');

      const oct20 = store.getAttendanceByDate('2026-10-20');
      assert.equal(oct20.status, 'HOLIDAY');
      assert.equal(oct20.on_call, 1);
      assert.equal(oct20.notes, 'Worked on CSA policy creation');

      // 4. Verify November shifted login typo recovery (2026-11-06)
      const nov06 = store.getAttendanceByDate('2026-11-06');
      assert.equal(nov06.status, 'WFO');
      assert.equal(nov06.check_in_time, '12:00:00');
      assert.equal(nov06.nsa, 1);

      // 5. Export to .xlsx binary workbook and re-import into a fresh database
      const exportRes = await app.inject({
        method: 'GET',
        url: '/api/export',
        headers: { 'X-API-Key': 'sheet_key_123' },
      });
      assert.equal(exportRes.status, 200);
      assert.ok(
        (exportRes.headers['Content-Type'] || exportRes.headers['content-type']).includes(
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
      );
      const xlsxBuf = await exportRes.buffer();
      assert.ok(xlsxBuf.length > 500);
      // Verify PKZIP magic bytes
      assert.equal(xlsxBuf[0], 0x50);
      assert.equal(xlsxBuf[1], 0x4b);

      const roundTripRes = await app.inject({
        method: 'POST',
        url: '/api/import',
        headers,
        body: {
          filename: 'Exported.xlsx',
          content_base64: xlsxBuf.toString('base64'),
          mode: 'replace',
        },
      });
      assert.equal(roundTripRes.status, 200);
      const rtData = await roundTripRes.json();
      assert.equal(rtData.imported_records, importData.imported_records);
      assert.equal(rtData.imported_holidays, importData.imported_holidays);
    } finally {
      store.close();
    }
  });
});
