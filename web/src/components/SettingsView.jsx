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

  // Connection settings stored in browser localStorage
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
        text: 'Workplace destination and arrival window saved!',
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
        text: 'Connected to Attendance Server and saved credentials!',
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
        className="space-y-6 rounded-2xl bg-white border border-slate-200/80 p-5 sm:p-6 shadow-sm"
      >
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600">
            <MapPin className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Work Destination & Geofence
            </h2>
            <p className="text-xs text-slate-500">
              Drop a pin at your workplace and adjust the arrival detection radius
            </p>
          </div>
        </div>

        {/* Interactive Leaflet Map */}
        <LocationMapPicker
          latitude={Number(latitude)}
          longitude={Number(longitude)}
          radiusMeters={Number(radiusMeters)}
          onChangeCoords={(lat, lng) => {
            setLatitude(lat);
            setLongitude(lng);
          }}
        />

        {/* Workplace Name + Exact Coordinates */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Workplace Label
            </label>
            <input
              type="text"
              value={workName}
              onChange={(e) => setWorkName(e.target.value)}
              placeholder="e.g., Office HQ"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Latitude
            </label>
            <input
              type="number"
              step="any"
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Longitude
            </label>
            <input
              type="number"
              step="any"
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none"
            />
          </div>
        </div>

        {/* Geofence Radius Slider */}
        <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-slate-700">
              Geofence Radius
            </label>
            <span className="rounded-lg bg-indigo-600 px-2.5 py-0.5 text-xs font-bold text-white">
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
            className="w-full accent-indigo-600 cursor-pointer"
          />
          <div className="flex justify-between text-[11px] text-slate-400 mt-1">
            <span>50m (Tight)</span>
            <span>150m (Recommended)</span>
            <span>500m (Wide Campus)</span>
          </div>
        </div>

        {/* Daily Arrival Window & Workdays */}
        <div className="pt-2 border-t border-slate-100">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="h-4 w-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Daily Arrival Window & Active Workdays
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Window Start Time
              </label>
              <input
                type="time"
                value={windowStart}
                onChange={(e) => setWindowStart(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                On-Time Cutoff (Window End)
              </label>
              <input
                type="time"
                value={windowEnd}
                onChange={(e) => setWindowEnd(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
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
                    className={`rounded-xl px-4 py-2 text-xs font-semibold border transition ${
                      active
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
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
              className={`text-xs font-medium rounded-xl px-3.5 py-2 ${
                settingsMsg.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border border-rose-200'
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
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60 transition"
          >
            <Save className="h-4 w-4" />
            <span>
              {savingSettings ? 'Saving...' : 'Save Location & Schedule'}
            </span>
          </button>
        </div>
      </form>

      {/* Centralized Server Connection Card */}
      <form
        onSubmit={handleSaveConnection}
        className="space-y-4 rounded-2xl bg-white border border-slate-200/80 p-5 sm:p-6 shadow-sm"
      >
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <div className="rounded-xl bg-slate-100 p-2.5 text-slate-700">
            <Server className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Server Connection
            </h2>
            <p className="text-xs text-slate-500">
              Configure your self-hosted server URL and pre-shared X-API-Key
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Server Base URL
            </label>
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="Same origin (or https://attendance.example.com)"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Pre-Shared API Key (X-API-Key)
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="my_super_secret_key_123"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-3 pr-10 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
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
              className={`text-xs font-medium rounded-xl px-3.5 py-2 ${
                connMsg.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}
            >
              {connMsg.text}
            </p>
          ) : (
            <span className="text-xs text-slate-400">
              Stored locally in your browser so you never need to sign in.
            </span>
          )}

          <button
            type="submit"
            disabled={testingConn}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60 transition"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>
              {testingConn ? 'Testing...' : 'Save & Test Connection'}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
}
