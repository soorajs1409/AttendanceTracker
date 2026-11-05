const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');

describe('Attendance Tracker — Stage 1 Lean Backend & SQLite Tests', () => {
  let store;
  let server;
  const TEST_API_KEY = 'test_secret_key_999';

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
    const res = await server.inject({
      method: 'GET',
      url: '/api/health',
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');
  });

  it('rejects requests without valid X-API-Key header with 401', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/status',
    });
    assert.equal(res.status, 401);

    const wrongRes = await server.inject({
      method: 'GET',
      url: '/api/status',
      headers: { 'X-API-Key': 'wrong_key' },
    });
    assert.equal(wrongRes.status, 401);
  });

  it('GET /api/status returns initial default settings and checked_in: false', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/status',
      headers: { 'X-API-Key': TEST_API_KEY },
    });
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.today.date, '2026-11-05');
    assert.equal(data.today.checked_in, false);
    assert.equal(data.today.is_work_day, true);
    assert.equal(data.settings.work_name, 'Office');
    assert.equal(data.settings.window_start, '09:00');
    assert.equal(data.settings.window_end, '10:00');
    assert.deepEqual(data.settings.work_days, [1, 2, 3, 4, 5]);
  });

  it('POST /api/settings updates work location, radius, and arrival window', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/settings',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': TEST_API_KEY,
      },
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
    assert.equal(data.success, true);
    assert.equal(data.settings.work_name, 'Tech Park HQ');
    assert.equal(data.settings.work_latitude, 12.9716);
    assert.equal(data.settings.work_longitude, 77.5946);
    assert.equal(data.settings.radius_meters, 150);
    assert.equal(data.settings.window_start, '08:45');
    assert.equal(data.settings.window_end, '10:00');
  });

  it('POST /api/settings validates invalid coordinates and time formats', async () => {
    const badLatRes = await server.inject({
      method: 'POST',
      url: '/api/settings',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': TEST_API_KEY,
      },
      body: { work_latitude: 125 },
    });
    assert.equal(badLatRes.status, 400);

    const badTimeRes = await server.inject({
      method: 'POST',
      url: '/api/settings',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': TEST_API_KEY,
      },
      body: { window_start: '25:99' },
    });
    assert.equal(badTimeRes.status, 400);
  });

  it('POST /api/checkin marks PRESENT when arriving within window and is idempotent on repeat calls', async () => {
    // 1st check-in at 09:15:30 IST (within 08:45 - 10:00 window)
    const res1 = await server.inject({
      method: 'POST',
      url: '/api/checkin',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': TEST_API_KEY,
      },
      body: {
        latitude: 12.9718,
        longitude: 77.5947,
        trigger: 'GEOFENCE',
      },
    });

    assert.equal(res1.status, 201);
    const data1 = await res1.json();
    assert.equal(data1.success, true);
    assert.equal(data1.already_existed, false);
    assert.equal(data1.date, '2026-11-05');
    assert.equal(data1.time, '09:15:30');
    assert.equal(data1.status, 'PRESENT');
    assert.equal(data1.within_geofence, true);
    assert.ok(data1.distance_meters < 50);

    // Advance clock to 11:30 IST (06:00 UTC) and send duplicate geofence trigger
    currentClock = new Date('2026-11-05T06:00:00.000Z');
    const res2 = await server.inject({
      method: 'POST',
      url: '/api/checkin',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': TEST_API_KEY,
      },
      body: {
        latitude: 12.9718,
        longitude: 77.5947,
        trigger: 'GEOFENCE',
      },
    });

    assert.equal(res2.status, 200);
    const data2 = await res2.json();
    assert.equal(data2.already_existed, true);
    // Original arrival time and PRESENT status must remain untouched
    assert.equal(data2.time, '09:15:30');
    assert.equal(data2.status, 'PRESENT');
  });

  it('POST /api/checkin marks LATE when arriving after window_end on a subsequent day', async () => {
    // Friday, 2026-11-06 at 10:42:10 IST (05:12:10 UTC)
    currentClock = new Date('2026-11-06T05:12:10.000Z');

    const res = await server.inject({
      method: 'POST',
      url: '/api/checkin',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': TEST_API_KEY,
      },
      body: {
        latitude: 12.9716,
        longitude: 77.5946,
        trigger: 'GEOFENCE',
      },
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.date, '2026-11-06');
    assert.equal(data.time, '10:42:10');
    assert.equal(data.status, 'LATE');
  });

  it('GET /api/history?month=2026-11 returns monthly records and summary counts', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/history?month=2026-11',
      headers: { 'X-API-Key': TEST_API_KEY },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.month, '2026-11');
    assert.equal(data.summary.total, 2);
    assert.equal(data.summary.present, 1);
    assert.equal(data.summary.late, 1);
    assert.equal(data.records.length, 2);
    assert.equal(data.records[0].date, '2026-11-05');
    assert.equal(data.records[1].date, '2026-11-06');
  });
});
