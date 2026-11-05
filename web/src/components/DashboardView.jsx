import React, { useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Coffee,
  MapPin,
  Navigation,
  RefreshCw,
  AlertCircle,
  CalendarCheck,
} from 'lucide-react';
import { submitCheckIn, formatTime12h, formatDateReadable } from '../api';

function StatusBadge({ status }) {
  const styles = {
    PRESENT: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    LATE: 'bg-amber-100 text-amber-800 border-amber-200',
    MANUAL: 'bg-sky-100 text-sky-800 border-sky-200',
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
        styles[status] || 'bg-slate-100 text-slate-700 border-slate-200'
      }`}
    >
      {status}
    </span>
  );
}

export default function DashboardView({
  statusData,
  loading,
  onRefresh,
  onNavigateSettings,
}) {
  const [note, setNote] = useState('');
  const [checkingIn, setCheckingIn] = useState(false);
  const [feedback, setFeedback] = useState(null);

  if (loading && !statusData) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-44 rounded-2xl bg-slate-200" />
        <div className="h-32 rounded-2xl bg-slate-200" />
        <div className="h-56 rounded-2xl bg-slate-200" />
      </div>
    );
  }

  const today = statusData?.today || {};
  const settings = statusData?.settings || {};
  const recent = (statusData?.recent || []).slice(0, 5);

  const isLocationConfigured =
    settings.work_latitude !== 0 || settings.work_longitude !== 0;

  async function handleManualCheckIn(e) {
    e.preventDefault();
    setCheckingIn(true);
    setFeedback(null);

    let coords = {};
    if ('geolocation' in navigator) {
      try {
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 3500,
            maximumAge: 30000,
          });
        });
        coords = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        };
      } catch {
        // Proceed without coordinates if browser location permission is denied or times out
      }
    }

    try {
      const res = await submitCheckIn({
        ...coords,
        trigger: 'MANUAL',
        notes: note.trim() || undefined,
      });

      setFeedback({
        type: 'success',
        message: res.already_existed
          ? `Already checked in today at ${formatTime12h(res.time)} (${res.status}).`
          : `Checked in at ${formatTime12h(res.time)} — marked ${res.status}!`,
      });
      setNote('');
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to check in.',
      });
    } finally {
      setCheckingIn(false);
    }
  }

  // Determine Banner Visual State
  let bannerClasses =
    'bg-gradient-to-br from-indigo-600 to-blue-700 text-white shadow-indigo-200';
  let BannerIcon = Clock;
  let bannerTitle = 'Awaiting Arrival';
  let bannerSubtitle = `Target Window: ${formatTime12h(
    settings.window_start
  )} – ${formatTime12h(settings.window_end)}`;

  if (today.checked_in) {
    if (today.status === 'LATE') {
      bannerClasses =
        'bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-amber-200';
      BannerIcon = Clock;
      bannerTitle = `Marked Late at ${formatTime12h(today.check_in_time)}`;
      bannerSubtitle = `Logged via ${today.trigger_type || 'GEOFENCE'} • ${
        settings.work_name || 'Office'
      }`;
    } else {
      bannerClasses =
        'bg-gradient-to-br from-emerald-600 to-teal-700 text-white shadow-emerald-200';
      BannerIcon = CheckCircle2;
      bannerTitle = `Marked Present at ${formatTime12h(today.check_in_time)}`;
      bannerSubtitle = `Logged via ${today.trigger_type || 'GEOFENCE'} • ${
        settings.work_name || 'Office'
      }`;
    }
  } else if (!today.is_work_day) {
    bannerClasses =
      'bg-gradient-to-br from-slate-600 to-slate-800 text-white shadow-slate-200';
    BannerIcon = Coffee;
    bannerTitle = 'Non-Working Day';
    bannerSubtitle = 'Enjoy your day off! Automatic window resumes next workday.';
  }

  return (
    <div className="space-y-6">
      {/* Unconfigured Destination Callout */}
      {!isLocationConfigured && (
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold">Work destination not configured yet</p>
              <p className="text-amber-800 mt-0.5">
                Drop a pin on the map in Settings so geofence check-ins know where your workplace is.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onNavigateSettings}
            className="shrink-0 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-700 transition"
          >
            Set Location
          </button>
        </div>
      )}

      {/* Big Today Status Banner */}
      <div
        className={`relative overflow-hidden rounded-3xl p-6 sm:p-8 shadow-lg transition-all ${bannerClasses}`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-xs font-medium backdrop-blur-sm">
              <span>{formatDateReadable(today.date)}</span>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <BannerIcon className="h-9 w-9 shrink-0" />
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                {bannerTitle}
              </h2>
            </div>
            <p className="text-sm sm:text-base text-white/90">{bannerSubtitle}</p>
            {today.notes && (
              <p className="text-xs bg-black/15 inline-block rounded-lg px-2.5 py-1 mt-1">
                Note: {today.notes}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onRefresh}
            title="Refresh status"
            className="self-start sm:self-center inline-flex items-center gap-1.5 rounded-xl bg-white/15 hover:bg-white/25 px-3.5 py-2 text-xs font-medium backdrop-blur-sm transition"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Refresh</span>
          </button>
        </div>

        {/* Workplace Pill Bar */}
        <div className="mt-6 pt-4 border-t border-white/20 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-white/85">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" />
            {settings.work_name || 'Office'}{' '}
            {isLocationConfigured
              ? `(${settings.radius_meters}m radius)`
              : '(Coordinates not set)'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            Window: {formatTime12h(settings.window_start)} –{' '}
            {formatTime12h(settings.window_end)}
          </span>
        </div>
      </div>

      {/* Quick Manual Check-In Card */}
      <div className="rounded-2xl bg-white border border-slate-200/80 p-5 sm:p-6 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Quick Manual Check-In
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Use this if your phone battery died or indoor GPS missed the boundary.
            </p>
          </div>
        </div>

        <form
          onSubmit={handleManualCheckIn}
          className="flex flex-col sm:flex-row gap-3 mt-4"
        >
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note (e.g., Underground parking, forgot phone)"
            disabled={today.checked_in || checkingIn}
            className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={today.checked_in || checkingIn}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none transition"
          >
            <Navigation className="h-4 w-4" />
            {checkingIn
              ? 'Checking In...'
              : today.checked_in
                ? 'Checked In Today'
                : 'Manual Check In'}
          </button>
        </form>

        {feedback && (
          <div
            className={`mt-3 rounded-xl px-3.5 py-2.5 text-xs font-medium ${
              feedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            {feedback.message}
          </div>
        )}
      </div>

      {/* Recent 5 Logs Summary */}
      <div className="rounded-2xl bg-white border border-slate-200/80 p-5 sm:p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <CalendarCheck className="h-5 w-5 text-indigo-600" />
          <h3 className="text-base font-semibold text-slate-900">
            Recent Attendance
          </h3>
        </div>

        {recent.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">
            No check-ins recorded yet. Your arrivals will appear here automatically.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {recent.map((item) => (
              <div
                key={item.date}
                className="flex items-center justify-between py-3 first:pt-0 last:pb-0 gap-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">
                    {formatDateReadable(item.date)}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    Arrived at {formatTime12h(item.check_in_time)} •{' '}
                    <span className="uppercase">{item.trigger_type}</span>
                    {item.notes ? ` — "${item.notes}"` : ''}
                  </p>
                </div>
                <StatusBadge status={item.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
