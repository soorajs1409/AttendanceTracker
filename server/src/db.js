const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

/**
 * One-time migration for databases created before the WFO/WFH/LEAVE model.
 * Migrates old statuses:
 * - 'PRESENT' -> 'WFO'
 * - 'ABSENT' -> 'WFH'
 * - 'LATE' -> 'WFH'
 * - 'MANUAL' -> 'WFO'
 */
function migrateLegacyAttendanceTable(db) {
  const row = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'attendance_log'"
    )
    .get();
  if (!row) return;
  const sql = String(row.sql);
  if (
    !sql.includes("'PRESENT'") &&
    !sql.includes("'ABSENT'") &&
    !sql.includes("'LATE'")
  ) {
    return;
  }

  db.exec(`
    BEGIN;
    CREATE TABLE attendance_log_new (
      date TEXT PRIMARY KEY,
      check_in_time TEXT,
      status TEXT NOT NULL CHECK(status IN ('WFO', 'WFH', 'LEAVE')),
      trigger_type TEXT DEFAULT 'GEOFENCE',
      latitude REAL,
      longitude REAL,
      notes TEXT
    );
    INSERT INTO attendance_log_new (
      date, check_in_time, status, trigger_type, latitude, longitude, notes
    )
    SELECT
      date,
      check_in_time,
      CASE status
        WHEN 'PRESENT' THEN 'WFO'
        WHEN 'ABSENT' THEN 'WFH'
        WHEN 'LATE' THEN 'WFH'
        WHEN 'MANUAL' THEN 'WFO'
        WHEN 'WFO' THEN 'WFO'
        WHEN 'WFH' THEN 'WFH'
        WHEN 'LEAVE' THEN 'LEAVE'
        ELSE 'WFH'
      END,
      trigger_type, latitude, longitude, notes
    FROM attendance_log;
    DROP TABLE attendance_log;
    ALTER TABLE attendance_log_new RENAME TO attendance_log;
    COMMIT;
  `);
}

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
      check_in_time TEXT,
      status TEXT NOT NULL CHECK(status IN ('WFO', 'WFH', 'LEAVE')),
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

  migrateLegacyAttendanceTable(db);

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

  // Fills in an arrival on a day that was auto-marked WFH before the arrival reached the server
  const updateAutoWfhStmt = db.prepare(`
    UPDATE attendance_log
    SET check_in_time = ?, status = ?, trigger_type = ?, latitude = ?, longitude = ?,
        notes = COALESCE(?, notes)
    WHERE date = ? AND trigger_type = 'AUTO'
  `);

  // Explicit user choice from the calendar; keeps any previously logged arrival time
  const upsertManualStmt = db.prepare(`
    INSERT INTO attendance_log (date, check_in_time, status, trigger_type, notes)
    VALUES (?, ?, ?, 'MANUAL', ?)
    ON CONFLICT(date) DO UPDATE SET
      check_in_time = COALESCE(excluded.check_in_time, attendance_log.check_in_time),
      status = excluded.status,
      trigger_type = 'MANUAL',
      notes = excluded.notes
  `);

  const insertAutoWfhStmt = db.prepare(`
    INSERT OR IGNORE INTO attendance_log (date, check_in_time, status, trigger_type, notes)
    VALUES (?, NULL, 'WFH', 'AUTO', 'Target window closed without workplace arrival')
  `);

  const deleteByDateStmt = db.prepare(`
    DELETE FROM attendance_log WHERE date = ?
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
   * Logs an arrival (geofence entry or manual check-in). Idempotent per calendar day:
   * - No record yet            -> insert with the computed status.
   * - Auto-marked ABSENT       -> fill in the arrival (e.g. an offline-queued arrival that
   *                               happened inside the window is upgraded to PRESENT).
   * - Any other existing record -> left untouched (first arrival / explicit user choice wins).
   */
  function recordCheckIn({
    date,
    checkInTime,
    status,
    triggerType = 'GEOFENCE',
    latitude = null,
    longitude = null,
    notes = null,
  }) {
    const existing = getAttendanceByDate(date);

    if (!existing) {
      insertCheckInStmt.run(
        date,
        checkInTime,
        status,
        triggerType,
        latitude,
        longitude,
        notes
      );
      return { record: getAttendanceByDate(date), already_existed: false };
    }

    if (existing.trigger_type === 'AUTO') {
      updateAutoWfhStmt.run(
        checkInTime,
        status,
        triggerType,
        latitude,
        longitude,
        notes,
        date
      );
      return { record: getAttendanceByDate(date), already_existed: false };
    }

    return { record: existing, already_existed: true };
  }

  /**
   * Explicitly marks a day WFO, WFH, or LEAVE from the calendar.
   */
  function setDayStatus({ date, status, checkInTime = null, notes = null }) {
    upsertManualStmt.run(date, checkInTime, status, notes);
    return getAttendanceByDate(date);
  }

  /**
   * Removes any mark for a day so it shows as unmarked again.
   */
  function clearDay(date) {
    const result = deleteByDateStmt.run(date);
    return result.changes > 0;
  }

  /**
   * Auto-marks a day WFH only if nothing is recorded for it yet.
   * Note: LEAVE is NEVER auto-selected. It can only be set manually.
   * @returns {boolean} true if a new WFH record was created
   */
  function markWfhIfMissing(date) {
    const result = insertAutoWfhStmt.run(date);
    return result.changes > 0;
  }

  function markAbsentIfMissing(date) {
    return markWfhIfMissing(date);
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
    setDayStatus,
    clearDay,
    markWfhIfMissing,
    markAbsentIfMissing,
    close,
  };
}

module.exports = {
  createDatabase,
};
