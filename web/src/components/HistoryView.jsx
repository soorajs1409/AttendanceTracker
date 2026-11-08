import React, { useEffect, useState, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Building2,
  Home,
  CalendarOff,
  Landmark,
  Clock,
  Save,
  Trash2,
} from 'lucide-react';
import {
  fetchHistory,
  setDayAttendance,
  formatTime12h,
  formatDateReadable,
} from '../api';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUS_OPTIONS = [
  { id: 'WFO', label: 'WFO (Office)' },
  { id: 'WFH', label: 'WFH (Home)' },
  { id: 'LEAVE', label: 'Leave' },
  { id: 'HOLIDAY', label: 'Public Holiday' },
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
  const [summary, setSummary] = useState({
    total_working_days: 0,
    wfo: 0,
    wfh: 0,
    leave: 0,
    holiday: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedDate, setSelectedDate] = useState(todayDateStr);
  const [editNote, setEditNote] = useState('');
  const [editStatus, setEditStatus] = useState('WFO');
  const [editTime, setEditTime] = useState('09:00');
  const [savingDay, setSavingDay] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);

  const loadMonth = useCallback(async (targetMonth) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHistory(targetMonth);
      setRecords(data.records || []);
      setSummary(
        data.summary || {
          total_working_days: 0,
          wfo: 0,
          wfh: 0,
          leave: 0,
          holiday: 0,
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

  // Build map of date -> record
  const recordMap = {};
  for (const r of records) {
    recordMap[r.date] = r;
  }

  // Sync inspector fields when selectedDate changes
  useEffect(() => {
    const existing = recordMap[selectedDate];
    setSaveMessage(null);
    if (existing) {
      setEditNote(existing.notes || '');
      setEditStatus(existing.status || 'WFO');
      setEditTime((existing.check_in_time || '09:00').slice(0, 5));
    } else {
      setEditNote('');
      setEditStatus('WFO');
      setEditTime(statusData?.settings?.window_start || '09:00');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, records]);

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
        status: editStatus,
        time: editStatus === 'WFO' ? editTime : null,
        notes: editNote.trim() || null,
      });
      setSaveMessage({
        type: 'success',
        text: `Marked ${selectedDate} as ${
          editStatus === 'HOLIDAY' ? 'Public Holiday' : editStatus
        }.`,
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
        text: `Cleared attendance mark for ${selectedDate}.`,
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
    <div className="space-y-5">
      {/* Month Header & Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-white border border-slate-200 p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-slate-100 p-2 text-slate-700">
            <CalendarIcon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold tracking-tight text-slate-900">
              {formatMonthLabel(month)}
            </h2>
            <p className="text-xs text-slate-500">
              Select any date to record WFO, WFH, Leave, or Public Holiday
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
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
              onClick={() => {
                setMonth(defaultMonth);
                setSelectedDate(todayDateStr);
              }}
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
        </div>
      </div>

      {/* 4 Summary Metrics: WFO, WFH, Leave, Public Holidays */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-blue-600">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              WFO (Office)
            </span>
            <Building2 className="h-4 w-4" />
          </div>
          <p className="mt-1.5 text-2xl font-bold text-blue-600 tabular-nums">
            {summary.wfo || 0}
          </p>
        </div>

        <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-emerald-600">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              WFH (Home)
            </span>
            <Home className="h-4 w-4" />
          </div>
          <p className="mt-1.5 text-2xl font-bold text-emerald-600 tabular-nums">
            {summary.wfh || 0}
          </p>
        </div>

        <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-rose-600">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Leave
            </span>
            <CalendarOff className="h-4 w-4" />
          </div>
          <p className="mt-1.5 text-2xl font-bold text-rose-600 tabular-nums">
            {summary.leave || 0}
          </p>
        </div>

        <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-violet-600">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Public Holidays
            </span>
            <Landmark className="h-4 w-4" />
          </div>
          <p className="mt-1.5 text-2xl font-bold text-violet-600 tabular-nums">
            {summary.holiday || 0}
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800">
          {error}
        </div>
      )}

      {/* Calendar Grid + Day Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 rounded-xl bg-white border border-slate-200 p-4 sm:p-5 shadow-xs">
          {/* Weekday Headers */}
          <div className="grid grid-cols-7 gap-1.5 text-center mb-2">
            {WEEKDAYS.map((dayName) => (
              <div
                key={dayName}
                className="py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400"
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
                ? 'bg-slate-50/40 hover:bg-slate-100/70 text-slate-400'
                : 'bg-slate-50/80 hover:bg-slate-100 text-slate-700';

              if (cell.rec) {
                if (cell.rec.status === 'WFO') {
                  dotColor = 'bg-blue-600';
                  cellBg =
                    'bg-blue-50/80 hover:bg-blue-100/80 text-blue-950 border-blue-200';
                } else if (cell.rec.status === 'WFH') {
                  dotColor = 'bg-emerald-600';
                  cellBg =
                    'bg-emerald-50/80 hover:bg-emerald-100/80 text-emerald-950 border-emerald-200';
                } else if (cell.rec.status === 'LEAVE') {
                  dotColor = 'bg-rose-600';
                  cellBg =
                    'bg-rose-50/80 hover:bg-rose-100/80 text-rose-950 border-rose-200';
                } else if (cell.rec.status === 'HOLIDAY') {
                  dotColor = 'bg-violet-600';
                  cellBg =
                    'bg-violet-50/80 hover:bg-violet-100/80 text-violet-950 border-violet-200';
                }
              }

              return (
                <button
                  key={cell.dateStr}
                  type="button"
                  onClick={() => setSelectedDate(cell.dateStr)}
                  className={`relative aspect-square rounded-lg border p-1.5 flex flex-col items-center justify-between transition ${
                    isSelected
                      ? 'ring-2 ring-slate-900 border-slate-900'
                      : 'border-transparent'
                  } ${cellBg}`}
                >
                  <span
                    className={`text-xs sm:text-sm font-semibold tabular-nums ${
                      cell.isToday
                        ? 'underline decoration-slate-900 decoration-2 underline-offset-2'
                        : ''
                    }`}
                  >
                    {cell.day}
                  </span>

                  <div className="flex flex-col items-center gap-0.5 min-h-[14px]">
                    {dotColor && (
                      <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                    )}
                    {cell.rec?.check_in_time && (
                      <span className="hidden sm:block text-[10px] font-medium opacity-75 leading-none tabular-nums">
                        {cell.rec.check_in_time.slice(0, 5)}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="mt-5 pt-4 border-t border-slate-100 flex flex-wrap items-center gap-4 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />
              WFO
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
              WFH
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-600" />
              Leave
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-violet-600" />
              Public Holiday
            </span>
            <span className="inline-flex items-center gap-1.5 text-slate-400">
              <span className="h-2.5 w-2.5 rounded-full border border-slate-300 bg-transparent" />
              Unmarked
            </span>
          </div>
        </div>

        {/* Day Inspector & Manual Override Panel */}
        <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Selected Date
                </p>
                <h3 className="text-sm font-bold text-slate-900 mt-0.5">
                  {formatDateReadable(selectedDate)}
                </h3>
              </div>
              {loading && (
                <span className="text-xs text-slate-400">Syncing...</span>
              )}
            </div>

            {selectedRecord ? (
              <div className="mt-4 space-y-2 rounded-lg bg-slate-50 border border-slate-100 p-3 text-xs text-slate-700">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Status</span>
                  <span
                    className={`font-semibold px-2 py-0.5 rounded-md border ${
                      selectedRecord.status === 'WFO'
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : selectedRecord.status === 'WFH'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : selectedRecord.status === 'HOLIDAY'
                            ? 'bg-violet-50 text-violet-700 border-violet-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                    }`}
                  >
                    {selectedRecord.status === 'HOLIDAY'
                      ? 'PUBLIC HOLIDAY'
                      : selectedRecord.status}
                  </span>
                </div>
                {selectedRecord.check_in_time && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Check-in Time</span>
                    <span className="font-semibold text-slate-900 tabular-nums">
                      {formatTime12h(selectedRecord.check_in_time)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Source</span>
                  <span className="font-semibold text-slate-900 uppercase">
                    {selectedRecord.trigger_type || 'MANUAL'}
                  </span>
                </div>
                {selectedRecord.notes && (
                  <div className="pt-1.5 border-t border-slate-200/60">
                    <span className="text-slate-500 block mb-0.5">Notes</span>
                    <span className="text-slate-800">{selectedRecord.notes}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-500">
                No attendance recorded for this date.
              </div>
            )}

            {/* Manual Set/Override Form */}
            <form onSubmit={handleSaveDayRecord} className="mt-5 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Category
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {STATUS_OPTIONS.map((opt) => {
                    const active = editStatus === opt.id;
                    let activeClass = '';
                    if (active) {
                      if (opt.id === 'WFO')
                        activeClass = 'bg-blue-600 text-white border-blue-600';
                      else if (opt.id === 'WFH')
                        activeClass =
                          'bg-emerald-600 text-white border-emerald-600';
                      else if (opt.id === 'LEAVE')
                        activeClass = 'bg-rose-600 text-white border-rose-600';
                      else if (opt.id === 'HOLIDAY')
                        activeClass =
                          'bg-violet-600 text-white border-violet-600';
                    } else {
                      activeClass =
                        'bg-white text-slate-700 border-slate-200 hover:bg-slate-50';
                    }

                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setEditStatus(opt.id)}
                        className={`rounded-lg border px-2.5 py-2 text-xs font-semibold transition text-center ${activeClass}`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {editStatus === 'WFO' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Arrival Time (24h)
                  </label>
                  <div className="relative">
                    <Clock className="absolute left-3 top-2 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      pattern="^([01]\d|2[0-3]):[0-5]\d$"
                      placeholder="09:00"
                      value={editTime}
                      onChange={(e) => setEditTime(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Note (Optional)
                </label>
                <input
                  type="text"
                  placeholder={
                    editStatus === 'HOLIDAY'
                      ? 'e.g., Independence Day, Diwali'
                      : 'e.g., Planned leave / Remote sprint'
                  }
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={savingDay}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3 py-2 text-xs font-semibold text-white transition disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>
                    {savingDay
                      ? 'Saving...'
                      : `Mark as ${
                          editStatus === 'HOLIDAY'
                            ? 'Public Holiday'
                            : editStatus
                        }`}
                  </span>
                </button>

                {selectedRecord && (
                  <button
                    type="button"
                    onClick={handleClearDay}
                    disabled={savingDay}
                    title="Clear attendance mark for this day"
                    className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 hover:bg-slate-50 px-2.5 py-2 text-xs font-medium text-slate-600 transition"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-slate-400" />
                    <span>Clear</span>
                  </button>
                )}
              </div>
            </form>

            {saveMessage && (
              <div
                className={`mt-3 rounded-lg px-3 py-2 text-xs font-medium ${
                  saveMessage.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border border-rose-200'
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
