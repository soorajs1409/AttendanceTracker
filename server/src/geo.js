/**
 * Geospatial and time-window helper utilities for Attendance Tracker.
 */

const EARTH_RADIUS_METERS = 6371000;

/**
 * Calculates great-circle distance in meters between two WGS84 coordinates
 * using the Haversine formula.
 *
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Distance in meters (rounded to 1 decimal place)
 */
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
 * Extracts local date ('YYYY-MM-DD'), time ('HH:MM:SS'), shortTime ('HH:MM'),
 * and dayOfWeek (0 = Sunday ... 6 = Saturday) for a given Date and IANA timezone.
 *
 * @param {string} [timezone='Asia/Kolkata']
 * @param {Date} [now=new Date()]
 */
function getLocalDateTime(timezone = 'Asia/Kolkata', now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const map = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }

  // Handle midnight '24' edge case in some Intl implementations
  const hour = map.hour === '24' ? '00' : map.hour;
  const date = `${map.year}-${map.month}-${map.day}`;
  const time = `${hour}:${map.minute}:${map.second}`;
  const shortTime = `${hour}:${map.minute}`;

  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dayOfWeek = weekdayMap[map.weekday] ?? now.getDay();

  return {
    date,
    time,
    shortTime,
    dayOfWeek,
    iso: now.toISOString(),
  };
}

/**
 * A day has exactly two possible states: 'PRESENT' or 'ABSENT'.
 * The arrival time is only used to decide whether the destination was reached
 * by the end of the arrival window.
 *
 * @param {object} params
 * @param {string} params.shortTime - Arrival time 'HH:MM' in 24h format
 * @param {string} params.windowEnd - Window end 'HH:MM' in 24h format
 * @returns {'PRESENT' | 'ABSENT'}
 */
function evaluateAttendanceStatus({ shortTime, windowEnd }) {
  // Lexicographical comparison works directly on zero-padded 'HH:MM' 24-hour strings
  return shortTime <= windowEnd ? 'PRESENT' : 'ABSENT';
}

module.exports = {
  calculateDistanceMeters,
  getLocalDateTime,
  evaluateAttendanceStatus,
};
