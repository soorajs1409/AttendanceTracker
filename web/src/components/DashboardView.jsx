import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Building2,
  Home,
  CalendarOff,
  Landmark,
  Briefcase,
  SlidersHorizontal,
  Filter,
  Search,
  ArrowUpDown,
  Target,
  CheckCircle2,
  AlertCircle,
  Eye,
} from 'lucide-react';
import { fetchHistory, formatTime12h, formatDateReadable } from '../api';

const DASHBOARD_PREFS_KEY = 'attendance_dashboard_prefs_v1';

function loadDashboardPrefs() {
  try {
    const raw = localStorage.getItem(DASHBOARD_PREFS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore storage errors
  }
  return {
    targetWfoPercent: 60,
    chartStyle: 'donut',
    showTargetPlanner: true,
    showDistribution: true,
    showBreakdown: true,
    showLogTable: true,
  };
}

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

export function StatusBadge({ status }) {
  if (status === 'WFO') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-semibold tracking-wide bg-blue-50 text-blue-700 border border-blue-200">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
        WFO
      </span>
    );
  }
  if (status === 'WFH') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-semibold tracking-wide bg-emerald-50 text-emerald-700 border border-emerald-200">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
        WFH
      </span>
    );
  }
  if (status === 'LEAVE') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-semibold tracking-wide bg-rose-50 text-rose-700 border border-rose-200">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-600" />
        LEAVE
      </span>
    );
  }
  if (status === 'HOLIDAY') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-semibold tracking-wide bg-violet-50 text-violet-700 border border-violet-200">
        <span className="h-1.5 w-1.5 rounded-full bg-violet-600" />
        PUBLIC HOLIDAY
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-semibold tracking-wide bg-slate-100 text-slate-600 border border-slate-200">
      {status || 'UNMARKED'}
    </span>
  );
}

/**
 * Minimalist SVG Donut / Bar Distribution based on Total Working Days.
 */
function WorkingDaysDistribution({
  wfo,
  wfh,
  unmarked,
  totalWorkingDays,
  wfoPercent,
  wfhPercent,
  chartStyle,
}) {
  if (!totalWorkingDays || totalWorkingDays <= 0) {
    return (
      <div className="py-10 text-center text-xs text-slate-400">
        No active working days in this period.
      </div>
    );
  }

  const r = 36;
  const circumference = 2 * Math.PI * r;
  const wfoLen = Math.min(1, wfo / totalWorkingDays) * circumference;
  const wfhLen = Math.min(1, wfh / totalWorkingDays) * circumference;
  const wfoOffset = 0;
  const wfhOffset = -wfoLen;
  const unmarkedPct = Math.max(0, Math.round((100 - wfoPercent - wfhPercent) * 10) / 10);

  return (
    <div className="space-y-6">
      {chartStyle === 'donut' ? (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-8 py-2">
          <div className="relative w-44 h-44 flex items-center justify-center shrink-0">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90 transform">
              <circle
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke="#f1f5f9"
                strokeWidth="16"
              />
              {wfo > 0 && (
                <circle
                  cx="50"
                  cy="50"
                  r={r}
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="16"
                  strokeDasharray={`${wfoLen} ${circumference}`}
                  strokeDashoffset={wfoOffset}
                />
              )}
              {wfh > 0 && (
                <circle
                  cx="50"
                  cy="50"
                  r={r}
                  fill="none"
                  stroke="#059669"
                  strokeWidth="16"
                  strokeDasharray={`${wfhLen} ${circumference}`}
                  strokeDashoffset={wfhOffset}
                />
              )}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
                {totalWorkingDays}
              </span>
              <span className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mt-0.5">
                Working Days
              </span>
            </div>
          </div>

          <div className="flex-1 w-full space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-blue-600 shrink-0" />
                <span className="text-xs font-medium text-slate-700">
                  Work from Office (WFO)
                </span>
              </div>
              <div className="text-right tabular-nums">
                <span className="text-xs font-bold text-slate-900">{wfo} days</span>
                <span className="text-xs text-slate-500 ml-2 font-medium">
                  {wfoPercent}%
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between py-2 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600 shrink-0" />
                <span className="text-xs font-medium text-slate-700">
                  Work from Home (WFH)
                </span>
              </div>
              <div className="text-right tabular-nums">
                <span className="text-xs font-bold text-slate-900">{wfh} days</span>
                <span className="text-xs text-slate-500 ml-2 font-medium">
                  {wfhPercent}%
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-slate-200 shrink-0" />
                <span className="text-xs font-medium text-slate-500">
                  Remaining / Unlogged Working Days
                </span>
              </div>
              <div className="text-right tabular-nums">
                <span className="text-xs font-semibold text-slate-600">
                  {unmarked} days
                </span>
                <span className="text-xs text-slate-400 ml-2 font-medium">
                  {unmarkedPct}%
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4 py-2">
          <div className="h-4 w-full rounded-lg bg-slate-100 overflow-hidden flex">
            {wfo > 0 && (
              <div
                style={{ width: `${Math.min(100, wfoPercent)}%` }}
                className="bg-blue-600 h-full transition-all duration-300"
                title={`WFO: ${wfo} days (${wfoPercent}%)`}
              />
            )}
            {wfh > 0 && (
              <div
                style={{ width: `${Math.min(100, wfhPercent)}%` }}
                className="bg-emerald-600 h-full transition-all duration-300"
                title={`WFH: ${wfh} days (${wfhPercent}%)`}
              />
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
                <span className="h-2 w-2 rounded-full bg-blue-600" />
                WFO Share
              </div>
              <p className="mt-1 text-lg font-bold text-slate-900 tabular-nums">
                {wfoPercent}%{' '}
                <span className="text-xs font-normal text-slate-500">
                  ({wfo} / {totalWorkingDays} days)
                </span>
              </p>
            </div>

            <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
                <span className="h-2 w-2 rounded-full bg-emerald-600" />
                WFH Share
              </div>
              <p className="mt-1 text-lg font-bold text-slate-900 tabular-nums">
                {wfhPercent}%{' '}
                <span className="text-xs font-normal text-slate-500">
                  ({wfh} / {totalWorkingDays} days)
                </span>
              </p>
            </div>

            <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
                <span className="h-2 w-2 rounded-full bg-slate-300" />
                Unlogged Working Days
              </div>
              <p className="mt-1 text-lg font-bold text-slate-900 tabular-nums">
                {unmarkedPct}%{' '}
                <span className="text-xs font-normal text-slate-500">
                  ({unmarked} / {totalWorkingDays} days)
                </span>
              </p>
            </div>
          </div>
        </div>
      )}
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
    summary: {
      calendar_days: 30,
      weekend_days: 8,
      weekdays: 22,
      total_working_days: 22,
      unmarked_working_days: 22,
      total: 0,
      wfo: 0,
      wfh: 0,
      leave: 0,
      holiday: 0,
      wfo_percent: 0,
      wfh_percent: 0,
    },
    records: [],
  });

  // Customization & Filter States
  const initialPrefs = useMemo(() => loadDashboardPrefs(), []);
  const [showCustomizeDrawer, setShowCustomizeDrawer] = useState(false);
  const [targetWfoPercent, setTargetWfoPercent] = useState(
    initialPrefs.targetWfoPercent ?? 60
  );
  const [chartStyle, setChartStyle] = useState(
    initialPrefs.chartStyle || 'donut'
  );
  const [showTargetPlanner, setShowTargetPlanner] = useState(
    initialPrefs.showTargetPlanner ?? true
  );
  const [showDistribution, setShowDistribution] = useState(
    initialPrefs.showDistribution ?? true
  );
  const [showBreakdown, setShowBreakdown] = useState(
    initialPrefs.showBreakdown ?? true
  );
  const [showLogTable, setShowLogTable] = useState(
    initialPrefs.showLogTable ?? true
  );

  // What-if simulator & custom working days override sliders
  const [customWorkingDays, setCustomWorkingDays] = useState(null); // null = use calculated total_working_days
  const [simulatedExtraWfo, setSimulatedExtraWfo] = useState(0);

  // Activity Log Filters
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [triggerFilter, setTriggerFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortDesc, setSortDesc] = useState(true);

  useEffect(() => {
    try {
      localStorage.setItem(
        DASHBOARD_PREFS_KEY,
        JSON.stringify({
          targetWfoPercent,
          chartStyle,
          showTargetPlanner,
          showDistribution,
          showBreakdown,
          showLogTable,
        })
      );
    } catch {
      // ignore storage errors
    }
  }, [
    targetWfoPercent,
    chartStyle,
    showTargetPlanner,
    showDistribution,
    showBreakdown,
    showLogTable,
  ]);

  const loadData = useCallback(async (targetMonth) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHistory(targetMonth);
      setHistoryData(data);
      setCustomWorkingDays(null);
      setSimulatedExtraWfo(0);
    } catch (err) {
      setError(err.message || 'Failed to load monthly statistics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(month);
  }, [month, loadData]);

  const summary = historyData?.summary || {};
  const records = historyData?.records || [];

  const baseWorkingDays = summary.total_working_days ?? 0;
  const effectiveWorkingDays =
    customWorkingDays !== null ? customWorkingDays : baseWorkingDays;

  const rawWfo = summary.wfo || 0;
  const rawWfh = summary.wfh || 0;
  const leaveCount = summary.leave || 0;
  const holidayCount = summary.holiday || 0;

  const effectiveWfo = rawWfo + simulatedExtraWfo;
  const effectiveWfh = rawWfh;
  const effectiveUnmarked = Math.max(
    0,
    effectiveWorkingDays - effectiveWfo - effectiveWfh
  );

  const wfoPercent =
    effectiveWorkingDays > 0
      ? Math.round((effectiveWfo / effectiveWorkingDays) * 1000) / 10
      : 0;
  const wfhPercent =
    effectiveWorkingDays > 0
      ? Math.round((effectiveWfh / effectiveWorkingDays) * 1000) / 10
      : 0;

  // Target WFO compliance math
  const requiredWfoDays = Math.ceil(
    (targetWfoPercent / 100) * effectiveWorkingDays
  );
  const remainingWfoToTarget = Math.max(0, requiredWfoDays - effectiveWfo);
  const targetMet = effectiveWfo >= requiredWfoDays;

  // Filtered & sorted records for the activity table
  const filteredRecords = useMemo(() => {
    return records
      .filter((r) => {
        if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
        if (
          triggerFilter !== 'ALL' &&
          (r.trigger_type || 'MANUAL').toUpperCase() !== triggerFilter
        ) {
          return false;
        }
        if (searchQuery.trim()) {
          const q = searchQuery.trim().toLowerCase();
          const matchDate = (r.date || '').toLowerCase().includes(q);
          const matchNotes = (r.notes || '').toLowerCase().includes(q);
          const matchStatus = (r.status || '').toLowerCase().includes(q);
          if (!matchDate && !matchNotes && !matchStatus) return false;
        }
        return true;
      })
      .sort((a, b) =>
        sortDesc
          ? b.date.localeCompare(a.date)
          : a.date.localeCompare(b.date)
      );
  }, [records, statusFilter, triggerFilter, searchQuery, sortDesc]);

  return (
    <div className="space-y-5">
      {/* Top Bar: Period Selector & Customize Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold tracking-tight text-slate-900">
              {formatMonthLabel(month)}
            </h2>
            {(customWorkingDays !== null || simulatedExtraWfo > 0) && (
              <span className="rounded bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                Simulation Active
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Working days exclude Saturdays, Sundays, Leaves, and Public Holidays
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50/60 p-0.5">
            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, -1))}
              className="rounded-md p-1.5 text-slate-600 hover:bg-white hover:text-slate-900 transition"
              title="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setMonth(currentMonthStr)}
              className="px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-slate-900 transition"
            >
              Current
            </button>
            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, 1))}
              className="rounded-md p-1.5 text-slate-600 hover:bg-white hover:text-slate-900 transition"
              title="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowCustomizeDrawer((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              showCustomizeDrawer
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>Customize</span>
          </button>

          <button
            type="button"
            onClick={() => loadData(month)}
            className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition"
            title="Refresh statistics"
          >
            <RotateCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Customizable Sliders & View Controls Drawer */}
      {showCustomizeDrawer && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-slate-700" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Dashboard Customization & Interactive Sliders
              </h3>
            </div>
            {(customWorkingDays !== null || simulatedExtraWfo > 0) && (
              <button
                type="button"
                onClick={() => {
                  setCustomWorkingDays(null);
                  setSimulatedExtraWfo(0);
                }}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
              >
                Reset Simulation
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Slider 1: Target WFO % Goal */}
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700">
                  Target WFO Policy
                </label>
                <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-bold text-white tabular-nums">
                  {targetWfoPercent}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={targetWfoPercent}
                onChange={(e) => setTargetWfoPercent(Number(e.target.value))}
                className="w-full accent-slate-900 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400 font-medium">
                <span>0%</span>
                <span>50%</span>
                <span>60% (3d/wk)</span>
                <span>100%</span>
              </div>
            </div>

            {/* Slider 2: What-If Extra WFO Days Simulator */}
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700">
                  Simulate Additional WFO
                </label>
                <span className="rounded bg-blue-600 px-2 py-0.5 text-xs font-bold text-white tabular-nums">
                  +{simulatedExtraWfo} days
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, effectiveWorkingDays - rawWfo - rawWfh)}
                step={1}
                value={simulatedExtraWfo}
                onChange={(e) => setSimulatedExtraWfo(Number(e.target.value))}
                className="w-full accent-blue-600 cursor-pointer"
              />
              <p className="text-[11px] text-slate-500">
                Preview how logging remaining days as WFO impacts your monthly percentage.
              </p>
            </div>

            {/* Slider 3: Working Days Denominator Override */}
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700">
                  Working Days Denominator
                </label>
                <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-800 tabular-nums">
                  {effectiveWorkingDays} days
                  {customWorkingDays === null ? ' (Auto)' : ' (Custom)'}
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={summary.calendar_days || 31}
                step={1}
                value={effectiveWorkingDays || 1}
                onChange={(e) => setCustomWorkingDays(Number(e.target.value))}
                className="w-full accent-slate-700 cursor-pointer"
              />
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>Auto calculated: {baseWorkingDays}d</span>
                {customWorkingDays !== null && (
                  <button
                    type="button"
                    onClick={() => setCustomWorkingDays(null)}
                    className="font-semibold text-indigo-600 hover:underline"
                  >
                    Use Auto
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Widget Visibility & Chart Mode Toggles */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500 mr-1 inline-flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" /> Visible Sections:
              </span>
              {[
                {
                  id: 'planner',
                  label: 'WFO Target Planner',
                  active: showTargetPlanner,
                  toggle: () => setShowTargetPlanner((v) => !v),
                },
                {
                  id: 'dist',
                  label: 'Distribution Chart',
                  active: showDistribution,
                  toggle: () => setShowDistribution((v) => !v),
                },
                {
                  id: 'breakdown',
                  label: 'Working Days Formula',
                  active: showBreakdown,
                  toggle: () => setShowBreakdown((v) => !v),
                },
                {
                  id: 'log',
                  label: 'Activity Log',
                  active: showLogTable,
                  toggle: () => setShowLogTable((v) => !v),
                },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.toggle}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium border transition ${
                    item.active
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              <button
                type="button"
                onClick={() => setChartStyle('donut')}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                  chartStyle === 'donut'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Donut View
              </button>
              <button
                type="button"
                onClick={() => setChartStyle('bar')}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                  chartStyle === 'bar'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Bar View
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3.5 rounded-xl text-xs font-medium">
          {error}
        </div>
      )}

      {/* Primary 5 Metric Cards: Total Working Days, WFO, WFH, Leave, Public Holidays */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* 1. Total Working Days */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-semibold uppercase tracking-wider">
              Working Days
            </span>
            <Briefcase className="h-4 w-4 text-slate-700" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
            {effectiveWorkingDays}
            <span className="text-xs font-normal text-slate-400 ml-1">days</span>
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Excl. Sat/Sun, Leave & Holidays
          </p>
        </div>

        {/* 2. WFO */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-semibold uppercase tracking-wider">
              WFO (Office)
            </span>
            <Building2 className="h-4 w-4 text-blue-600" />
          </div>
          <div className="mt-2 flex items-baseline justify-between tabular-nums">
            <p className="text-2xl font-bold text-blue-600">
              {effectiveWfo}
              <span className="text-xs font-normal text-slate-400 ml-1">d</span>
            </p>
            <span className="rounded-md bg-blue-50 border border-blue-200 px-2 py-0.5 text-xs font-bold text-blue-700">
              {wfoPercent}%
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            {wfoPercent}% of {effectiveWorkingDays} working days
          </p>
        </div>

        {/* 3. WFH */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-semibold uppercase tracking-wider">
              WFH (Home)
            </span>
            <Home className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline justify-between tabular-nums">
            <p className="text-2xl font-bold text-emerald-600">
              {effectiveWfh}
              <span className="text-xs font-normal text-slate-400 ml-1">d</span>
            </p>
            <span className="rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs font-bold text-emerald-700">
              {wfhPercent}%
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            {wfhPercent}% of {effectiveWorkingDays} working days
          </p>
        </div>

        {/* 4. Leave */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-semibold uppercase tracking-wider">
              Leave
            </span>
            <CalendarOff className="h-4 w-4 text-rose-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-rose-600 tabular-nums">
            {leaveCount}
            <span className="text-xs font-normal text-slate-400 ml-1">days</span>
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Deducted from working days
          </p>
        </div>

        {/* 5. Public Holidays */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-semibold uppercase tracking-wider">
              Public Holidays
            </span>
            <Landmark className="h-4 w-4 text-violet-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-violet-600 tabular-nums">
            {holidayCount}
            <span className="text-xs font-normal text-slate-400 ml-1">days</span>
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Deducted from working days
          </p>
        </div>
      </div>

      {/* WFO Target Compliance Bar & Slider */}
      {showTargetPlanner && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-slate-700" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                WFO Target Tracker ({targetWfoPercent}% Requirement)
              </h3>
            </div>
            <div className="flex items-center gap-2">
              {targetMet ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Target Met ({effectiveWfo} / {requiredWfoDays} days)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {remainingWfoToTarget} more WFO{' '}
                  {remainingWfoToTarget === 1 ? 'day' : 'days'} needed (
                  {effectiveWfo} / {requiredWfoDays} days)
                </span>
              )}
            </div>
          </div>

          {/* Progress Bar with Target Marker */}
          <div className="relative pt-1">
            <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                style={{ width: `${Math.min(100, wfoPercent)}%` }}
                className={`h-full transition-all duration-300 ${
                  targetMet ? 'bg-emerald-600' : 'bg-blue-600'
                }`}
              />
            </div>
            <div
              style={{ left: `${Math.min(100, Math.max(0, targetWfoPercent))}%` }}
              className="absolute top-0 bottom-0 w-0.5 bg-slate-900"
              title={`Target: ${targetWfoPercent}%`}
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 text-xs text-slate-500">
            <span>
              Current WFO: <strong className="text-slate-900">{wfoPercent}%</strong>{' '}
              ({effectiveWfo} of {effectiveWorkingDays} working days)
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-slate-500">
                Adjust Target:
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={targetWfoPercent}
                onChange={(e) => setTargetWfoPercent(Number(e.target.value))}
                className="w-28 accent-slate-900 cursor-pointer"
              />
              <span className="font-bold text-slate-800 tabular-nums w-9 text-right">
                {targetWfoPercent}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Working Days Distribution Card */}
      {showDistribution && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Working Days Attendance Distribution
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                WFO and WFH percentages calculated over {effectiveWorkingDays} total working days
              </p>
            </div>
          </div>
          <WorkingDaysDistribution
            wfo={effectiveWfo}
            wfh={effectiveWfh}
            unmarked={effectiveUnmarked}
            totalWorkingDays={effectiveWorkingDays}
            wfoPercent={wfoPercent}
            wfhPercent={wfhPercent}
            chartStyle={chartStyle}
          />
        </div>
      )}

      {/* Working Days Calculation Breakdown */}
      {showBreakdown && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3 pb-2 border-b border-slate-100">
            Monthly Working Days Calculation
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3">
              <span className="text-[11px] font-medium text-slate-500 block">
                Calendar Days
              </span>
              <span className="text-lg font-bold text-slate-900 tabular-nums mt-0.5 block">
                {summary.calendar_days || 0}
              </span>
            </div>
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3">
              <span className="text-[11px] font-medium text-slate-500 block">
                Less Weekends (Sat/Sun)
              </span>
              <span className="text-lg font-bold text-slate-600 tabular-nums mt-0.5 block">
                −{summary.weekend_days || 0}
              </span>
            </div>
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3">
              <span className="text-[11px] font-medium text-slate-500 block">
                Less Leaves
              </span>
              <span className="text-lg font-bold text-rose-600 tabular-nums mt-0.5 block">
                −{leaveCount}
              </span>
            </div>
            <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3">
              <span className="text-[11px] font-medium text-slate-500 block">
                Less Public Holidays
              </span>
              <span className="text-lg font-bold text-violet-600 tabular-nums mt-0.5 block">
                −{holidayCount}
              </span>
            </div>
            <div className="rounded-lg border border-slate-900 bg-slate-900 text-white p-3 col-span-2 sm:col-span-1">
              <span className="text-[11px] font-medium text-slate-300 block">
                Total Working Days
              </span>
              <span className="text-lg font-bold text-white tabular-nums mt-0.5 block">
                = {effectiveWorkingDays}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Filterable Monthly Activity Log */}
      {showLogTable && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Recorded Days ({filteredRecords.length} of {records.length})
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Filter by category, source trigger, or notes
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter date or notes..."
                  className="rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 py-1 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none"
                />
              </div>

              <button
                type="button"
                onClick={() => setSortDesc((v) => !v)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
              >
                <ArrowUpDown className="h-3.5 w-3.5 text-slate-500" />
                <span>{sortDesc ? 'Newest' : 'Oldest'}</span>
              </button>
            </div>
          </div>

          {/* Filter Pills Row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mr-1 inline-flex items-center gap-1">
                <Filter className="h-3 w-3" /> Status:
              </span>
              {[
                { id: 'ALL', label: 'All' },
                { id: 'WFO', label: 'WFO' },
                { id: 'WFH', label: 'WFH' },
                { id: 'LEAVE', label: 'Leave' },
                { id: 'HOLIDAY', label: 'Public Holiday' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                    statusFilter === tab.id
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mr-1">
                Trigger:
              </span>
              {['ALL', 'GEOFENCE', 'MANUAL', 'AUTO'].map((trig) => (
                <button
                  key={trig}
                  type="button"
                  onClick={() => setTriggerFilter(trig)}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition ${
                    triggerFilter === trig
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
                  }`}
                >
                  {trig === 'ALL' ? 'All' : trig}
                </button>
              ))}
            </div>
          </div>

          {filteredRecords.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">
              No attendance records match the current filters.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredRecords.map((r) => (
                <div
                  key={r.date}
                  className="py-2.5 flex items-center justify-between text-sm"
                >
                  <div>
                    <span className="font-semibold text-slate-900 text-xs sm:text-sm">
                      {formatDateReadable(r.date)}
                    </span>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {r.check_in_time
                        ? `Arrival: ${formatTime12h(r.check_in_time)}`
                        : 'No arrival timestamp'}{' '}
                      • Source:{' '}
                      <span className="uppercase font-medium text-slate-600">
                        {r.trigger_type || 'MANUAL'}
                      </span>
                      {r.notes ? ` • "${r.notes}"` : ''}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
