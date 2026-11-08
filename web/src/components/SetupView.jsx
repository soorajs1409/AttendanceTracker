import React, { useEffect, useState } from 'react';
import {
  MapPin,
  Server,
  Clock,
  CheckCircle2,
  Eye,
  EyeOff,
  ArrowRight,
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

export default function SetupView({ initialSettings, onComplete }) {
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
    // Load existing server settings if reachable
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
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-2xl space-y-5">
        {/* Minimal Header */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs">
          <span className="inline-block rounded-md bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-700 mb-2">
            Initial Setup
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Configure Server & Workplace
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Set your server connection and office coordinates (Latitude & Longitude) to start tracking attendance.
          </p>
        </div>

        <form onSubmit={handleCompleteSetup} className="space-y-5">
          {/* 1. Server URL & API Key */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <Server className="h-4 w-4 text-slate-700" />
                <h2 className="text-sm font-semibold text-slate-900">
                  1. Server Connection
                </h2>
              </div>
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testingConn}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                <span>{testingConn ? 'Testing...' : 'Test Connection'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Server URL
                </label>
                <input
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="Leave blank for same origin or http://IP:3000"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  API Key
                </label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="my_super_secret_key_123"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-3 pr-9 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
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

            {connMsg && (
              <div
                className={`rounded-lg px-3.5 py-2 text-xs font-medium ${
                  connMsg.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border border-rose-200'
                }`}
              >
                {connMsg.text}
              </div>
            )}
          </div>

          {/* 2. Workplace Coordinates (Lat / Long) & Map */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
              <MapPin className="h-4 w-4 text-slate-700" />
              <h2 className="text-sm font-semibold text-slate-900">
                2. Workplace Coordinates (Lat & Long)
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Workplace Name
                </label>
                <input
                  type="text"
                  value={workName}
                  onChange={(e) => setWorkName(e.target.value)}
                  placeholder="Office"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Latitude
                </label>
                <input
                  type="number"
                  step="any"
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:bg-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Longitude
                </label>
                <input
                  type="number"
                  step="any"
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:bg-white focus:outline-none"
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

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs font-medium text-slate-700">
                Geofence Radius: {radiusMeters}m
              </span>
              <div className="flex gap-1.5">
                {[50, 100, 150, 250, 500].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRadiusMeters(r)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium border transition ${
                      Number(radiusMeters) === r
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {r}m
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 3. Arrival Window */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
              <Clock className="h-4 w-4 text-slate-700" />
              <h2 className="text-sm font-semibold text-slate-900">
                3. Arrival Window & Workdays
              </h2>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Window Start
                </label>
                <input
                  type="time"
                  value={windowStart}
                  onChange={(e) => setWindowStart(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Window End (Cutoff)
                </label>
                <input
                  type="time"
                  value={windowEnd}
                  onChange={(e) => setWindowEnd(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-2">
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
                      className={`rounded-lg px-3.5 py-1.5 text-xs font-medium border transition ${
                        active
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
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
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 transition"
          >
            <span>{saving ? 'Saving Setup...' : 'Complete Setup & Continue'}</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
