const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

/**
 * Migrates databases created with older attendance_log schemas:
 * - Converts legacy statuses ('PRESENT' -> 'WFO', 'ABSENT'/'LATE' -> 'WFH', 'MANUAL' -> 'WFO')
 * - Adds check_out_time, nsa, on_call, remarks columns and allows nullable status for weekend On-Call / CR logs.
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
    sql.includes('check_out_time') &&
    sql.includes('on_call') &&
    sql.includes('remarks') &&
    sql.includes('status IS NULL') &&
    !sql.includes("'PRESENT'") &&
    !sql.includes("'ABSENT'") &&
    !sql.includes("'LATE'")
  ) {
    return;
  }

  const colInfo = db.prepare('PRAGMA table_info(attendance_log)').all();
  const colNames = new Set(colInfo.map((c) => c.name));

  const checkOutExpr = colNames.has('check_out_time') ? 'check_out_time' : 'NULL';
  const nsaExpr = colNames.has('nsa') ? 'COALESCE(nsa, 0)' : '0';
  const onCallExpr = colNames.has('on_call') ? 'COALESCE(on_call, 0)' : '0';
  const remarksExpr = colNames.has('remarks') ? 'remarks' : 'NULL';

  db.exec(`
    BEGIN;
    CREATE TABLE attendance_log_new (
      date TEXT PRIMARY KEY,
      check_in_time TEXT,
      check_out_time TEXT,
      status TEXT CHECK(status IS NULL OR status IN ('WFO', 'WFH', 'LEAVE', 'HOLIDAY')),
      nsa INTEGER NOT NULL DEFAULT 0,
      on_call INTEGER NOT NULL DEFAULT 0,
      trigger_type TEXT DEFAULT 'GEOFENCE',
      latitude REAL,
      longitude REAL,
      notes TEXT,
      remarks TEXT
    );
    INSERT INTO attendance_log_new (
      date, check_in_time, check_out_time, status, nsa, on_call, trigger_type, latitude, longitude, notes, remarks
    )
    SELECT
      date,
      check_in_time,
      ${checkOutExpr},
      CASE status
        WHEN 'PRESENT' THEN 'WFO'
        WHEN 'ABSENT' THEN 'WFH'
        WHEN 'LATE' THEN 'WFH'
        WHEN 'MANUAL' THEN 'WFO'
        WHEN 'WFO' THEN 'WFO'
        WHEN 'WFH' THEN 'WFH'
        WHEN 'LEAVE' THEN 'LEAVE'
        WHEN 'HOLIDAY' THEN 'HOLIDAY'
        ELSE NULL
      END,
      ${nsaExpr},
      ${onCallExpr},
      trigger_type,
      latitude,
      longitude,
      notes,
      ${remarksExpr}
    FROM attendance_log;
    DROP TABLE attendance_log;
    ALTER TABLE attendance_log_new RENAME TO attendance_log;
    COMMIT;
  `);
}

/**
 * Initializes the SQLite database with settings, attendance_log, holidays_ref, and user_account tables.
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
      check_out_time TEXT,
      status TEXT CHECK(status IS NULL OR status IN ('WFO', 'WFH', 'LEAVE', 'HOLIDAY')),
      nsa INTEGER NOT NULL DEFAULT 0,
      on_call INTEGER NOT NULL DEFAULT 0,
      trigger_type TEXT DEFAULT 'GEOFENCE',
      latitude REAL,
      longitude REAL,
      notes TEXT,
      remarks TEXT
    );

    CREATE TABLE IF NOT EXISTS holidays_ref (
      date TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_account (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL DEFAULT 'sunil',
      password TEXT NOT NULL DEFAULT 'test',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    INSERT OR IGNORE INTO settings (
      id, work_name, work_latitude, work_longitude, radius_meters, window_start, window_end, work_days
    ) VALUES (
      1, 'Office', 0.0, 0.0, 100, '09:00', '10:00', '1,2,3,4,5'
    );

    INSERT OR IGNORE INTO user_account (
      id, username, password
    ) VALUES (
      1, 'sunil', 'test'
    );
  `);

  migrateLegacyAttendanceTable(db);

  const SELECT_COLS = `
    date, check_in_time, check_out_time, status, nsa, on_call,
    trigger_type, latitude, longitude, notes, remarks
  `;

  const getSettingsStmt = db.prepare(`
    SELECT id, work_name, work_latitude, work_longitude, radius_meters,
           window_start, window_end, work_days, updated_at
    FROM settings
    WHERE id = 1
  `);

  const getUserStmt = db.prepare(`
    SELECT id, username, password, updated_at
    FROM user_account
    WHERE id = 1
  `);

  const updateUserStmt = db.prepare(`
    UPDATE user_account
    SET username = ?,
        password = ?,
        updated_at = ?
    WHERE id = 1
  `);

  const getByDateStmt = db.prepare(`
    SELECT ${SELECT_COLS}
    FROM attendance_log
    WHERE date = ?
  `);

  const getRecentStmt = db.prepare(`
    SELECT ${SELECT_COLS}
    FROM attendance_log
    ORDER BY date DESC
    LIMIT ?
  `);

  const getMonthlyStmt = db.prepare(`
    SELECT ${SELECT_COLS}
    FROM attendance_log
    WHERE date LIKE ?
    ORDER BY date ASC
  `);

  const getAllStmt = db.prepare(`
    SELECT ${SELECT_COLS}
    FROM attendance_log
    ORDER BY date ASC
  `);

  const getAvailableMonthsStmt = db.prepare(`
    SELECT DISTINCT substr(date, 1, 7) AS month
    FROM attendance_log
    WHERE length(date) >= 7
    ORDER BY month ASC
  `);

  const getHolidaysRefStmt = db.prepare(`
    SELECT date, name
    FROM holidays_ref
    ORDER BY date ASC
  `);

  const upsertHolidayRefStmt = db.prepare(`
    INSERT INTO holidays_ref (date, name)
    VALUES (?, ?)
    ON CONFLICT(date) DO UPDATE SET
      name = excluded.name
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

  // Explicit user choice from the calendar or table editor
  const upsertManualStmt = db.prepare(`
    INSERT INTO attendance_log (
      date, check_in_time, check_out_time, status, nsa, on_call, trigger_type, notes, remarks
    )
    VALUES (?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      check_in_time = ?,
      check_out_time = ?,
      status = excluded.status,
      nsa = excluded.nsa,
      on_call = excluded.on_call,
      trigger_type = 'MANUAL',
      notes = excluded.notes,
      remarks = excluded.remarks
  `);

  const upsertImportStmt = db.prepare(`
    INSERT INTO attendance_log (
      date, check_in_time, check_out_time, status, nsa, on_call, trigger_type, notes, remarks
    )
    VALUES (?, ?, ?, ?, ?, ?, 'IMPORT', ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      check_in_time = excluded.check_in_time,
      check_out_time = excluded.check_out_time,
      status = excluded.status,
      nsa = excluded.nsa,
      on_call = excluded.on_call,
      trigger_type = 'IMPORT',
      notes = excluded.notes,
      remarks = excluded.remarks
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

  function getUser() {
    const row = getUserStmt.get();
    if (!row) return { username: 'sunil', updated_at: null };
    return {
      username: row.username,
      updated_at: row.updated_at,
    };
  }

  function verifyCredentials(username, password) {
    const row = getUserStmt.get();
    if (!row) return false;
    return (
      String(username || '').trim() === row.username &&
      String(password ?? '') === row.password
    );
  }

  function updateUser(updates = {}) {
    const row = getUserStmt.get();
    const nextUsername =
      updates.username !== undefined && String(updates.username).trim()
        ? String(updates.username).trim()
        : row.username;
    const nextPassword =
      updates.password !== undefined && String(updates.password) !== ''
        ? String(updates.password)
        : row.password;
    const updated_at = new Date().toISOString();

    updateUserStmt.run(nextUsername, nextPassword, updated_at);
    return getUser();
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

  function getAllAttendance(prefix = null) {
    if (prefix) {
      return getMonthlyStmt.all(`${prefix}%`);
    }
    return getAllStmt.all();
  }

  function getAvailableMonths() {
    return getAvailableMonthsStmt.all().map((r) => r.month);
  }

  function getHolidaysRef() {
    return getHolidaysRefStmt.all();
  }

  /**
   * Logs an arrival (geofence entry or manual check-in). Idempotent per calendar day:
   * - No record yet            -> insert with the computed status.
   * - Auto-marked WFH          -> fill in the arrival (e.g. an offline-queued arrival that
   *                               happened inside the window is upgraded to WFO).
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
   * Explicitly marks or updates a day (status, login/logout times, NSA, On Call, notes, remarks).
   */
  function setDayStatus({
    date,
    status,
    checkInTime = undefined,
    checkOutTime = undefined,
    nsa = undefined,
    onCall = undefined,
    notes = undefined,
    remarks = undefined,
  }) {
    const existing = getAttendanceByDate(date);

    const nextCheckIn =
      checkInTime !== undefined
        ? checkInTime
        : existing?.check_in_time ?? null;
    const nextCheckOut =
      checkOutTime !== undefined
        ? checkOutTime
        : existing?.check_out_time ?? null;
    const nextNsa =
      nsa !== undefined ? (nsa ? 1 : 0) : existing?.nsa ?? 0;
    const nextOnCall =
      onCall !== undefined ? (onCall ? 1 : 0) : existing?.on_call ?? 0;
    const nextNotes =
      notes !== undefined ? notes : existing?.notes ?? null;
    const nextRemarks =
      remarks !== undefined ? remarks : existing?.remarks ?? null;

    upsertManualStmt.run(
      date,
      nextCheckIn,
      nextCheckOut,
      status,
      nextNsa,
      nextOnCall,
      nextNotes,
      nextRemarks,
      nextCheckIn,
      nextCheckOut
    );
    return getAttendanceByDate(date);
  }

  /**
   * Bulk imports scraped spreadsheet records and holiday references inside a single transaction.
   */
  function importSpreadsheetData({
    records = [],
    holidays = [],
    replaceAll = false,
  }) {
    db.exec('BEGIN');
    try {
      if (replaceAll) {
        db.exec('DELETE FROM attendance_log; DELETE FROM holidays_ref;');
      }

      for (const h of holidays) {
        if (h.date && h.name) {
          upsertHolidayRefStmt.run(h.date, h.name);
        }
      }

      for (const rec of records) {
        upsertImportStmt.run(
          rec.date,
          rec.check_in_time || null,
          rec.check_out_time || null,
          rec.status || null,
          rec.nsa ? 1 : 0,
          rec.on_call ? 1 : 0,
          rec.notes || null,
          rec.remarks || null
        );
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    return {
      imported_records: records.length,
      imported_holidays: holidays.length,
    };
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
    getUser,
    verifyCredentials,
    updateUser,
    getAttendanceByDate,
    getRecentAttendance,
    getMonthlyAttendance,
    getAllAttendance,
    getAvailableMonths,
    getHolidaysRef,
    recordCheckIn,
    setDayStatus,
    importSpreadsheetData,
    clearDay,
    markWfhIfMissing,
    markAbsentIfMissing,
    close,
  };
}

module.exports = {
  createDatabase,
};
