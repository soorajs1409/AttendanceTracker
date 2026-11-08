import React, { useEffect, useState } from 'react';
import {
  MapPin,
  Clock,
  Server,
  Save,
  CheckCircle2,
  Eye,
  EyeOff,
} from 'lucide-react';
import LocationMapPicker from './LocationMapPicker';
import {
  getConnectionConfig,
  saveConnectionConfig,
  saveSettings,
  fetchStatus,
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

export default function SettingsView({ statusData, onRefreshStatus }) {
  const initialSettings = statusData?.settings || {};

  const [workName, setWorkName] = useState(
    initialSettings.work_name || 'Office'
  );
  const [latitude, setLatitude] = useState(
    initialSettings.work_latitude ?? 0
  );
  const [longitude, setLongitude] = useState(
    initialSettings.work_longitude ?? 0
  );
  const [radiusMeters, setRadiusMeters] = useState(
    initialSettings.radius_meters ?? 100
  );
  const [windowStart, setWindowStart] = useState(
    initialSettings.window_start || '09:00'
  );
  const [windowEnd, setWindowEnd] = useState(
    initialSettings.window_end || '10:00'
  );
  const [workDays, setWorkDays] = useState(
    initialSettings.work_days || [1, 2, 3, 4, 5]
  );

  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState(null);

  const conn = getConnectionConfig();
  const [serverUrl, setServerUrl] = useState(conn.serverUrl);
  const [apiKey, setApiKey] = useState(conn.apiKey);
  const [showKey, setShowKey] = useState(false);
  const [testingConn, setTestingConn] = useState(false);
  const [connMsg, setConnMsg] = useState(null);

  useEffect(() => {
    if (!statusData?.settings) return;
    const s = statusData.settings;
    setWorkName(s.work_name || 'Office');
    setLatitude(s.work_latitude ?? 0);
    setLongitude(s.work_longitude ?? 0);
    setRadiusMeters(s.radius_meters ?? 100);
    setWindowStart(s.window_start || '09:00');
    setWindowEnd(s.window_end || '10:00');
    setWorkDays(s.work_days || [1, 2, 3, 4, 5]);
  }, [statusData]);

  function toggleWorkDay(dayId) {
    setWorkDays((prev) =>
      prev.includes(dayId)
        ? prev.filter((d) => d !== dayId)
        : [...prev, dayId].sort((a, b) => a - b)
    );
  }

  async function handleSaveWorkplaceAndSchedule(e) {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsMsg(null);
    try {
      await saveSettings({
        work_name: workName.trim() || 'Office',
        work_latitude: Number(latitude),
        work_longitude: Number(longitude),
        radius_meters: Number(radiusMeters),
        window_start: windowStart,
        window_end: windowEnd,
        work_days: workDays,
      });
      setSettingsMsg({
        type: 'success',
        text: 'Workplace destination and arrival window saved.',
      });
      if (onRefreshStatus) await onRefreshStatus();
    } catch (err) {
      setSettingsMsg({
        type: 'error',
        text: err.message || 'Failed to save settings.',
      });
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleSaveConnection(e) {
    e.preventDefault();
    setTestingConn(true);
    setConnMsg(null);
    try {
      await fetchStatus({
        overrideServerUrl: serverUrl,
        overrideApiKey: apiKey,
      });
      saveConnectionConfig({ serverUrl, apiKey });
      setConnMsg({
        type: 'success',
        text: 'Connected to Attendance Server and saved credentials.',
      });
      if (onRefreshStatus) await onRefreshStatus();
    } catch (err) {
      saveConnectionConfig({ serverUrl, apiKey });
      setConnMsg({
        type: 'error',
        text: `Saved locally, but connection check failed: ${err.message}`,
      });
    } finally {
      setTestingConn(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Workplace Geofence & Schedule Form */}
      <form
        onSubmit={handleSaveWorkplaceAndSchedule}
        className="space-y-6 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 sm:p-6"
      >
        <div className="flex items-center gap-3 border-b border-zinc-100 dark:border-zinc-800 pb-4">
          <MapPin className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Work Destination & Geofence
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Drop a pin at your workplace and configure arrival radius
            </p>
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              Workplace Label
            </label>
            <input
              type="text"
              value={workName}
              onChange={(e) => setWorkName(e.target.value)}
              placeholder="e.g., Office HQ"
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
              className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 tabular-nums focus:border-zinc-900 dark:focus:border-zinc-400 focus:bg-white dark:focus:bg-zinc-900 focus:outline-none"
            />
          </div>
        </div>

        {/* Geofence Radius */}
        <div className="rounded-md bg-zinc-50 dark:bg-zinc-950/60 p-4 border border-zinc-200/80 dark:border-zinc-800">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Geofence Radius
            </label>
            <span className="rounded bg-zinc-900 dark:bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-white dark:text-zinc-900 tabular-nums">
              {radiusMeters} meters
            </span>
          </div>
          <input
            type="range"
            min={50}
            max={500}
            step={10}
            value={radiusMeters}
            onChange={(e) => setRadiusMeters(Number(e.target.value))}
            className="w-full accent-zinc-900 dark:accent-zinc-100 cursor-pointer"
          />
          <div className="flex justify-between text-[11px] text-zinc-400 dark:text-zinc-500 mt-1">
            <span>50m (Tight)</span>
            <span>150m (Recommended)</span>
            <span>500m (Wide Campus)</span>
          </div>
        </div>

        {/* Daily Arrival Window & Workdays */}
        <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Daily Arrival Window & Active Workdays
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Window Start Time
              </label>
              <input
                type="time"
                value={windowStart}
                onChange={(e) => setWindowStart(e.target.value)}
                required
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 focus:border-zinc-900 dark:focus:border-zinc-400 focus:bg-white dark:focus:bg-zinc-900 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                On-Time Cutoff (Window End)
              </label>
              <input
                type="time"
                value={windowEnd}
                onChange={(e) => setWindowEnd(e.target.value)}
                required
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 focus:border-zinc-900 dark:focus:border-zinc-400 focus:bg-white dark:focus:bg-zinc-900 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              Active Workdays
            </label>
            <div className="flex flex-wrap gap-2">
              {DAYS_OF_WEEK.map((day) => {
                const active = workDays.includes(day.id);
                return (
                  <button
                    key={day.id}
                    type="button"
                    onClick={() => toggleWorkDay(day.id)}
                    className={`rounded-md px-3.5 py-1.5 text-xs font-medium border transition ${
                      active
                        ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100'
                        : 'bg-zinc-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
          {settingsMsg ? (
            <p
              className={`text-xs font-medium rounded-md px-3.5 py-2 border ${
                settingsMsg.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/60'
                  : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/60'
              }`}
            >
              {settingsMsg.text}
            </p>
          ) : (
            <span />
          )}

          <button
            type="submit"
            disabled={savingSettings}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-zinc-900 dark:bg-zinc-100 px-4 py-2 text-xs font-medium text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-60 transition"
          >
            <Save className="h-3.5 w-3.5" />
            <span>
              {savingSettings ? 'Saving...' : 'Save Location & Schedule'}
            </span>
          </button>
        </div>
      </form>

      {/* Centralized Server Connection Card */}
      <form
        onSubmit={handleSaveConnection}
        className="space-y-4 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 sm:p-6"
      >
        <div className="flex items-center gap-3 border-b border-zinc-100 dark:border-zinc-800 pb-4">
          <Server className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Server Connection
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Configure your self-hosted server URL and X-API-Key
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              Server Base URL
            </label>
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="Same origin (or https://attendance.example.com)"
              className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:border-zinc-900 dark:focus:border-zinc-400 focus:bg-white dark:focus:bg-zinc-900 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              Pre-Shared API Key (X-API-Key)
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="my_super_secret_key_123"
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 pl-3 pr-10 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:border-zinc-900 dark:focus:border-zinc-400 focus:bg-white dark:focus:bg-zinc-900 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
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

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
          {connMsg ? (
            <p
              className={`text-xs font-medium rounded-md px-3.5 py-2 border ${
                connMsg.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/60'
                  : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/60'
              }`}
            >
              {connMsg.text}
            </p>
          ) : (
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              Stored locally in browser storage.
            </span>
          )}

          <button
            type="submit"
            disabled={testingConn}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-60 transition"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>
              {testingConn ? 'Testing...' : 'Save & Test Connection'}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
}
