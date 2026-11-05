const fs = require('node:fs');
const path = require('node:path');
const { createDatabase } = require('./db');
const { createApp } = require('./app');

// Load .env file if present
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envPath);
}

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.API_KEY || '';
const TIMEZONE = process.env.TIMEZONE || 'Asia/Kolkata';
const DB_PATH =
  process.env.DB_PATH || path.join(__dirname, '..', 'data', 'attendance.db');

const store = createDatabase(DB_PATH);
const server = createApp({
  store,
  apiKey: API_KEY,
  timezone: TIMEZONE,
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Attendance Tracker server listening on http://0.0.0.0:${PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
  console.log(`Timezone: ${TIMEZONE}`);
  console.log(
    `API Key protection: ${API_KEY ? 'ENABLED (X-API-Key header required)' : 'DISABLED (dev mode)'}`
  );
});

// Auto-mark today ABSENT once the arrival window closes without an arrival
function absenceTick() {
  try {
    const result = server.runAbsenceCheck();
    if (result.marked) {
      console.log(`Marked ${result.date} ABSENT (no arrival by window end)`);
    }
  } catch (err) {
    console.error('Absence check failed:', err);
  }
}
absenceTick();
const absenceTimer = setInterval(absenceTick, 60 * 1000);

function shutdown(signal) {
  console.log(`\nReceived ${signal}. Closing server and SQLite database...`);
  clearInterval(absenceTimer);
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
