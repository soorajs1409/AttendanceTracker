const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

/**
 * Initializes the SQLite database with the 2-table simplified schema
 * (`settings` and `attendance_log`) and provides data access methods.
 *
 * @param {string} [dbPath] - File path to SQLite DB or ':memory:' for tests
 */
function createDatabase(dbPath) {
  const resolvedPath =
    dbPath ||
    process.env.DB_PATH ||
    path.join(__dirname, '..', 'data', 'attendance.db');

  if (resolvedPath !== ':memory:') {
    const dir = path.dirname(resolvedPath);
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(resolvedPath);

  // Enable WAL mode and foreign keys for reliability and concurrent reads
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      work_name TEXT DEFAULT 'Office',
      work_latitude REAL NOT NULL DEFAULT 0.0,
      work_longitude REAL NOT NULL DEFAULT 0.0,
      radius_meters INTEGER NOT NULL DEFAULT 100,
      window_start TEXT NOT NULL DEFAULT '09:00',
      window_end TEXT NOT NULL DEFAULT '10:00',
      work_days TEXT NOT NULL DEFAULT '1,2,3,4,5',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS attendance_log (
      date TEXT PRIMARY KEY,
      check_in_time TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('PRESENT', 'LATE', 'MANUAL')),
      trigger_type TEXT DEFAULT 'GEOFENCE',
      latitude REAL,
      longitude REAL,
      notes TEXT
    );

    INSERT OR IGNORE INTO settings (
      id, work_name, work_latitude, work_longitude, radius_meters, window_start, window_end, work_days
    ) VALUES (
      1, 'Office', 0.0, 0.0, 100, '09:00', '10:00', '1,2,3,4,5'
    );
  `);

  const getSettingsStmt = db.prepare(`
    SELECT id, work_name, work_latitude, work_longitude, radius_meters,
           window_start, window_end, work_days, updated_at
    FROM settings
    WHERE id = 1
  `);

  const getByDateStmt = db.prepare(`
    SELECT date, check_in_time, status, trigger_type, latitude, longitude, notes
    FROM attendance_log
    WHERE date = ?
  `);

  const getRecentStmt = db.prepare(`
    SELECT date, check_in_time, status, trigger_type, latitude, longitude, notes
    FROM attendance_log
    ORDER BY date DESC
    LIMIT ?
  `);

  const getMonthlyStmt = db.prepare(`
    SELECT date, check_in_time, status, trigger_type, latitude, longitude, notes
    FROM attendance_log
    WHERE date LIKE ?
    ORDER BY date ASC
  `);

  const insertCheckInStmt = db.prepare(`
    INSERT INTO attendance_log (
      date, check_in_time, status, trigger_type, latitude, longitude, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const upsertCheckInStmt = db.prepare(`
    INSERT INTO attendance_log (
      date, check_in_time, status, trigger_type, latitude, longitude, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      check_in_time = excluded.check_in_time,
      status = excluded.status,
      trigger_type = excluded.trigger_type,
      latitude = COALESCE(excluded.latitude, attendance_log.latitude),
      longitude = COALESCE(excluded.longitude, attendance_log.longitude),
      notes = COALESCE(excluded.notes, attendance_log.notes)
  `);

  /**
   * Formats raw settings row from SQLite into clean JSON object
   * with `work_days` parsed as an array of integers.
   */
  function formatSettings(row) {
    if (!row) return null;
    const workDays = String(row.work_days || '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n) && n >= 0 && n <= 6);

    return {
      work_name: row.work_name,
      work_latitude: Number(row.work_latitude),
      work_longitude: Number(row.work_longitude),
      radius_meters: Number(row.radius_meters),
      window_start: row.window_start,
      window_end: row.window_end,
      work_days: workDays,
      updated_at: row.updated_at,
    };
  }

  function getSettings() {
    const row = getSettingsStmt.get();
    return formatSettings(row);
  }

  function updateSettings(updates = {}) {
    const current = getSettings();
    const work_name =
      updates.work_name !== undefined ? String(updates.work_name).trim() : current.work_name;
    const work_latitude =
      updates.work_latitude !== undefined
        ? Number(updates.work_latitude)
        : current.work_latitude;
    const work_longitude =
      updates.work_longitude !== undefined
        ? Number(updates.work_longitude)
        : current.work_longitude;
    const radius_meters =
      updates.radius_meters !== undefined
        ? Math.round(Number(updates.radius_meters))
        : current.radius_meters;
    const window_start =
      updates.window_start !== undefined
        ? String(updates.window_start).trim()
        : current.window_start;
    const window_end =
      updates.window_end !== undefined
        ? String(updates.window_end).trim()
        : current.window_end;

    let workDaysArray = current.work_days;
    if (updates.work_days !== undefined) {
      if (Array.isArray(updates.work_days)) {
        workDaysArray = updates.work_days.map(Number);
      } else if (typeof updates.work_days === 'string') {
        workDaysArray = updates.work_days
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((s) => s !== '');
      }
    }
    const work_days_str = workDaysArray.join(',');
    const updated_at = new Date().toISOString();

    const updateStmt = db.prepare(`
      UPDATE settings
      SET work_name = ?,
          work_latitude = ?,
          work_longitude = ?,
          radius_meters = ?,
          window_start = ?,
          window_end = ?,
          work_days = ?,
          updated_at = ?
      WHERE id = 1
    `);

    updateStmt.run(
      work_name,
      work_latitude,
      work_longitude,
      radius_meters,
      window_start,
      window_end,
      work_days_str,
      updated_at
    );

    return getSettings();
  }

  function getAttendanceByDate(date) {
    return getByDateStmt.get(date) || null;
  }

  function getRecentAttendance(limit = 7) {
    return getRecentStmt.all(limit);
  }

  function getMonthlyAttendance(month) {
    return getMonthlyStmt.all(`${month}-%`);
  }

  /**
   * Logs a check-in. By default, idempotent per calendar day: if an entry already exists
   * for `date` and `overwrite` is not true, returns the existing record with `already_existed: true`.
   */
  function recordCheckIn({
    date,
    checkInTime,
    status,
    triggerType = 'GEOFENCE',
    latitude = null,
    longitude = null,
    notes = null,
    overwrite = false,
  }) {
    const existing = getAttendanceByDate(date);
    if (existing && !overwrite) {
      return {
        record: existing,
        already_existed: true,
      };
    }

    if (overwrite) {
      upsertCheckInStmt.run(
        date,
        checkInTime,
        status,
        triggerType,
        latitude,
        longitude,
        notes
      );
    } else {
      insertCheckInStmt.run(
        date,
        checkInTime,
        status,
        triggerType,
        latitude,
        longitude,
        notes
      );
    }

    return {
      record: getAttendanceByDate(date),
      already_existed: false,
    };
  }

  function close() {
    db.close();
  }

  return {
    db,
    getSettings,
    updateSettings,
    getAttendanceByDate,
    getRecentAttendance,
    getMonthlyAttendance,
    recordCheckIn,
    close,
  };
}

module.exports = {
  createDatabase,
};
