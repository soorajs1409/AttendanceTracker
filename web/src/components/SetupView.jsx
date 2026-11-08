import React, { useEffect, useState } from 'react';
import {
  MapPin,
  Server,
  Clock,
  CheckCircle2,
  Eye,
  EyeOff,
  ArrowRight,
  Sun,
  Moon,
} from 'lucide-react';
import LocationMapPicker from './LocationMapPicker';
import {
  getConnectionConfig,
  saveConnectionConfig,
  saveSettings,
  fetchStatus,
  setSetupCompleted,
} from '../api';

const DAYS_OF_WEEK = [
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
  { id: 0, label: 'Sun' },
];

export default function SetupView({ theme, onToggleTheme, initialSettings, onComplete }) {
  const conn = getConnectionConfig();
  const [serverUrl, setServerUrl] = useState(conn.serverUrl || '');
  const [apiKey, setApiKey] = useState(conn.apiKey || 'my_super_secret_key_123');
  const [showKey, setShowKey] = useState(false);
  const [testingConn, setTestingConn] = useState(false);
  const [connMsg, setConnMsg] = useState(null);

  const [workName, setWorkName] = useState(
    initialSettings?.work_name || 'Office'
  );
  const [latitude, setLatitude] = useState(
    initialSettings?.work_latitude && Number(initialSettings.work_latitude) !== 0
      ? initialSettings.work_latitude
      : 12.900752
  );
  const [longitude, setLongitude] = useState(
    initialSettings?.work_longitude && Number(initialSettings.work_longitude) !== 0
      ? initialSettings.work_longitude
      : 77.69444
  );
  const [radiusMeters, setRadiusMeters] = useState(
    initialSettings?.radius_meters || 100
  );
  const [windowStart, setWindowStart] = useState(
    initialSettings?.window_start || '09:00'
  );
  const [windowEnd, setWindowEnd] = useState(
    initialSettings?.window_end || '10:00'
  );
  const [workDays, setWorkDays] = useState(
    initialSettings?.work_days || [1, 2, 3, 4, 5]
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchStatus()
      .then((data) => {
        if (data?.settings) {
          const s = data.settings;
          if (s.work_name) setWorkName(s.work_name);
          if (Number(s.work_latitude) !== 0) setLatitude(s.work_latitude);
          if (Number(s.work_longitude) !== 0) setLongitude(s.work_longitude);
          if (s.radius_meters) setRadiusMeters(s.radius_meters);
          if (s.window_start) setWindowStart(s.window_start);
          if (s.window_end) setWindowEnd(s.window_end);
          if (Array.isArray(s.work_days) && s.work_days.length > 0) {
            setWorkDays(s.work_days);
          }
        }
      })
      .catch(() => {
        // Ignore if server URL is not yet configured
      });
  }, []);

  function toggleWorkDay(dayId) {
    setWorkDays((prev) =>
      prev.includes(dayId)
        ? prev.filter((d) => d !== dayId)
        : [...prev, dayId].sort((a, b) => a - b)
    );
  }

  async function handleTestConnection() {
    setTestingConn(true);
    setConnMsg(null);
    try {
      const data = await fetchStatus({
        overrideServerUrl: serverUrl,
        overrideApiKey: apiKey,
      });
      setConnMsg({
        type: 'success',
        text: `Connected (${data?.settings?.work_name || 'Server Online'})`,
      });
      if (data?.settings) {
        const s = data.settings;
        if (s.work_name) setWorkName(s.work_name);
        if (Number(s.work_latitude) !== 0) setLatitude(s.work_latitude);
        if (Number(s.work_longitude) !== 0) setLongitude(s.work_longitude);
        if (s.radius_meters) setRadiusMeters(s.radius_meters);
        if (s.window_start) setWindowStart(s.window_start);
        if (s.window_end) setWindowEnd(s.window_end);
      }
    } catch (err) {
      setConnMsg({
        type: 'error',
        text: `Connection failed: ${err.message || 'Unable to reach server'}`,
      });
    } finally {
      setTestingConn(false);
    }
  }

  async function handleCompleteSetup(e) {
    e.preventDefault();
    setError(null);

    const latNum = Number(latitude);
    const lngNum = Number(longitude);
    if (
      Number.isNaN(latNum) ||
      Number.isNaN(lngNum) ||
      (latNum === 0 && lngNum === 0)
    ) {
      setError('Please enter valid workplace Latitude and Longitude.');
      return;
    }

    setSaving(true);
    try {
      saveConnectionConfig({ serverUrl, apiKey });
      await saveSettings({
        work_name: workName.trim() || 'Office',
        work_latitude: latNum,
        work_longitude: lngNum,
        radius_meters: Number(radiusMeters),
        window_start: windowStart,
        window_end: windowEnd,
        work_days: workDays,
      });
      setSetupCompleted(true);
      if (onComplete) {
        onComplete();
      }
    } catch (err) {
      setError(
        `Setup failed: ${err.message || 'Unable to save settings to server'}. Check Server URL and API Key.`
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 px-4 py-8 sm:py-12 transition-colors">
      <div className="mx-auto max-w-2xl space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 sm:p-6">
          <div>
            <span className="inline-block rounded bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300 mb-2">
              Initial Setup
            </span>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Configure Server & Workplace
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Configure your server connection and office coordinates to begin tracking attendance.
            </p>
          </div>
          {onToggleTheme && (
            <button
              type="button"
              onClick={onToggleTheme}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
            >
              {theme === 'dark' ? (
                <Sun className="h-3.5 w-3.5 text-amber-400" />
              ) : (
                <Moon className="h-3.5 w-3.5 text-zinc-600" />
              )}
            </button>
          )}
        </div>

        <form onSubmit={handleCompleteSetup} className="space-y-5">
          {/* 1. Server URL & API Key */}
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  1. Server Connection
                </h2>
              </div>
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testingConn}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-60"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>{testingConn ? 'Testing...' : 'Test Connection'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Server URL
                </label>
                <input
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="Leave blank for same origin or http://IP:3000"
                  className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:border-zinc-900 dark:focus:border-zinc-400 focus:bg-white dark:focus:bg-zinc-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  API Key
                </label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="my_super_secret_key_123"
                    className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 pl-3 pr-9 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:border-zinc-900 dark:focus:border-zinc-400 focus:bg-white dark:focus:bg-zinc-900 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                  >
                    {showKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {connMsg && (
              <div
                className={`rounded-md px-3.5 py-2 text-xs font-medium border ${
                  connMsg.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/60'
                    : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/60'
                }`}
              >
                {connMsg.text}
              </div>
            )}
          </div>

          {/* 2. Workplace Coordinates (Lat / Long) & Map */}
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <MapPin className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                2. Workplace Coordinates (Lat & Long)
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Workplace Name
                </label>
                <input
                  type="text"
                  value={workName}
                  onChange={(e) => setWorkName(e.target.value)}
                  placeholder="Office"
                  className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:border-zinc-900 dark:focus:border-zinc-400 focus:bg-white dark:focus:bg-zinc-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Latitude
                </label>
                <input
                  type="number"
                  step="any"
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  required
                  className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 tabular-nums focus:border-zinc-900 dark:focus:border-zinc-400 focus:bg-white dark:focus:bg-zinc-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Longitude
                </label>
                <input
                  type="number"
                  step="any"
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  required
                  className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 tabular-nums focus:border-zinc-900 dark:focus:border-zinc-400 focus:bg-white dark:focus:bg-zinc-900 focus:outline-none"
                />
              </div>
            </div>

            <LocationMapPicker
              latitude={Number(latitude)}
              longitude={Number(longitude)}
              radiusMeters={Number(radiusMeters)}
              onChangeCoords={(lat, lng) => {
                setLatitude(lat);
                setLongitude(lng);
              }}
            />

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Geofence Radius: {radiusMeters}m
              </span>
              <div className="flex gap-1.5">
                {[50, 100, 150, 250, 500].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRadiusMeters(r)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium border transition ${
                      Number(radiusMeters) === r
                        ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100'
                        : 'bg-zinc-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {r}m
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 3. Arrival Window */}
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <Clock className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                3. Arrival Window & Workdays
              </h2>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Window Start
                </label>
                <input
                  type="time"
                  value={windowStart}
                  onChange={(e) => setWindowStart(e.target.value)}
                  className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:border-zinc-900 dark:focus:border-zinc-400 focus:bg-white dark:focus:bg-zinc-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Window End (Cutoff)
                </label>
                <input
                  type="time"
                  value={windowEnd}
                  onChange={(e) => setWindowEnd(e.target.value)}
                  className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:border-zinc-900 dark:focus:border-zinc-400 focus:bg-white dark:focus:bg-zinc-900 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                Working Days
              </label>
              <div className="flex flex-wrap gap-2">
                {DAYS_OF_WEEK.map((d) => {
                  const active = workDays.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => toggleWorkDay(d.id)}
                      className={`rounded-md px-3.5 py-1.5 text-xs font-medium border transition ${
                        active
                          ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100'
                          : 'bg-zinc-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-xs font-medium text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-zinc-900 dark:bg-zinc-100 py-3 text-sm font-medium text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-60 transition"
          >
            <span>{saving ? 'Saving Setup...' : 'Complete Setup & Continue'}</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
