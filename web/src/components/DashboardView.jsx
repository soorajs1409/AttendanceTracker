import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Upload,
  Download,
  Search,
  ArrowUpDown,
  FileSpreadsheet,
  X,
  Check,
  Edit3,
  Trash2,
} from 'lucide-react';
import {
  fetchHistory,
  importAttendanceFile,
  downloadAttendanceExcel,
  setDayAttendance,
  formatTime24h,
} from '../api';

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function shiftMonth(monthStr, delta) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(monthStr) {
  if (!monthStr) return '';
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function StatusBadge({ status }) {
  if (status === 'WFO') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900/70">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-600 dark:bg-blue-400" />
        WFO
      </span>
    );
  }
  if (status === 'WFH') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900/70">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
        WFH
      </span>
    );
  }
  if (status === 'LEAVE') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900/70">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-600 dark:bg-rose-400" />
        Leave
      </span>
    );
  }
  if (status === 'HOLIDAY') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-violet-50 text-violet-700 border border-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-900/70">
        <span className="h-1.5 w-1.5 rounded-full bg-violet-600 dark:bg-violet-400" />
        PH
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-zinc-100 text-zinc-600 border border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700">
      {status || '—'}
    </span>
  );
}

export default function DashboardView({ statusData, onRefresh }) {
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
      nsa_count: 0,
      on_call_count: 0,
      wfo_percent: 0,
      wfh_percent: 0,
      leave_percent: 0,
      holiday_percent: 0,
    },
    records: [],
    available_months: [],
    holidays_ref: [],
  });

  // Spreadsheet Import & Export state
  const fileInputRef = useRef(null);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [importMode, setImportMode] = useState('replace');
  const [importing, setImporting] = useState(false);
  const [importFeedback, setImportFeedback] = useState(null);
  const [exportScope, setExportScope] = useState('all');
  const [exporting, setExporting] = useState(false);

  // Table Filters & View Mode
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [viewMode, setViewMode] = useState('all_days'); // 'all_days' | 'logged_only'
  const [searchQuery, setSearchQuery] = useState('');
  const [sortDesc, setSortDesc] = useState(false);

  // Inline Row Editor state
  const [editingDate, setEditingDate] = useState(null);
  const [editForm, setEditForm] = useState({
    status: 'WFO',
    check_in_time: '12:00',
    check_out_time: '22:00',
    nsa: false,
    on_call: false,
    notes: '',
    remarks: '',
  });
  const [savingRow, setSavingRow] = useState(false);

  const loadData = useCallback(async (targetMonth) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHistory(targetMonth);
      setHistoryData(data);
    } catch (err) {
      setError(err.message || 'Failed to load monthly attendance data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(month);
  }, [month, loadData]);

  const summary = historyData?.summary || {};
  const records = historyData?.records || [];
  const availableMonths = useMemo(() => {
    const set = new Set([currentMonthStr, month, ...(historyData?.available_months || [])]);
    return Array.from(set).filter(Boolean).sort();
  }, [currentMonthStr, month, historyData?.available_months]);
  const holidaysRef = historyData?.holidays_ref || [];

  const workingDays = summary.total_working_days ?? 0;
  const wfo = summary.wfo || 0;
  const wfh = summary.wfh || 0;
  const leave = summary.leave || 0;
  const holiday = summary.holiday || 0;
  const nsaCount = summary.nsa_count || 0;
  const onCallCount = summary.on_call_count || 0;
  const unmarkedWorkingDays = summary.unmarked_working_days ?? Math.max(0, workingDays - wfo - wfh);

  const wfoPercent = summary.wfo_percent || 0;
  const wfhPercent = summary.wfh_percent || 0;
  const leavePercent =
    summary.leave_percent ??
    (workingDays > 0 ? Math.round((leave / workingDays) * 1000) / 10 : 0);
  const holidayPercent =
    summary.holiday_percent ??
    (workingDays > 0 ? Math.round((holiday / workingDays) * 1000) / 10 : 0);

  // Build map of date -> record
  const recordByDate = useMemo(() => {
    const map = new Map();
    for (const r of records) {
      map.set(r.date, r);
    }
    return map;
  }, [records]);

  // Build rows for either all calendar days of the month or logged records only
  const tableRows = useMemo(() => {
    const [yearNum, monthNum] = month.split('-').map(Number);
    const daysInMonth = new Date(yearNum, monthNum, 0).getDate();

    const baseRows = [];
    if (viewMode === 'all_days') {
      for (let d = 1; d <= daysInMonth; d += 1) {
        const dateStr = `${month}-${String(d).padStart(2, '0')}`;
        const dow = new Date(yearNum, monthNum - 1, d).getDay();
        const rec = recordByDate.get(dateStr);
        baseRows.push({
          date: dateStr,
          dayName: WEEKDAY_SHORT[dow],
          isWeekend: dow === 0 || dow === 6,
          status: rec?.status || null,
          check_in_time: rec?.check_in_time || null,
          check_out_time: rec?.check_out_time || null,
          nsa: Boolean(rec?.nsa),
          on_call: Boolean(rec?.on_call),
          notes: rec?.notes || '',
          remarks: rec?.remarks || '',
          hasRecord: Boolean(rec),
        });
      }
    } else {
      for (const r of records) {
        const [y, m, d] = r.date.split('-').map(Number);
        const dow = new Date(y, m - 1, d).getDay();
        baseRows.push({
          date: r.date,
          dayName: WEEKDAY_SHORT[dow],
          isWeekend: dow === 0 || dow === 6,
          status: r.status || null,
          check_in_time: r.check_in_time || null,
          check_out_time: r.check_out_time || null,
          nsa: Boolean(r.nsa),
          on_call: Boolean(r.on_call),
          notes: r.notes || '',
          remarks: r.remarks || '',
          hasRecord: true,
        });
      }
    }

    return baseRows
      .filter((row) => {
        if (statusFilter === 'WFO' && row.status !== 'WFO') return false;
        if (statusFilter === 'WFH' && row.status !== 'WFH') return false;
        if (statusFilter === 'HOLIDAY' && row.status !== 'HOLIDAY') return false;
        if (statusFilter === 'LEAVE' && row.status !== 'LEAVE') return false;
        if (statusFilter === 'ON_CALL' && !row.on_call) return false;
        if (statusFilter === 'NSA' && !row.nsa) return false;

        if (searchQuery.trim()) {
          const q = searchQuery.trim().toLowerCase();
          const matchDate = row.date.toLowerCase().includes(q);
          const matchDay = row.dayName.toLowerCase().includes(q);
          const matchStatus = (row.status || '').toLowerCase().includes(q);
          const matchNotes = (row.notes || '').toLowerCase().includes(q);
          const matchRemarks = (row.remarks || '').toLowerCase().includes(q);
          if (
            !matchDate &&
            !matchDay &&
            !matchStatus &&
            !matchNotes &&
            !matchRemarks
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) =>
        sortDesc ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)
      );
  }, [month, viewMode, recordByDate, records, statusFilter, searchQuery, sortDesc]);

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportFeedback(null);

    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read selected file'));
        reader.readAsDataURL(file);
      });

      const res = await importAttendanceFile({
        filename: file.name,
        contentBase64: base64,
        mode: importMode,
      });

      const targetMonth = res.latest_month || month;
      setImportFeedback({
        type: 'success',
        text: `Imported ${res.imported_records} records across ${
          res.months?.length || 1
        } month(s) and ${res.imported_holidays || 0} holiday references from ${
          file.name
        }.`,
      });

      if (targetMonth && targetMonth !== month) {
        setMonth(targetMonth);
      } else {
        await loadData(month);
      }
      if (onRefresh) await onRefresh();
    } catch (err) {
      setImportFeedback({
        type: 'error',
        text: err.message || 'Failed to import spreadsheet.',
      });
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  async function handleExportExcel() {
    setExporting(true);
    setError(null);
    try {
      if (exportScope === 'month') {
        await downloadAttendanceExcel({ month });
      } else {
        await downloadAttendanceExcel();
      }
    } catch (err) {
      setError(err.message || 'Failed to export Excel workbook.');
    } finally {
      setExporting(false);
    }
  }

  function startEditingRow(row) {
    const defaultStatus = row.status || (row.hasRecord ? '' : 'WFO');
    const isShift = defaultStatus === 'WFO' || defaultStatus === 'WFH';
    setEditingDate(row.date);
    setEditForm({
      status: defaultStatus,
      check_in_time: row.check_in_time
        ? row.check_in_time.slice(0, 5)
        : isShift
          ? '12:00'
          : '',
      check_out_time: row.check_out_time
        ? row.check_out_time.slice(0, 5)
        : isShift
          ? '22:00'
          : '',
      nsa: Boolean(row.nsa),
      on_call: Boolean(row.on_call),
      notes: row.notes || '',
      remarks: row.remarks || '',
    });
  }

  async function handleSaveRow(dateStr) {
    setSavingRow(true);
    try {
      await setDayAttendance(dateStr, {
        status: editForm.status || null,
        time: editForm.check_in_time.trim() || null,
        check_out_time: editForm.check_out_time.trim() || null,
        nsa: editForm.nsa,
        on_call: editForm.on_call,
        notes: editForm.notes.trim() || null,
        remarks: editForm.remarks.trim() || null,
      });
      setEditingDate(null);
      await loadData(month);
      if (onRefresh) await onRefresh();
    } catch (err) {
      setError(err.message || 'Failed to save attendance record.');
    } finally {
      setSavingRow(false);
    }
  }

  async function handleClearRow(dateStr) {
    setSavingRow(true);
    try {
      await setDayAttendance(dateStr, { status: null });
      setEditingDate(null);
      await loadData(month);
      if (onRefresh) await onRefresh();
    } catch (err) {
      setError(err.message || 'Failed to clear attendance record.');
    } finally {
      setSavingRow(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Bar: Period Navigation & Spreadsheet Import / Export */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            {formatMonthLabel(month)}
          </h2>

          <div className="inline-flex items-center rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-0.5">
            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, -1))}
              className="rounded p-1 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition"
              title="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <select
              aria-label="Select month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="bg-transparent px-2 py-0.5 text-xs font-medium text-zinc-800 dark:text-zinc-200 focus:outline-none cursor-pointer"
            >
              {availableMonths.map((mStr) => (
                <option
                  key={mStr}
                  value={mStr}
                  className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
                >
                  {formatMonthLabel(mStr)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, 1))}
              className="rounded p-1 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition"
              title="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {month !== currentMonthStr && (
            <button
              type="button"
              onClick={() => setMonth(currentMonthStr)}
              className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition"
            >
              Jump to Current
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Import Spreadsheet Button */}
          <button
            type="button"
            onClick={() => setShowImportPanel((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
              showImportPanel
                ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
            }`}
          >
            <Upload className="h-3.5 w-3.5" />
            <span>Import Sheet (.xlsx / .csv)</span>
          </button>

          {/* Export Detailed Excel Workbook */}
          <div className="inline-flex items-center rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <select
              aria-label="Export scope"
              value={exportScope}
              onChange={(e) => setExportScope(e.target.value)}
              className="bg-transparent pl-2.5 pr-1 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 border-r border-zinc-200 dark:border-zinc-800 focus:outline-none cursor-pointer"
            >
              <option value="all" className="bg-white dark:bg-zinc-900">
                All Months
              </option>
              <option value="month" className="bg-white dark:bg-zinc-900">
                {month} Only
              </option>
            </select>
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition"
              title="Download detailed multi-sheet Excel (.xlsx) report"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{exporting ? 'Exporting...' : 'Download .xlsx'}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => loadData(month)}
            className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-1.5 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition"
            title="Refresh data"
          >
            <RotateCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Spreadsheet Import Dropzone Panel */}
      {showImportPanel && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-2.5">
              <FileSpreadsheet className="h-4 w-4 text-zinc-500 dark:text-zinc-400 mt-0.5 shrink-0" />
              <div>
                <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  Import Attendance Workbook (.xlsx or .csv)
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Automatically scrapes multi-sheet workbooks, Holiday Reference tables, Monthly Off-Dates, Daily Login/Logout times, WFO/WFH/Leave/PH statuses, NSA, On-Call counts, and CR notes.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowImportPanel(false)}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
            <div className="flex items-center gap-4 text-xs">
              <label className="inline-flex items-center gap-1.5 cursor-pointer text-zinc-700 dark:text-zinc-300">
                <input
                  type="radio"
                  name="importMode"
                  value="replace"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                  className="accent-zinc-900 dark:accent-zinc-100"
                />
                <span>Replace existing records</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer text-zinc-700 dark:text-zinc-300">
                <input
                  type="radio"
                  name="importMode"
                  value="merge"
                  checked={importMode === 'merge'}
                  onChange={() => setImportMode('merge')}
                  className="accent-zinc-900 dark:accent-zinc-100"
                />
                <span>Merge with existing records</span>
              </label>
            </div>

            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                type="button"
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 dark:bg-zinc-100 px-3.5 py-1.5 text-xs font-medium text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50 transition"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>
                  {importing ? 'Extracting Workbook...' : 'Choose .xlsx or .csv File'}
                </span>
              </button>
            </div>
          </div>

          {importFeedback && (
            <div
              className={`rounded-md px-3 py-2 text-xs font-medium border ${
                importFeedback.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/60'
                  : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/60'
              }`}
            >
              {importFeedback.text}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 p-3 text-xs font-medium text-rose-800 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Unified High-Density Metric Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200 dark:divide-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        {/* 1. Working Days */}
        <div className="p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Working Days
          </p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 tabular-nums">
            {workingDays}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500 tabular-nums">
            of {summary.calendar_days || 30} cal days
          </p>
        </div>

        {/* 2. WFO */}
        <div className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              WFO (RGA)
            </p>
            <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
              {wfoPercent}%
            </span>
          </div>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 tabular-nums">
            {wfo}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
            Office days
          </p>
        </div>

        {/* 3. WFH */}
        <div className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              WFH (Remote)
            </p>
            <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {wfhPercent}%
            </span>
          </div>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 tabular-nums">
            {wfh}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
            Remote days
          </p>
        </div>

        {/* 4. Public Holidays */}
        <div className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Public Holiday
            </p>
            <span className="text-[11px] font-medium text-violet-600 dark:text-violet-400 tabular-nums">
              {holidayPercent}%
            </span>
          </div>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 tabular-nums">
            {holiday}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
            Excluded from working
          </p>
        </div>

        {/* 5. Leave */}
        <div className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Leave
            </p>
            <span className="text-[11px] font-medium text-rose-600 dark:text-rose-400 tabular-nums">
              {leavePercent}%
            </span>
          </div>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 tabular-nums">
            {leave}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
            Excluded from working
          </p>
        </div>

        {/* 6. NSA */}
        <div className="p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            NSA
          </p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 tabular-nums">
            {nsaCount}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
            Night shift allowance
          </p>
        </div>

        {/* 7. On Call */}
        <div className="p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            ON Call
          </p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 tabular-nums">
            {onCallCount}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
            Logged on-call shifts
          </p>
        </div>
      </div>

      {/* Monthly Summary Ledger & Working Days Derivation */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Spreadsheet Summary Table (Matches Cols L-N of Shift_2026.xlsx) */}
        <div className="lg:col-span-7 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
            <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Monthly Attendance Summary
            </span>
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 tabular-nums">
              No of Working Days: <strong className="text-zinc-900 dark:text-zinc-100">{workingDays}</strong>
            </span>
          </div>

          {/* Proportional Bar */}
          <div className="px-4 pt-3 pb-2">
            <div className="h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden flex">
              {wfo > 0 && (
                <div
                  style={{ width: `${Math.min(100, wfoPercent)}%` }}
                  className="bg-blue-600 dark:bg-blue-500 h-full"
                  title={`WFO: ${wfo} days (${wfoPercent}%)`}
                />
              )}
              {wfh > 0 && (
                <div
                  style={{ width: `${Math.min(100, wfhPercent)}%` }}
                  className="bg-emerald-600 dark:bg-emerald-500 h-full"
                  title={`WFH: ${wfh} days (${wfhPercent}%)`}
                />
              )}
            </div>
          </div>

          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                <th className="py-2 px-4">Category</th>
                <th className="py-2 px-4 text-right">Days</th>
                <th className="py-2 px-4 text-right">% of Working Days</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70 tabular-nums">
              <tr>
                <td className="py-2.5 px-4 font-medium text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-blue-600 dark:bg-blue-400" />
                  WFO (RGA)
                </td>
                <td className="py-2.5 px-4 text-right font-semibold text-zinc-900 dark:text-zinc-100">
                  {wfo}
                </td>
                <td className="py-2.5 px-4 text-right text-zinc-600 dark:text-zinc-400">
                  {wfoPercent}%
                </td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-medium text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-600 dark:bg-emerald-400" />
                  WFH (Remote)
                </td>
                <td className="py-2.5 px-4 text-right font-semibold text-zinc-900 dark:text-zinc-100">
                  {wfh}
                </td>
                <td className="py-2.5 px-4 text-right text-zinc-600 dark:text-zinc-400">
                  {wfhPercent}%
                </td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-medium text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-violet-600 dark:bg-violet-400" />
                  Public Holiday
                </td>
                <td className="py-2.5 px-4 text-right font-semibold text-zinc-900 dark:text-zinc-100">
                  {holiday}
                </td>
                <td className="py-2.5 px-4 text-right text-zinc-600 dark:text-zinc-400">
                  {holidayPercent}%
                </td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-medium text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-rose-600 dark:bg-rose-400" />
                  Leave
                </td>
                <td className="py-2.5 px-4 text-right font-semibold text-zinc-900 dark:text-zinc-100">
                  {leave}
                </td>
                <td className="py-2.5 px-4 text-right text-zinc-600 dark:text-zinc-400">
                  {leavePercent}%
                </td>
              </tr>
              {unmarkedWorkingDays > 0 && (
                <tr>
                  <td className="py-2.5 px-4 font-medium text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                    Remaining / Unmarked Working Days
                  </td>
                  <td className="py-2.5 px-4 text-right font-medium text-zinc-600 dark:text-zinc-400">
                    {unmarkedWorkingDays}
                  </td>
                  <td className="py-2.5 px-4 text-right text-zinc-400 dark:text-zinc-500">
                    {workingDays > 0
                      ? Math.round((unmarkedWorkingDays / workingDays) * 1000) / 10
                      : 0}
                    %
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Right: Working Days Calculation & Holiday Reference */}
        <div className="lg:col-span-5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col justify-between overflow-hidden">
          <div>
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
              <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                Working Days Derivation
              </span>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/70 text-xs tabular-nums">
              <div className="flex items-center justify-between py-2 px-4">
                <span className="text-zinc-600 dark:text-zinc-400">Calendar Days</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {summary.calendar_days || 0}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 px-4">
                <span className="text-zinc-600 dark:text-zinc-400">
                  Less Weekends (Sat & Sun)
                </span>
                <span className="font-medium text-zinc-500">
                  −{summary.weekend_days || 0}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 px-4">
                <span className="text-zinc-600 dark:text-zinc-400">
                  Less Public Holidays & Leaves
                </span>
                <span className="font-medium text-zinc-500">
                  −{(summary.weekdays || 0) - workingDays}
                </span>
              </div>
              <div className="flex items-center justify-between py-2.5 px-4 bg-zinc-50/80 dark:bg-zinc-800/40 font-semibold text-zinc-900 dark:text-zinc-100">
                <span>Total Working Days</span>
                <span>{workingDays} days</span>
              </div>
            </div>
          </div>

          {holidaysRef.length > 0 && (
            <div className="border-t border-zinc-200 dark:border-zinc-800 px-4 py-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-2">
                Imported Holiday Reference ({holidaysRef.length})
              </p>
              <div className="max-h-28 overflow-y-auto space-y-1 pr-1 text-xs">
                {holidaysRef.map((h) => (
                  <div
                    key={h.date}
                    className="flex items-center justify-between text-zinc-600 dark:text-zinc-400"
                  >
                    <span className="truncate pr-2 text-zinc-800 dark:text-zinc-200">
                      {h.name}
                    </span>
                    <span className="font-mono text-[11px] text-zinc-400 shrink-0">
                      {h.date.slice(5)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Daily Attendance Sheet Table */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 mr-2">
              Monthly Attendance Sheet
            </h3>

            {/* Status Filter Pills */}
            <div className="flex flex-wrap items-center gap-1">
              {[
                { id: 'ALL', label: 'All' },
                { id: 'WFO', label: 'WFO' },
                { id: 'WFH', label: 'WFH' },
                { id: 'HOLIDAY', label: 'PH' },
                { id: 'LEAVE', label: 'Leave' },
                { id: 'ON_CALL', label: 'On Call' },
                { id: 'NSA', label: 'NSA' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`rounded px-2 py-1 text-[11px] font-medium transition ${
                    statusFilter === tab.id
                      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* View Mode Toggle: Full Month vs Logged Only */}
            <div className="inline-flex rounded-md border border-zinc-200 dark:border-zinc-800 p-0.5 bg-zinc-50 dark:bg-zinc-950">
              <button
                type="button"
                onClick={() => setViewMode('all_days')}
                className={`rounded px-2 py-1 text-[11px] font-medium transition ${
                  viewMode === 'all_days'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                Full Month
              </button>
              <button
                type="button"
                onClick={() => setViewMode('logged_only')}
                className={`rounded px-2 py-1 text-[11px] font-medium transition ${
                  viewMode === 'logged_only'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                Logged ({records.length})
              </button>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter date, CR, notes..."
                className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 pl-8 pr-2.5 py-1 text-xs text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:border-zinc-900 dark:focus:border-zinc-400 focus:bg-white dark:focus:bg-zinc-900 focus:outline-none w-44 sm:w-52"
              />
            </div>

            {/* Sort Order Toggle */}
            <button
              type="button"
              onClick={() => setSortDesc((s) => !s)}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              title="Toggle date sort order"
            >
              <ArrowUpDown className="h-3 w-3" />
              <span>{sortDesc ? 'Newest' : '1 → 31'}</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                <th className="py-2.5 px-3">Date</th>
                <th className="py-2.5 px-2">Day</th>
                <th className="py-2.5 px-3">Login</th>
                <th className="py-2.5 px-3">Logout</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Description / Notes</th>
                <th className="py-2.5 px-2 text-center">NSA</th>
                <th className="py-2.5 px-2 text-center">ON Call</th>
                <th className="py-2.5 px-3">Remarks</th>
                <th className="py-2.5 px-3 text-right">Edit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60 tabular-nums">
              {tableRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="py-10 text-center text-xs text-zinc-400 dark:text-zinc-500"
                  >
                    No matching rows for this filter.
                  </td>
                </tr>
              ) : (
                tableRows.map((row) => {
                  const isEditing = editingDate === row.date;

                  if (isEditing) {
                    return (
                      <tr
                        key={row.date}
                        className="bg-zinc-50 dark:bg-zinc-800/50"
                      >
                        <td className="py-2 px-3 font-mono font-medium text-zinc-900 dark:text-zinc-100">
                          {row.date}
                        </td>
                        <td className="py-2 px-2 text-zinc-500">{row.dayName}</td>
                        <td className="py-2 px-2">
                          <input
                            type="text"
                            value={editForm.check_in_time}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                check_in_time: e.target.value,
                              }))
                            }
                            placeholder="12:00"
                            className="w-16 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 px-1.5 py-1 text-xs"
                          />
                        </td>
                        <td className="py-2 px-2">
                          <input
                            type="text"
                            value={editForm.check_out_time}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                check_out_time: e.target.value,
                              }))
                            }
                            placeholder="22:00"
                            className="w-16 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 px-1.5 py-1 text-xs"
                          />
                        </td>
                        <td className="py-2 px-2">
                          <select
                            value={editForm.status}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, status: e.target.value }))
                            }
                            className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 px-1.5 py-1 text-xs"
                          >
                            <option value="WFO">WFO</option>
                            <option value="WFH">WFH</option>
                            <option value="HOLIDAY">PH (Holiday)</option>
                            <option value="LEAVE">Leave</option>
                            <option value="">Note / On-Call Only</option>
                          </select>
                        </td>
                        <td className="py-2 px-2">
                          <input
                            type="text"
                            value={editForm.notes}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, notes: e.target.value }))
                            }
                            placeholder="CR / Holiday / Note"
                            className="w-full min-w-[140px] rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 px-2 py-1 text-xs"
                          />
                        </td>
                        <td className="py-2 px-2 text-center">
                          <input
                            type="checkbox"
                            checked={editForm.nsa}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, nsa: e.target.checked }))
                            }
                            className="accent-zinc-900 dark:accent-zinc-100"
                          />
                        </td>
                        <td className="py-2 px-2 text-center">
                          <input
                            type="checkbox"
                            checked={editForm.on_call}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                on_call: e.target.checked,
                              }))
                            }
                            className="accent-zinc-900 dark:accent-zinc-100"
                          />
                        </td>
                        <td className="py-2 px-2">
                          <input
                            type="text"
                            value={editForm.remarks}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                remarks: e.target.value,
                              }))
                            }
                            placeholder="rcvd"
                            className="w-16 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 px-1.5 py-1 text-xs"
                          />
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={savingRow}
                              onClick={() => handleSaveRow(row.date)}
                              className="rounded bg-zinc-900 dark:bg-zinc-100 p-1 text-white dark:text-zinc-900 hover:opacity-90"
                              title="Save row"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            {row.hasRecord && (
                              <button
                                type="button"
                                disabled={savingRow}
                                onClick={() => handleClearRow(row.date)}
                                className="rounded border border-rose-200 dark:border-rose-800 p-1 text-rose-600 dark:text-rose-400 hover:bg-rose-50"
                                title="Clear day"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setEditingDate(null)}
                              className="rounded border border-zinc-200 dark:border-zinc-700 p-1 text-zinc-500"
                              title="Cancel"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr
                      key={row.date}
                      className={`transition ${
                        row.isWeekend
                          ? 'bg-zinc-50/60 dark:bg-zinc-950/40 text-zinc-400 dark:text-zinc-500'
                          : 'hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40'
                      }`}
                    >
                      <td className="py-2 px-3 font-mono text-zinc-800 dark:text-zinc-200 whitespace-nowrap">
                        {row.date}
                      </td>
                      <td
                        className={`py-2 px-2 font-medium ${
                          row.isWeekend
                            ? 'text-zinc-400 dark:text-zinc-500'
                            : 'text-zinc-600 dark:text-zinc-400'
                        }`}
                      >
                        {row.dayName}
                      </td>
                      <td className="py-2 px-3 font-mono text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                        {formatTime24h(row.check_in_time)}
                      </td>
                      <td className="py-2 px-3 font-mono text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                        {formatTime24h(row.check_out_time)}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        {row.status ? (
                          <StatusBadge status={row.status} />
                        ) : row.isWeekend ? (
                          <span className="text-[11px] text-zinc-400 dark:text-zinc-600">
                            Weekend
                          </span>
                        ) : (
                          <span className="text-[11px] text-zinc-300 dark:text-zinc-700">
                            —
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-zinc-700 dark:text-zinc-300 max-w-xs truncate">
                        {row.notes || ''}
                      </td>
                      <td className="py-2 px-2 text-center">
                        {row.nsa ? (
                          <span className="inline-block rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-800 dark:text-zinc-200">
                            Yes
                          </span>
                        ) : (
                          ''
                        )}
                      </td>
                      <td className="py-2 px-2 text-center">
                        {row.on_call ? (
                          <span className="inline-block rounded bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/70 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300">
                            Yes
                          </span>
                        ) : (
                          ''
                        )}
                      </td>
                      <td className="py-2 px-3 text-zinc-500 dark:text-zinc-400">
                        {row.remarks || ''}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => startEditingRow(row)}
                          className="rounded p-1 text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
                          title={`Edit ${row.date}`}
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/90 dark:bg-zinc-950/60 font-semibold text-zinc-800 dark:text-zinc-200">
                <td colSpan={6} className="py-2.5 px-3 text-xs">
                  Monthly Totals ({formatMonthLabel(month)})
                </td>
                <td className="py-2.5 px-2 text-center tabular-nums">
                  {nsaCount}
                </td>
                <td className="py-2.5 px-2 text-center tabular-nums">
                  {onCallCount}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
