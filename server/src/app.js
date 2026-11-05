const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { Readable } = require('node:stream');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const {
  calculateDistanceMeters,
  getLocalDateTime,
  evaluateAttendanceStatus,
} = require('./geo');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Timing-safe string comparison for API Key verification.
 */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Helper to send JSON HTTP responses with CORS headers.
 */
function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
  });
  res.end(body);
}

/**
 * Parses JSON request body with a 64KB size limit.
 */
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 65536) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Creates the HTTP server instance bound to the given database store.
 *
 * @param {object} options
 * @param {ReturnType<import('./db').createDatabase>} options.store
 * @param {string} [options.apiKey]
 * @param {string} [options.timezone]
 * @param {() => Date} [options.clock] - Custom clock function for deterministic testing
 */
function createApp({
  store,
  apiKey = process.env.API_KEY || '',
  timezone = process.env.TIMEZONE || 'Asia/Kolkata',
  clock = () => new Date(),
  webDistDir = path.join(__dirname, '..', '..', 'web', 'dist'),
}) {
  const requestHandler = async (req, res) => {
    try {
      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
          'Access-Control-Max-Age': '86400',
        });
        res.end();
        return;
      }

      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = parsedUrl.pathname;

      // Serve static Web Portal assets & SPA fallback for non-/api GET routes
      if (
        req.method === 'GET' &&
        !pathname.startsWith('/api') &&
        webDistDir &&
        fs.existsSync(path.join(webDistDir, 'index.html'))
      ) {
        const relativeTarget =
          pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
        const candidatePath = path.resolve(webDistDir, relativeTarget);
        const rootResolved = path.resolve(webDistDir);

        // Guard against directory traversal
        if (candidatePath.startsWith(rootResolved)) {
          let fileToServe = candidatePath;
          if (
            !fs.existsSync(fileToServe) ||
            fs.statSync(fileToServe).isDirectory()
          ) {
            fileToServe = path.join(rootResolved, 'index.html');
          }
          const ext = path.extname(fileToServe).toLowerCase();
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';
          const content = fs.readFileSync(fileToServe);
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(content);
          return;
        }
      }

      // Public healthcheck route (no API key required for container health probes)
      if (req.method === 'GET' && pathname === '/api/health') {
        sendJson(res, 200, {
          status: 'ok',
          timestamp: clock().toISOString(),
        });
        return;
      }

      // API Key Verification (if configured)
      if (apiKey) {
        const headerKey =
          req.headers['x-api-key'] ||
          (req.headers.authorization?.startsWith('Bearer ')
            ? req.headers.authorization.slice(7).trim()
            : '');

        if (!safeCompare(String(headerKey || ''), apiKey)) {
          sendJson(res, 401, {
            error: 'Unauthorized: Invalid or missing X-API-Key header',
          });
          return;
        }
      }

      // 1. GET /api/status
      if (req.method === 'GET' && pathname === '/api/status') {
        const localNow = getLocalDateTime(timezone, clock());
        const settings = store.getSettings();
        const todayRecord = store.getAttendanceByDate(localNow.date);
        const recent = store.getRecentAttendance(7);
        const isWorkDay = settings.work_days.includes(localNow.dayOfWeek);

        sendJson(res, 200, {
          today: {
            date: localNow.date,
            current_time: localNow.time,
            is_work_day: isWorkDay,
            checked_in: Boolean(todayRecord),
            check_in_time: todayRecord ? todayRecord.check_in_time : null,
            status: todayRecord ? todayRecord.status : null,
            trigger_type: todayRecord ? todayRecord.trigger_type : null,
            notes: todayRecord ? todayRecord.notes : null,
          },
          settings,
          recent,
        });
        return;
      }

      // 2. POST /api/checkin
      if (req.method === 'POST' && pathname === '/api/checkin') {
        let body;
        try {
          body = await parseJsonBody(req);
        } catch (err) {
          sendJson(res, 400, { error: err.message });
          return;
        }

        const localNow = getLocalDateTime(timezone, clock());
        const settings = store.getSettings();

        const targetDate =
          body.date && DATE_REGEX.test(String(body.date))
            ? String(body.date)
            : localNow.date;
        const targetTime =
          body.time && /^\d{2}:\d{2}(:\d{2})?$/.test(String(body.time))
            ? String(body.time).length === 5
              ? `${body.time}:00`
              : String(body.time)
            : localNow.time;
        const shortTime = targetTime.slice(0, 5);

        const trigger =
          body.trigger && ['GEOFENCE', 'MANUAL'].includes(String(body.trigger).toUpperCase())
            ? String(body.trigger).toUpperCase()
            : 'GEOFENCE';

        const hasCoords =
          typeof body.latitude === 'number' &&
          typeof body.longitude === 'number' &&
          !Number.isNaN(body.latitude) &&
          !Number.isNaN(body.longitude);

        let distanceMeters = null;
        let withinGeofence = null;

        if (
          hasCoords &&
          (settings.work_latitude !== 0 || settings.work_longitude !== 0)
        ) {
          distanceMeters = calculateDistanceMeters(
            body.latitude,
            body.longitude,
            settings.work_latitude,
            settings.work_longitude
          );
          withinGeofence = distanceMeters <= settings.radius_meters;
        }

        const computedStatus = evaluateAttendanceStatus({
          shortTime,
          windowStart: settings.window_start,
          windowEnd: settings.window_end,
          statusOverride: body.status ? String(body.status).toUpperCase() : undefined,
        });

        const result = store.recordCheckIn({
          date: targetDate,
          checkInTime: targetTime,
          status: computedStatus,
          triggerType: trigger,
          latitude: hasCoords ? body.latitude : null,
          longitude: hasCoords ? body.longitude : null,
          notes: body.notes ? String(body.notes) : null,
          overwrite: Boolean(body.overwrite),
        });

        sendJson(res, result.already_existed ? 200 : 201, {
          success: true,
          already_existed: result.already_existed,
          date: result.record.date,
          time: result.record.check_in_time,
          status: result.record.status,
          trigger: result.record.trigger_type,
          distance_meters: distanceMeters,
          within_geofence: withinGeofence,
          record: result.record,
        });
        return;
      }

      // 3. GET /api/history?month=YYYY-MM
      if (req.method === 'GET' && pathname === '/api/history') {
        const localNow = getLocalDateTime(timezone, clock());
        const requestedMonth =
          parsedUrl.searchParams.get('month') || localNow.date.slice(0, 7);

        if (!MONTH_REGEX.test(requestedMonth)) {
          sendJson(res, 400, {
            error: 'Invalid month format. Expected YYYY-MM (e.g. 2026-11)',
          });
          return;
        }

        const records = store.getMonthlyAttendance(requestedMonth);
        const summary = {
          total: records.length,
          present: records.filter((r) => r.status === 'PRESENT').length,
          late: records.filter((r) => r.status === 'LATE').length,
          manual: records.filter((r) => r.status === 'MANUAL').length,
        };

        sendJson(res, 200, {
          month: requestedMonth,
          summary,
          records,
        });
        return;
      }

      // 4. POST /api/settings (or PUT /api/settings)
      if (
        (req.method === 'POST' || req.method === 'PUT') &&
        pathname === '/api/settings'
      ) {
        let body;
        try {
          body = await parseJsonBody(req);
        } catch (err) {
          sendJson(res, 400, { error: err.message });
          return;
        }

        if (body.work_latitude !== undefined) {
          const lat = Number(body.work_latitude);
          if (Number.isNaN(lat) || lat < -90 || lat > 90) {
            sendJson(res, 400, {
              error: 'work_latitude must be a valid number between -90 and 90',
            });
            return;
          }
        }

        if (body.work_longitude !== undefined) {
          const lng = Number(body.work_longitude);
          if (Number.isNaN(lng) || lng < -180 || lng > 180) {
            sendJson(res, 400, {
              error: 'work_longitude must be a valid number between -180 and 180',
            });
            return;
          }
        }

        if (body.radius_meters !== undefined) {
          const radius = Number(body.radius_meters);
          if (Number.isNaN(radius) || radius < 10 || radius > 5000) {
            sendJson(res, 400, {
              error: 'radius_meters must be between 10 and 5000 meters',
            });
            return;
          }
        }

        if (
          body.window_start !== undefined &&
          !TIME_REGEX.test(String(body.window_start))
        ) {
          sendJson(res, 400, {
            error: 'window_start must be in HH:MM (24-hour) format',
          });
          return;
        }

        if (
          body.window_end !== undefined &&
          !TIME_REGEX.test(String(body.window_end))
        ) {
          sendJson(res, 400, {
            error: 'window_end must be in HH:MM (24-hour) format',
          });
          return;
        }

        const updatedSettings = store.updateSettings(body);
        sendJson(res, 200, {
          success: true,
          settings: updatedSettings,
        });
        return;
      }

      // 404 Not Found
      sendJson(res, 404, {
        error: `Route ${req.method} ${pathname} not found`,
      });
    } catch (err) {
      console.error('Unhandled server error:', err);
      sendJson(res, 500, {
        error: 'Internal server error',
      });
    }
  };

  const server = http.createServer(requestHandler);

  /**
   * In-process HTTP request injection helper (similar to Fastify's server.inject)
   * so tests can execute without requiring OS TCP socket permissions.
   */
  server.inject = async ({
    method = 'GET',
    url = '/',
    headers = {},
    body = null,
  }) => {
    const normalizedHeaders = {};
    for (const [k, v] of Object.entries(headers)) {
      normalizedHeaders[k.toLowerCase()] = v;
    }

    const bodyBuffer =
      body === null || body === undefined
        ? Buffer.alloc(0)
        : typeof body === 'string'
          ? Buffer.from(body)
          : Buffer.from(JSON.stringify(body));

    const req = Readable.from(bodyBuffer.length ? [bodyBuffer] : []);
    req.method = method.toUpperCase();
    req.url = url;
    req.headers = { host: 'localhost', ...normalizedHeaders };

    return new Promise((resolve) => {
      let statusCode = 200;
      let resHeaders = {};
      const chunks = [];

      const res = {
        writeHead(code, hdrs = {}) {
          statusCode = code;
          resHeaders = { ...resHeaders, ...hdrs };
        },
        end(chunk) {
          if (chunk) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const rawBody = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: statusCode,
            headers: resHeaders,
            text: async () => rawBody,
            json: async () => (rawBody ? JSON.parse(rawBody) : null),
          });
        },
      };

      requestHandler(req, res);
    });
  };

  return server;
}

module.exports = {
  createApp,
};
