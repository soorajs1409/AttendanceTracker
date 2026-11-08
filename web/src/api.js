const STORAGE_URL_KEY = 'attendance_server_url';
const STORAGE_API_KEY = 'attendance_api_key';
const STORAGE_AUTH_USER_KEY = 'attendance_auth_user';
const STORAGE_LOCAL_CRED_KEY = 'attendance_local_creds';
const STORAGE_SETUP_DONE_KEY = 'attendance_setup_completed';
const STORAGE_THEME_KEY = 'attendance_theme';

export function getInitialTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    if (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    ) {
      return 'dark';
    }
  } catch {
    // ignore
  }
  return 'light';
}

export function applyTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  try {
    localStorage.setItem(STORAGE_THEME_KEY, next);
  } catch {
    // ignore
  }
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', next === 'dark');
  }
  return next;
}

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

export function getAuthUser() {
  const raw = localStorage.getItem(STORAGE_AUTH_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setAuthUser(user) {
  if (!user) {
    localStorage.removeItem(STORAGE_AUTH_USER_KEY);
    return;
  }
  localStorage.setItem(STORAGE_AUTH_USER_KEY, JSON.stringify(user));
}

export function logoutUser() {
  localStorage.removeItem(STORAGE_AUTH_USER_KEY);
}

export function isSetupCompleted() {
  return localStorage.getItem(STORAGE_SETUP_DONE_KEY) === 'true';
}

export function setSetupCompleted(completed = true) {
  if (completed) {
    localStorage.setItem(STORAGE_SETUP_DONE_KEY, 'true');
  } else {
    localStorage.removeItem(STORAGE_SETUP_DONE_KEY);
  }
}

function getLocalFallbackCreds() {
  const raw = localStorage.getItem(STORAGE_LOCAL_CRED_KEY);
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

function saveLocalFallbackCreds({ username, password }) {
  const current = getLocalFallbackCreds();
  localStorage.setItem(
    STORAGE_LOCAL_CRED_KEY,
    JSON.stringify({
      username: username ? String(username).trim() : current.username,
      password: password ? String(password) : current.password,
    })
  );
}

async function apiRequest(path, options = {}) {
  const { serverUrl, apiKey } = getConnectionConfig();
  const baseUrl =
    options.overrideServerUrl !== undefined
      ? String(options.overrideServerUrl).trim().replace(/\/+$/, '')
      : serverUrl;
  const effectiveKey =
    options.overrideApiKey !== undefined
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

export async function loginUser({ username, password }) {
  const cleanUser = String(username || '').trim();
  const cleanPass = String(password ?? '');

  try {
    const res = await apiRequest('/api/login', {
      method: 'POST',
      body: { username: cleanUser, password: cleanPass },
    });
    const userObj = res?.user || { username: cleanUser };
    saveLocalFallbackCreds({ username: userObj.username, password: cleanPass });
    setAuthUser(userObj);
    return { user: userObj, settings: res?.settings || null };
  } catch (err) {
    if (err.status === 401) {
      throw new Error('Invalid username or password');
    }
    const fallback = getLocalFallbackCreds();
    if (cleanUser === fallback.username && cleanPass === fallback.password) {
      const userObj = { username: cleanUser };
      setAuthUser(userObj);
      return { user: userObj, settings: null, offlineFallback: true };
    }
    throw new Error('Invalid username or password');
  }
}

export function fetchProfile() {
  return apiRequest('/api/profile');
}

export async function updateProfile({ username, password }) {
  const res = await apiRequest('/api/profile', {
    method: 'PUT',
    body: {
      ...(username !== undefined ? { username } : {}),
      ...(password ? { password } : {}),
    },
  });
  if (res?.user) {
    setAuthUser(res.user);
    saveLocalFallbackCreds({
      username: res.user.username,
      ...(password ? { password } : {}),
    });
  }
  return res;
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

export function importAttendanceFile({ filename, contentBase64, csvText, mode = 'merge' }) {
  return apiRequest('/api/import', {
    method: 'POST',
    body: {
      filename,
      mode,
      ...(contentBase64 ? { content_base64: contentBase64 } : {}),
      ...(csvText ? { csv_text: csvText } : {}),
    },
  });
}

export async function downloadAttendanceExcel({ month, year } = {}) {
  const { serverUrl, apiKey } = getConnectionConfig();
  const baseUrl = String(serverUrl || '').trim().replace(/\/+$/, '');
  const params = new URLSearchParams();
  if (month) params.set('month', month);
  else if (year) params.set('year', year);

  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`${baseUrl}/api/export${query}`, {
    method: 'GET',
    headers: {
      ...(apiKey ? { 'X-API-Key': apiKey } : {}),
    },
  });

  if (!response.ok) {
    let msg = `Export failed with status ${response.status}`;
    try {
      const errData = await response.json();
      if (errData?.error) msg = errData.error;
    } catch {
      // ignore non-json error
    }
    throw new Error(msg);
  }

  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const fnMatch = disposition.match(/filename="?([^"]+)"?/i);
  const filename = fnMatch
    ? fnMatch[1]
    : `Shift_Attendance_${month || year || 'all'}.xlsx`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return filename;
}

/**
 * Formats 'HH:MM:SS' or 'HH:MM' into concise 24h HH:MM or 12h format.
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

export function formatTime24h(timeStr) {
  if (!timeStr) return '—';
  return String(timeStr).slice(0, 5);
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
