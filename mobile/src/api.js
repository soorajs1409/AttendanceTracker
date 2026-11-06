const memoryStore = new Map();
const fallbackMemoryStorage = {
  getItem: async (k) => (memoryStore.has(k) ? memoryStore.get(k) : null),
  setItem: async (k, v) => {
    memoryStore.set(k, String(v));
  },
  removeItem: async (k) => {
    memoryStore.delete(k);
  },
};

function getDefaultStorage() {
  try {
    const mod = require('@react-native-async-storage/async-storage');
    const resolved = mod?.default || mod;
    if (resolved && typeof resolved.getItem === 'function') {
      return resolved;
    }
  } catch {
    // Fallback to in-memory storage in Node test environments
  }
  return fallbackMemoryStorage;
}

const STORAGE_URL_KEY = 'attendance_mobile_server_url';
const STORAGE_API_KEY = 'attendance_mobile_api_key';
const STORAGE_PENDING_QUEUE_KEY = 'attendance_mobile_pending_checkins';
const STORAGE_LAST_SETTINGS_KEY = 'attendance_mobile_cached_settings';
const STORAGE_ONBOARDING_KEY = 'attendance_mobile_onboarding_completed';
const STORAGE_AUTH_USER_KEY = 'attendance_mobile_auth_user';
const STORAGE_LOCAL_CRED_KEY = 'attendance_mobile_local_creds';

const DEFAULT_SERVER_URL = 'http://localhost:3000';
const DEFAULT_API_KEY = 'my_super_secret_key_123';

async function getAuthUser(storage = getDefaultStorage()) {
  const raw = await storage.getItem(STORAGE_AUTH_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function setAuthUser(user, storage = getDefaultStorage()) {
  if (!user) {
    await storage.removeItem(STORAGE_AUTH_USER_KEY);
    return;
  }
  await storage.setItem(STORAGE_AUTH_USER_KEY, JSON.stringify(user));
}

async function logoutUser(storage = getDefaultStorage()) {
  await storage.removeItem(STORAGE_AUTH_USER_KEY);
}

async function getLocalFallbackCreds(storage = getDefaultStorage()) {
  const raw = await storage.getItem(STORAGE_LOCAL_CRED_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.username && parsed?.password) return parsed;
    } catch {
      // fall through
    }
  }
  return { username: 'sunil', password: 'test' };
}

async function saveLocalFallbackCreds(
  { username, password },
  storage = getDefaultStorage()
) {
  const current = await getLocalFallbackCreds(storage);
  await storage.setItem(
    STORAGE_LOCAL_CRED_KEY,
    JSON.stringify({
      username: username ? String(username).trim() : current.username,
      password: password ? String(password) : current.password,
    })
  );
}

async function isOnboardingCompleted(storage = getDefaultStorage()) {
  const val = await storage.getItem(STORAGE_ONBOARDING_KEY);
  return val === 'true';
}

async function setOnboardingCompleted(
  completed = true,
  storage = getDefaultStorage()
) {
  await storage.setItem(STORAGE_ONBOARDING_KEY, completed ? 'true' : 'false');
}

async function resetOnboarding(storage = getDefaultStorage()) {
  await storage.removeItem(STORAGE_ONBOARDING_KEY);
}

async function getConnectionConfig(storage = getDefaultStorage()) {
  const [savedUrl, savedKey] = await Promise.all([
    storage.getItem(STORAGE_URL_KEY),
    storage.getItem(STORAGE_API_KEY),
  ]);
  return {
    serverUrl:
      savedUrl !== null && savedUrl !== undefined
        ? savedUrl
        : DEFAULT_SERVER_URL,
    apiKey:
      savedKey !== null && savedKey !== undefined ? savedKey : DEFAULT_API_KEY,
  };
}

async function saveConnectionConfig(
  { serverUrl, apiKey },
  storage = getDefaultStorage()
) {
  const normalizedUrl = String(serverUrl || '')
    .trim()
    .replace(/\/+$/, '');
  const normalizedKey = String(apiKey || '').trim();
  await Promise.all([
    storage.setItem(STORAGE_URL_KEY, normalizedUrl),
    storage.setItem(STORAGE_API_KEY, normalizedKey),
  ]);
  return { serverUrl: normalizedUrl, apiKey: normalizedKey };
}

async function cacheWorkplaceSettings(settings, storage = getDefaultStorage()) {
  if (!settings) return;
  await storage.setItem(STORAGE_LAST_SETTINGS_KEY, JSON.stringify(settings));
}

async function getCachedWorkplaceSettings(storage = getDefaultStorage()) {
  const raw = await storage.getItem(STORAGE_LAST_SETTINGS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function apiRequest(path, options = {}, deps = {}) {
  const storage = deps.storage || getDefaultStorage();
  const fetchImpl = deps.fetchImpl || fetch;

  const conn = await getConnectionConfig(storage);
  const baseUrl =
    options.overrideServerUrl !== undefined
      ? String(options.overrideServerUrl).trim().replace(/\/+$/, '')
      : conn.serverUrl;
  const effectiveKey =
    options.overrideApiKey !== undefined
      ? String(options.overrideApiKey).trim()
      : conn.apiKey;

  if (!baseUrl) {
    throw new Error('Server URL is not configured. Set it in Settings.');
  }

  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(effectiveKey ? { 'X-API-Key': effectiveKey } : {}),
    ...(options.headers || {}),
  };

  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers?.get?.('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : null;

  if (!response.ok) {
    const err = new Error(
      data?.error || `Request failed with status ${response.status}`
    );
    err.status = response.status;
    throw err;
  }

  return data;
}

async function fetchStatus(overrides = {}, deps = {}) {
  const data = await apiRequest('/api/status', overrides, deps);
  if (data?.settings) {
    await cacheWorkplaceSettings(data.settings, deps.storage);
  }
  return data;
}

async function loginUser({ username, password }, deps = {}) {
  const storage = deps.storage || getDefaultStorage();
  const cleanUser = String(username || '').trim();
  const cleanPass = String(password ?? '');

  try {
    const res = await apiRequest(
      '/api/login',
      {
        method: 'POST',
        body: { username: cleanUser, password: cleanPass },
      },
      deps
    );
    const userObj = res?.user || { username: cleanUser };
    await saveLocalFallbackCreds(
      { username: userObj.username, password: cleanPass },
      storage
    );
    await setAuthUser(userObj, storage);
    if (res?.settings) {
      await cacheWorkplaceSettings(res.settings, storage);
    }
    return { user: userObj, settings: res?.settings || null };
  } catch (err) {
    if (err.status === 401) {
      throw new Error('Invalid username or password');
    }
    // Before initial setup, if server URL is not yet reachable, verify against local/default credentials (sunil / test)
    const fallback = await getLocalFallbackCreds(storage);
    if (cleanUser === fallback.username && cleanPass === fallback.password) {
      const userObj = { username: cleanUser };
      await setAuthUser(userObj, storage);
      return { user: userObj, settings: null, offlineFallback: true };
    }
    throw new Error('Invalid username or password');
  }
}

async function fetchProfile(deps = {}) {
  return apiRequest('/api/profile', {}, deps);
}

async function updateProfile({ username, password }, deps = {}) {
  const storage = deps.storage || getDefaultStorage();
  const res = await apiRequest(
    '/api/profile',
    {
      method: 'PUT',
      body: {
        ...(username !== undefined ? { username } : {}),
        ...(password ? { password } : {}),
      },
    },
    deps
  );
  if (res?.user) {
    await setAuthUser(res.user, storage);
    await saveLocalFallbackCreds(
      {
        username: res.user.username,
        ...(password ? { password } : {}),
      },
      storage
    );
  }
  return res;
}

async function submitCheckIn(payload, deps = {}) {
  return apiRequest(
    '/api/checkin',
    {
      method: 'POST',
      body: payload,
    },
    deps
  );
}

async function fetchHistory(month, deps = {}) {
  const query = month ? `?month=${encodeURIComponent(month)}` : '';
  return apiRequest(`/api/history${query}`, {}, deps);
}

async function saveSettings(settings, deps = {}) {
  const res = await apiRequest(
    '/api/settings',
    {
      method: 'POST',
      body: settings,
    },
    deps
  );
  if (res?.settings) {
    await cacheWorkplaceSettings(res.settings, deps.storage);
  }
  return res;
}

async function setDayAttendance(date, payload, deps = {}) {
  return apiRequest(
    `/api/attendance/${encodeURIComponent(date)}`,
    {
      method: 'PUT',
      body: payload,
    },
    deps
  );
}

/**
 * Offline Check-In Retry Queue:
 * Stores check-in payloads locally if network is unreachable when entering geofence,
 * preserving the exact arrival date & time for idempotent replay.
 */
async function getPendingCheckIns(storage = getDefaultStorage()) {
  const raw = await storage.getItem(STORAGE_PENDING_QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function enqueuePendingCheckIn(item, storage = getDefaultStorage()) {
  const list = await getPendingCheckIns(storage);
  // Deduplicate by calendar date so only the earliest arrival for a day is queued
  if (!list.some((existing) => existing.date === item.date)) {
    list.push({
      ...item,
      queued_at: new Date().toISOString(),
    });
    await storage.setItem(STORAGE_PENDING_QUEUE_KEY, JSON.stringify(list));
  }
  return list;
}

async function flushPendingCheckIns(deps = {}) {
  const storage = deps.storage || getDefaultStorage();
  const list = await getPendingCheckIns(storage);
  if (list.length === 0) {
    return { flushed: 0, remaining: 0 };
  }

  const remaining = [];
  let flushed = 0;

  for (const item of list) {
    try {
      await submitCheckIn(
        {
          date: item.date,
          time: item.time,
          latitude: item.latitude,
          longitude: item.longitude,
          trigger: item.trigger || 'GEOFENCE',
          notes: item.notes || 'Synced from offline geofence queue',
        },
        deps
      );
      flushed += 1;
    } catch {
      remaining.push(item);
    }
  }

  await storage.setItem(STORAGE_PENDING_QUEUE_KEY, JSON.stringify(remaining));
  return { flushed, remaining: remaining.length };
}

function formatTime12h(timeStr) {
  if (!timeStr) return '—';
  const parts = String(timeStr).split(':');
  if (parts.length < 2) return timeStr;
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1];
  if (Number.isNaN(hours)) return timeStr;
  const period = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${String(hours).padStart(2, '0')}:${minutes} ${period}`;
}

function formatDateReadable(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dateObj = new Date(y, m - 1, d);
  return dateObj.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

module.exports = {
  DEFAULT_SERVER_URL,
  DEFAULT_API_KEY,
  getConnectionConfig,
  saveConnectionConfig,
  cacheWorkplaceSettings,
  getCachedWorkplaceSettings,
  fetchStatus,
  loginUser,
  fetchProfile,
  updateProfile,
  getAuthUser,
  setAuthUser,
  logoutUser,
  submitCheckIn,
  fetchHistory,
  saveSettings,
  setDayAttendance,
  isOnboardingCompleted,
  setOnboardingCompleted,
  resetOnboarding,
  getPendingCheckIns,
  enqueuePendingCheckIn,
  flushPendingCheckIns,
  formatTime12h,
  formatDateReadable,
};
