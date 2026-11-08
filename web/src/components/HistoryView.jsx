import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Save,
  Trash2,
} from 'lucide-react';
import {
  fetchHistory,
  setDayAttendance,
  formatTime24h,
  formatDateReadable,
} from '../api';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUS_OPTIONS = [
  { id: 'WFO', label: 'WFO (Office)' },
  { id: 'WFH', label: 'WFH (Remote)' },
  { id: 'HOLIDAY', label: 'Public Holiday' },
  { id: 'LEAVE', label: 'Leave' },
  { id: '', label: 'On-Call / Note Only' },
];

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

export default function HistoryView({ statusData, onRefreshStatus }) {
  const todayDateStr =
    statusData?.today?.date || new Date().toISOString().slice(0, 10);
  const defaultMonth = todayDateStr.slice(0, 7);

  const [month, setMonth] = useState(defaultMonth);
  const [records, setRecords] = useState([]);
  const [availableMonthsList, setAvailableMonthsList] = useState([]);
  const [summary, setSummary] = useState({
    total_working_days: 0,
    wfo: 0,
    wfh: 0,
    leave: 0,
    holiday: 0,
    nsa_count: 0,
    on_call_count: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedDate, setSelectedDate] = useState(todayDateStr);
  const [editStatus, setEditStatus] = useState('WFO');
  const [editTimeIn, setEditTimeIn] = useState('12:00');
  const [editTimeOut, setEditTimeOut] = useState('22:00');
  const [editNsa, setEditNsa] = useState(false);
  const [editOnCall, setEditOnCall] = useState(false);
  const [editNote, setEditNote] = useState('');
  const [editRemarks, setEditRemarks] = useState('');
  const [savingDay, setSavingDay] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);

  const loadMonth = useCallback(async (targetMonth) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHistory(targetMonth);
      setRecords(data.records || []);
      setAvailableMonthsList(data.available_months || []);
      setSummary(
        data.summary || {
          total_working_days: 0,
          wfo: 0,
          wfh: 0,
          leave: 0,
          holiday: 0,
          nsa_count: 0,
          on_call_count: 0,
        }
      );
    } catch (err) {
      setError(err.message || 'Failed to load monthly attendance history.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMonth(month);
  }, [month, loadMonth]);

  const monthChoices = useMemo(() => {
    const set = new Set([defaultMonth, month, ...availableMonthsList]);
    return Array.from(set).filter(Boolean).sort();
  }, [defaultMonth, month, availableMonthsList]);

  // Build map of date -> record
  const recordMap = useMemo(() => {
    const map = {};
    for (const r of records) {
      map[r.date] = r;
    }
    return map;
  }, [records]);

  // Sync inspector fields when selectedDate changes
  useEffect(() => {
    const existing = recordMap[selectedDate];
    setSaveMessage(null);
    if (existing) {
      setEditStatus(existing.status || '');
      setEditTimeIn(
        existing.check_in_time ? existing.check_in_time.slice(0, 5) : ''
      );
      setEditTimeOut(
        existing.check_out_time ? existing.check_out_time.slice(0, 5) : ''
      );
      setEditNsa(Boolean(existing.nsa));
      setEditOnCall(Boolean(existing.on_call));
      setEditNote(existing.notes || '');
      setEditRemarks(existing.remarks || '');
    } else {
      setEditStatus('WFO');
      setEditTimeIn(statusData?.settings?.window_start || '09:00');
      setEditTimeOut('');
      setEditNsa(false);
      setEditOnCall(false);
      setEditNote('');
      setEditRemarks('');
    }
  }, [selectedDate, recordMap, statusData]);

  // Build calendar cells
  const [yearNum, monthNum] = month.split('-').map(Number);
  const firstDayDow = new Date(yearNum, monthNum - 1, 1).getDay();
  const daysInMonth = new Date(yearNum, monthNum, 0).getDate();

  const calendarCells = [];
  for (let i = 0; i < firstDayDow; i += 1) {
    calendarCells.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateStr = `${month}-${String(day).padStart(2, '0')}`;
    const dow = new Date(yearNum, monthNum - 1, day).getDay();
    const isWeekend = dow === 0 || dow === 6;
    const rec = recordMap[dateStr] || null;

    calendarCells.push({
      day,
      dateStr,
      dow,
      isWeekend,
      rec,
      isToday: dateStr === todayDateStr,
    });
  }

  const selectedRecord = recordMap[selectedDate] || null;

  async function handleSaveDayRecord(e) {
    if (e) e.preventDefault();
    setSavingDay(true);
    setSaveMessage(null);
    try {
      await setDayAttendance(selectedDate, {
        status: editStatus || null,
        time: editTimeIn.trim() || null,
        check_out_time: editTimeOut.trim() || null,
        nsa: editNsa,
        on_call: editOnCall,
        notes: editNote.trim() || null,
        remarks: editRemarks.trim() || null,
      });
      setSaveMessage({
        type: 'success',
        text: `Saved ${selectedDate}.`,
      });
      await loadMonth(month);
      if (onRefreshStatus) await onRefreshStatus();
    } catch (err) {
      setSaveMessage({
        type: 'error',
        text: err.message || 'Failed to update date record.',
      });
    } finally {
      setSavingDay(false);
    }
  }

  async function handleClearDay() {
    setSavingDay(true);
    setSaveMessage(null);
    try {
      await setDayAttendance(selectedDate, { status: null });
      setSaveMessage({
        type: 'success',
        text: `Cleared attendance record for ${selectedDate}.`,
      });
      await loadMonth(month);
      if (onRefreshStatus) await onRefreshStatus();
    } catch (err) {
      setSaveMessage({
        type: 'error',
        text: err.message || 'Failed to clear day.',
      });
    } finally {
      setSavingDay(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Month Header & Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            {formatMonthLabel(month)}
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Select a date to view or update WFO, WFH, Public Holiday, Leave, NSA, and On-Call details
          </p>
        </div>

        <div className="flex items-center gap-2">
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
              aria-label="Select calendar month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="bg-transparent px-2 py-0.5 text-xs font-medium text-zinc-800 dark:text-zinc-200 focus:outline-none cursor-pointer"
            >
              {monthChoices.map((mStr) => (
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
        </div>
      </div>

      {/* Unified Summary Strip */}
      <div className="grid grid-cols-3 sm:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200 dark:divide-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden tabular-nums">
        <div className="p-3.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
            Working
          </p>
          <p className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            {summary.total_working_days || 0}
          </p>
        </div>
        <div className="p-3.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
            WFO
          </p>
          <p className="mt-1 text-xl font-semibold text-blue-600 dark:text-blue-400">
            {summary.wfo || 0}
          </p>
        </div>
        <div className="p-3.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
            WFH
          </p>
          <p className="mt-1 text-xl font-semibold text-emerald-600 dark:text-emerald-400">
            {summary.wfh || 0}
          </p>
        </div>
        <div className="p-3.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
            Holiday
          </p>
          <p className="mt-1 text-xl font-semibold text-violet-600 dark:text-violet-400">
            {summary.holiday || 0}
          </p>
        </div>
        <div className="p-3.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
            Leave
          </p>
          <p className="mt-1 text-xl font-semibold text-rose-600 dark:text-rose-400">
            {summary.leave || 0}
          </p>
        </div>
        <div className="p-3.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
            NSA / On Call
          </p>
          <p className="mt-1 text-xl font-semibold text-zinc-800 dark:text-zinc-200">
            {summary.nsa_count || 0}
            <span className="text-zinc-300 dark:text-zinc-700 mx-1">/</span>
            <span className="text-amber-600 dark:text-amber-400">
              {summary.on_call_count || 0}
            </span>
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 p-3 text-xs font-medium text-rose-800 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Calendar Grid + Day Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 sm:p-5">
          {/* Weekday Headers */}
          <div className="grid grid-cols-7 gap-1.5 text-center mb-2">
            {WEEKDAYS.map((dayName) => (
              <div
                key={dayName}
                className="py-1 text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500"
              >
                {dayName}
              </div>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1.5">
            {calendarCells.map((cell, idx) => {
              if (!cell) {
                return <div key={`empty-${idx}`} className="aspect-square" />;
              }

              const isSelected = cell.dateStr === selectedDate;
              let dotColor = null;
              let cellBg = cell.isWeekend
                ? 'bg-zinc-50/50 dark:bg-zinc-950/50 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 text-zinc-400 dark:text-zinc-500'
                : 'bg-zinc-50 dark:bg-zinc-800/40 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300';

              if (cell.rec) {
                if (cell.rec.status === 'WFO') {
                  dotColor = 'bg-blue-600 dark:bg-blue-400';
                  cellBg =
                    'bg-blue-50/80 dark:bg-blue-950/40 hover:bg-blue-100/80 dark:hover:bg-blue-950/70 text-blue-950 dark:text-blue-200 border-blue-200 dark:border-blue-900/60';
                } else if (cell.rec.status === 'WFH') {
                  dotColor = 'bg-emerald-600 dark:bg-emerald-400';
                  cellBg =
                    'bg-emerald-50/80 dark:bg-emerald-950/40 hover:bg-emerald-100/80 dark:hover:bg-emerald-950/70 text-emerald-950 dark:text-emerald-200 border-emerald-200 dark:border-emerald-900/60';
                } else if (cell.rec.status === 'LEAVE') {
                  dotColor = 'bg-rose-600 dark:bg-rose-400';
                  cellBg =
                    'bg-rose-50/80 dark:bg-rose-950/40 hover:bg-rose-100/80 dark:hover:bg-rose-950/70 text-rose-950 dark:text-rose-200 border-rose-200 dark:border-rose-900/60';
                } else if (cell.rec.status === 'HOLIDAY') {
                  dotColor = 'bg-violet-600 dark:bg-violet-400';
                  cellBg =
                    'bg-violet-50/80 dark:bg-violet-950/40 hover:bg-violet-100/80 dark:hover:bg-violet-950/70 text-violet-950 dark:text-violet-200 border-violet-200 dark:border-violet-900/60';
                } else if (cell.rec.on_call || cell.rec.notes) {
                  cellBg =
                    'bg-amber-50/70 dark:bg-amber-950/30 hover:bg-amber-100/70 dark:hover:bg-amber-950/50 text-amber-950 dark:text-amber-200 border-amber-200 dark:border-amber-900/60';
                }
              }

              return (
                <button
                  key={cell.dateStr}
                  type="button"
                  onClick={() => setSelectedDate(cell.dateStr)}
                  className={`relative aspect-square rounded-md border p-1.5 flex flex-col items-center justify-between transition ${
                    isSelected
                      ? 'ring-2 ring-zinc-900 dark:ring-zinc-100 border-zinc-900 dark:border-zinc-100'
                      : 'border-transparent'
                  } ${cellBg}`}
                >
                  <div className="w-full flex items-center justify-between">
                    <span
                      className={`text-xs font-semibold tabular-nums ${
                        cell.isToday
                          ? 'underline decoration-zinc-900 dark:decoration-zinc-100 decoration-2 underline-offset-2'
                          : ''
                      }`}
                    >
                      {cell.day}
                    </span>
                    {Boolean(cell.rec?.on_call) && (
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-amber-500"
                        title="On Call"
                      />
                    )}
                  </div>

                  <div className="flex flex-col items-center gap-0.5 min-h-[14px]">
                    {dotColor && (
                      <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
                    )}
                    {cell.rec?.check_in_time && (
                      <span className="hidden sm:block text-[10px] font-mono opacity-75 leading-none tabular-nums">
                        {formatTime24h(cell.rec.check_in_time)}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap items-center gap-4 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-blue-600 dark:bg-blue-400" />
              WFO
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-600 dark:bg-emerald-400" />
              WFH
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-violet-600 dark:bg-violet-400" />
              Public Holiday
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rose-600 dark:bg-rose-400" />
              Leave
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              On Call
            </span>
          </div>
        </div>

        {/* Day Inspector & Manual Editor */}
        <div className="lg:col-span-5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  Selected Date
                </p>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5">
                  {formatDateReadable(selectedDate)}
                </h3>
              </div>
              {loading && (
                <span className="text-xs text-zinc-400">Syncing...</span>
              )}
            </div>

            {selectedRecord ? (
              <div className="mt-4 space-y-1.5 rounded-md bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200/70 dark:border-zinc-800 p-3 text-xs text-zinc-700 dark:text-zinc-300">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500 dark:text-zinc-400">Category</span>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {selectedRecord.status === 'HOLIDAY'
                      ? 'Public Holiday'
                      : selectedRecord.status || 'On-Call / Note'}
                  </span>
                </div>
                {(selectedRecord.check_in_time || selectedRecord.check_out_time) && (
                  <div className="flex items-center justify-between tabular-nums">
                    <span className="text-zinc-500 dark:text-zinc-400">
                      Login / Logout
                    </span>
                    <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">
                      {formatTime24h(selectedRecord.check_in_time)} –{' '}
                      {formatTime24h(selectedRecord.check_out_time)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500 dark:text-zinc-400">
                    NSA / On Call
                  </span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    {selectedRecord.nsa ? 'NSA' : 'No NSA'} ·{' '}
                    {selectedRecord.on_call ? 'On Call' : 'No On Call'}
                  </span>
                </div>
                {selectedRecord.notes && (
                  <div className="pt-1.5 border-t border-zinc-200/70 dark:border-zinc-800">
                    <span className="text-zinc-500 dark:text-zinc-400 block mb-0.5">
                      Description / Notes
                    </span>
                    <span className="text-zinc-900 dark:text-zinc-100">
                      {selectedRecord.notes}
                    </span>
                  </div>
                )}
                {selectedRecord.remarks && (
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">
                      Remarks
                    </span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {selectedRecord.remarks}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-dashed border-zinc-200 dark:border-zinc-800 p-3 text-center text-xs text-zinc-400 dark:text-zinc-500">
                No attendance logged for this date.
              </div>
            )}

            {/* Day Editor Form */}
            <form onSubmit={handleSaveDayRecord} className="mt-5 space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Category
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {STATUS_OPTIONS.map((opt) => {
                    const active = editStatus === opt.id;
                    return (
                      <button
                        key={opt.id || 'none'}
                        type="button"
                        onClick={() => setEditStatus(opt.id)}
                        className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition text-center ${
                          opt.id === '' ? 'col-span-2' : ''
                        } ${
                          active
                            ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100'
                            : 'bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Login Time (24h)
                  </label>
                  <input
                    type="text"
                    placeholder="12:00"
                    value={editTimeIn}
                    onChange={(e) => setEditTimeIn(e.target.value)}
                    className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-1.5 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:border-zinc-900 dark:focus:border-zinc-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Logout Time (24h)
                  </label>
                  <input
                    type="text"
                    placeholder="22:00"
                    value={editTimeOut}
                    onChange={(e) => setEditTimeOut(e.target.value)}
                    className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-1.5 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:border-zinc-900 dark:focus:border-zinc-400 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-6 pt-0.5">
                <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editNsa}
                    onChange={(e) => setEditNsa(e.target.checked)}
                    className="accent-zinc-900 dark:accent-zinc-100"
                  />
                  <span>NSA (Night Shift)</span>
                </label>
                <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editOnCall}
                    onChange={(e) => setEditOnCall(e.target.checked)}
                    className="accent-zinc-900 dark:accent-zinc-100"
                  />
                  <span>ON Call</span>
                </label>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Description / Notes
                </label>
                <input
                  type="text"
                  placeholder={
                    editStatus === 'HOLIDAY'
                      ? 'e.g., Independence Day or PH work note'
                      : 'e.g., CR implementation - CHG0095532'
                  }
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 focus:border-zinc-900 dark:focus:border-zinc-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Remarks (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g., rcvd"
                  value={editRemarks}
                  onChange={(e) => setEditRemarks(e.target.value)}
                  className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 focus:border-zinc-900 dark:focus:border-zinc-400 focus:outline-none"
                />
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={savingDay}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-zinc-200 px-3 py-2 text-xs font-medium text-white dark:text-zinc-900 transition disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>{savingDay ? 'Saving...' : 'Save Day'}</span>
                </button>

                {selectedRecord && (
                  <button
                    type="button"
                    onClick={handleClearDay}
                    disabled={savingDay}
                    title="Clear attendance record for this day"
                    className="inline-flex items-center justify-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 transition"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Clear</span>
                  </button>
                )}
              </div>
            </form>

            {saveMessage && (
              <div
                className={`mt-3 rounded-md px-3 py-2 text-xs font-medium border ${
                  saveMessage.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/60'
                    : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/60'
                }`}
              >
                {saveMessage.text}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
