const STORAGE_URL_KEY = 'attendance_server_url';
const STORAGE_API_KEY = 'attendance_api_key';

export function getConnectionConfig() {
  return {
    serverUrl: localStorage.getItem(STORAGE_URL_KEY) ?? '',
    apiKey: localStorage.getItem(STORAGE_API_KEY) ?? 'my_super_secret_key_123',
  };
}

export function saveConnectionConfig({ serverUrl, apiKey }) {
  const normalizedUrl = String(serverUrl || '').trim().replace(/\/+$/, '');
  localStorage.setItem(STORAGE_URL_KEY, normalizedUrl);
  localStorage.setItem(STORAGE_API_KEY, String(apiKey || '').trim());
}

async function apiRequest(path, options = {}) {
  const { serverUrl, apiKey } = getConnectionConfig();
  const baseUrl = options.overrideServerUrl !== undefined
    ? String(options.overrideServerUrl).trim().replace(/\/+$/, '')
    : serverUrl;
  const effectiveKey = options.overrideApiKey !== undefined
    ? String(options.overrideApiKey).trim()
    : apiKey;

  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(effectiveKey ? { 'X-API-Key': effectiveKey } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const isJson = response.headers
    .get('content-type')
    ?.includes('application/json');
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    const err = new Error(
      data?.error || `Request failed with status ${response.status}`
    );
    err.status = response.status;
    throw err;
  }

  return data;
}

export function checkHealth(overrideServerUrl) {
  return apiRequest('/api/health', { overrideServerUrl });
}

export function fetchStatus(overrides = {}) {
  return apiRequest('/api/status', overrides);
}

export function submitCheckIn(payload) {
  return apiRequest('/api/checkin', {
    method: 'POST',
    body: payload,
  });
}

export function fetchHistory(month) {
  const query = month ? `?month=${encodeURIComponent(month)}` : '';
  return apiRequest(`/api/history${query}`);
}

export function saveSettings(settings) {
  return apiRequest('/api/settings', {
    method: 'POST',
    body: settings,
  });
}

export function setDayAttendance(date, payload) {
  return apiRequest(`/api/attendance/${encodeURIComponent(date)}`, {
    method: 'PUT',
    body: payload,
  });
}

/**
 * Formats 'HH:MM:SS' or 'HH:MM' into friendly 12-hour format (e.g. '09:14 AM').
 */
export function formatTime12h(timeStr) {
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

/**
 * Formats 'YYYY-MM-DD' into readable date (e.g. 'Thu, Nov 5, 2026').
 */
export function formatDateReadable(dateStr) {
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
