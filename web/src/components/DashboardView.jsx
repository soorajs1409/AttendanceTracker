import React, { useState, useEffect, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Building2,
  Home,
  CalendarOff,
  BarChart3,
  PieChart as PieChartIcon,
} from 'lucide-react';
import { fetchHistory, formatTime12h, formatDateReadable } from '../api';

function shiftMonth(monthStr, delta) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function StatusBadge({ status }) {
  if (status === 'WFO') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-200">
        WFO (Office)
      </span>
    );
  }
  if (status === 'WFH') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
        WFH (Home)
      </span>
    );
  }
  if (status === 'LEAVE') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-200">
        LEAVE
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-700">
      {status || 'UNMARKED'}
    </span>
  );
}

/**
 * Minimal SVG Pie/Donut Chart component.
 * Uses SVG strokeDasharray on concentric offset segments.
 */
function MinimalPieChart({ wfo, wfh, leave, total }) {
  if (!total || total === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center text-slate-400">
        <svg viewBox="0 0 100 100" className="w-40 h-40">
          <circle
            cx="50"
            cy="50"
            r="35"
            fill="none"
            stroke="#e2e8f0"
            strokeWidth="20"
          />
        </svg>
        <p className="mt-3 text-xs text-slate-500">No days logged for this month</p>
      </div>
    );
  }

  // Radius = 35 -> Circumference = 2 * PI * 35 ~ 219.91
  const r = 35;
  const circumference = 2 * Math.PI * r;

  const wfoLen = (wfo / total) * circumference;
  const wfhLen = (wfh / total) * circumference;
  const leaveLen = (leave / total) * circumference;

  const wfoOffset = 0;
  const wfhOffset = -wfoLen;
  const leaveOffset = -(wfoLen + wfhLen);

  const wfoPct = Math.round((wfo / total) * 100);
  const wfhPct = Math.round((wfh / total) * 100);
  const leavePct = Math.round((leave / total) * 100);

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6 justify-around p-4">
      {/* SVG Donut / Pie */}
      <div className="relative w-44 h-44 flex items-center justify-center shrink-0">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90 transform">
          {/* Background Track */}
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke="#f1f5f9"
            strokeWidth="22"
          />
          {/* WFO Segment (Blue) */}
          {wfo > 0 && (
            <circle
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke="#2563eb"
              strokeWidth="22"
              strokeDasharray={`${wfoLen} ${circumference}`}
              strokeDashoffset={wfoOffset}
            />
          )}
          {/* WFH Segment (Emerald) */}
          {wfh > 0 && (
            <circle
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke="#10b981"
              strokeWidth="22"
              strokeDasharray={`${wfhLen} ${circumference}`}
              strokeDashoffset={wfhOffset}
            />
          )}
          {/* Leave Segment (Rose) */}
          {leave > 0 && (
            <circle
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke="#f43f5e"
              strokeWidth="22"
              strokeDasharray={`${leaveLen} ${circumference}`}
              strokeDashoffset={leaveOffset}
            />
          )}
        </svg>

        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-bold text-slate-800">{total}</span>
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
            Tracked Days
          </span>
        </div>
      </div>

      {/* Legend & Breakdown */}
      <div className="space-y-3 w-full max-w-xs text-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded bg-blue-600 shrink-0" />
            <span className="font-medium text-slate-700">WFO (Office)</span>
          </div>
          <div className="text-right">
            <span className="font-bold text-slate-900">{wfo} days</span>
            <span className="text-xs text-slate-500 ml-1.5">({wfoPct}%)</span>
          </div>
        </div>

        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded bg-emerald-500 shrink-0" />
            <span className="font-medium text-slate-700">WFH (Home)</span>
          </div>
          <div className="text-right">
            <span className="font-bold text-slate-900">{wfh} days</span>
            <span className="text-xs text-slate-500 ml-1.5">({wfhPct}%)</span>
          </div>
        </div>

        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded bg-rose-500 shrink-0" />
            <span className="font-medium text-slate-700">Leave</span>
          </div>
          <div className="text-right">
            <span className="font-bold text-slate-900">{leave} days</span>
            <span className="text-xs text-slate-500 ml-1.5">({leavePct}%)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardView({ statusData }) {
  const todayDateStr =
    statusData?.today?.date || new Date().toISOString().slice(0, 10);
  const currentMonthStr = todayDateStr.slice(0, 7);

  const [month, setMonth] = useState(currentMonthStr);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [historyData, setHistoryData] = useState({
    summary: { total: 0, wfo: 0, wfh: 0, leave: 0, wfo_percent: 0, wfh_percent: 0, leave_percent: 0 },
    records: [],
  });

  const loadData = useCallback(async (targetMonth) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHistory(targetMonth);
      setHistoryData(data);
    } catch (err) {
      setError(err.message || 'Failed to load month statistics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(month);
  }, [month, loadData]);

  const summary = historyData?.summary || {
    total: 0,
    wfo: 0,
    wfh: 0,
    leave: 0,
    wfo_percent: 0,
    wfh_percent: 0,
    leave_percent: 0,
  };
  const records = historyData?.records || [];

  const total = summary.total || 0;
  const wfo = summary.wfo || 0;
  const wfh = summary.wfh || 0;
  const leave = summary.leave || 0;

  // Ratios and ratios formatted
  const wfoRatio = total > 0 ? (wfo / total).toFixed(2) : '0.00';
  const wfhRatio = total > 0 ? (wfh / total).toFixed(2) : '0.00';
  const leaveRatio = total > 0 ? (leave / total).toFixed(2) : '0.00';

  // WFO vs WFH ratio string
  const wfoToWfh = wfh > 0 ? (wfo / wfh).toFixed(2) : wfo > 0 ? `${wfo}:0` : '0:0';

  return (
    <div className="space-y-6">
      {/* Month Selector Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white border border-slate-200 rounded-xl p-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            {formatMonthLabel(month)} Statistics
          </h2>
          <p className="text-xs text-slate-500">
            Monthly attendance breakdown, percentages, ratios, and pie chart
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMonth(shiftMonth(month, -1))}
            className="border border-slate-300 hover:bg-slate-50 rounded-lg p-2 text-slate-700 transition"
            title="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setMonth(currentMonthStr)}
            className="border border-slate-300 hover:bg-slate-50 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 transition"
          >
            Current Month
          </button>

          <button
            type="button"
            onClick={() => setMonth(shiftMonth(month, 1))}
            className="border border-slate-300 hover:bg-slate-50 rounded-lg p-2 text-slate-700 transition"
            title="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => loadData(month)}
            className="border border-slate-300 hover:bg-slate-50 rounded-lg p-2 text-slate-700 transition ml-2"
            title="Refresh statistics"
          >
            <RotateCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      {/* Primary 4 Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* WFO Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between text-blue-700">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              WFO (Office)
            </span>
            <Building2 className="h-4 w-4" />
          </div>
          <p className="mt-2 text-2xl font-bold text-blue-600">{wfo} <span className="text-xs font-normal text-slate-500">days</span></p>
          <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
            <span>Share: {summary.wfo_percent || 0}%</span>
            <span>Ratio: {wfoRatio}</span>
          </div>
        </div>

        {/* WFH Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between text-emerald-700">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              WFH (Home)
            </span>
            <Home className="h-4 w-4" />
          </div>
          <p className="mt-2 text-2xl font-bold text-emerald-600">{wfh} <span className="text-xs font-normal text-slate-500">days</span></p>
          <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
            <span>Share: {summary.wfh_percent || 0}%</span>
            <span>Ratio: {wfhRatio}</span>
          </div>
        </div>

        {/* Leave Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between text-rose-700">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Leave
            </span>
            <CalendarOff className="h-4 w-4" />
          </div>
          <p className="mt-2 text-2xl font-bold text-rose-600">{leave} <span className="text-xs font-normal text-slate-500">days</span></p>
          <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
            <span>Share: {summary.leave_percent || 0}%</span>
            <span>Ratio: {leaveRatio}</span>
          </div>
        </div>

        {/* Total Tracked Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-700">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Total Logged
            </span>
            <BarChart3 className="h-4 w-4" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-800">{total} <span className="text-xs font-normal text-slate-500">days</span></p>
          <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
            <span>WFO : WFH</span>
            <span className="font-mono">{wfoToWfh}</span>
          </div>
        </div>
      </div>

      {/* Pie Chart Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-100">
          <PieChartIcon className="h-4 w-4 text-slate-600" />
          <h3 className="text-sm font-bold text-slate-800">
            Monthly Attendance Distribution (Pie Chart)
          </h3>
        </div>
        <MinimalPieChart wfo={wfo} wfh={wfh} leave={leave} total={total} />
      </div>

      {/* Additional Stats Details Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-bold text-slate-800 mb-3 pb-2 border-b border-slate-100">
          Detailed Monthly Statistics & Ratios
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div className="border border-slate-100 bg-slate-50/50 p-3 rounded-lg">
            <span className="text-xs text-slate-500 block">Work from Office Ratio</span>
            <span className="text-lg font-bold text-blue-700">{wfoRatio}</span>
            <span className="text-xs text-slate-400 block mt-0.5">
              {wfo} of {total} tracked days
            </span>
          </div>

          <div className="border border-slate-100 bg-slate-50/50 p-3 rounded-lg">
            <span className="text-xs text-slate-500 block">Work from Home Ratio</span>
            <span className="text-lg font-bold text-emerald-700">{wfhRatio}</span>
            <span className="text-xs text-slate-400 block mt-0.5">
              {wfh} of {total} tracked days
            </span>
          </div>

          <div className="border border-slate-100 bg-slate-50/50 p-3 rounded-lg">
            <span className="text-xs text-slate-500 block">Leave Ratio</span>
            <span className="text-lg font-bold text-rose-700">{leaveRatio}</span>
            <span className="text-xs text-slate-400 block mt-0.5">
              {leave} of {total} tracked days
            </span>
          </div>
        </div>
      </div>

      {/* Logged Days List for Month */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-bold text-slate-800 mb-3 pb-2 border-b border-slate-100">
          Recorded Days in {formatMonthLabel(month)} ({records.length})
        </h3>

        {records.length === 0 ? (
          <p className="text-xs text-slate-400 py-4 text-center">
            No days marked in this month yet.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {records.map((r) => (
              <div key={r.date} className="py-2.5 flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium text-slate-800">{formatDateReadable(r.date)}</span>
                  <div className="text-xs text-slate-500">
                    {r.check_in_time ? `Arrival: ${formatTime12h(r.check_in_time)}` : 'No arrival time logged'}{' '}
                    • Trigger: <span className="uppercase">{r.trigger_type}</span>
                    {r.notes ? ` • "${r.notes}"` : ''}
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
