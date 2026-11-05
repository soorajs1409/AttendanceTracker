import React, { useEffect, useState, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  Edit3,
  Save,
} from 'lucide-react';
import {
  fetchHistory,
  submitCheckIn,
  formatTime12h,
  formatDateReadable,
} from '../api';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
  const workDays = statusData?.settings?.work_days || [1, 2, 3, 4, 5];

  const [month, setMonth] = useState(defaultMonth);
  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState({
    total: 0,
    present: 0,
    late: 0,
    manual: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedDate, setSelectedDate] = useState(todayDateStr);
  const [editNote, setEditNote] = useState('');
  const [editStatus, setEditStatus] = useState('PRESENT');
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
        data.summary || { total: 0, present: 0, late: 0, manual: 0 }
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
      setEditStatus(existing.status || 'PRESENT');
      setEditTime((existing.check_in_time || '09:00').slice(0, 5));
    } else {
      setEditNote('');
      setEditStatus('MANUAL');
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

  let missedCount = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateStr = `${month}-${String(day).padStart(2, '0')}`;
    const dow = new Date(yearNum, monthNum - 1, day).getDay();
    const isWorkDay = workDays.includes(dow);
    const rec = recordMap[dateStr] || null;
    const isPast = dateStr < todayDateStr;
    const isMissed = !rec && isWorkDay && isPast;
    if (isMissed) missedCount += 1;

    calendarCells.push({
      day,
      dateStr,
      dow,
      isWorkDay,
      rec,
      isMissed,
      isToday: dateStr === todayDateStr,
      isFuture: dateStr > todayDateStr,
    });
  }

  const selectedRecord = recordMap[selectedDate] || null;

  async function handleSaveDayRecord(e) {
    e.preventDefault();
    setSavingDay(true);
    setSaveMessage(null);
    try {
      await submitCheckIn({
        date: selectedDate,
        time: editTime,
        status: editStatus,
        trigger: selectedRecord ? selectedRecord.trigger_type : 'MANUAL',
        notes: editNote.trim() || null,
        overwrite: true,
      });
      setSaveMessage({
        type: 'success',
        text: `Saved attendance record for ${selectedDate}.`,
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

  return (
    <div className="space-y-6">
      {/* Month Header & Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-white border border-slate-200/80 p-4 sm:p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600">
            <CalendarIcon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {formatMonthLabel(month)}
            </h2>
            <p className="text-xs text-slate-500">
              Tap any day to inspect arrival details or add a note
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMonth(shiftMonth(month, -1))}
            className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 transition"
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
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            This Month
          </button>
          <button
            type="button"
            onClick={() => setMonth(shiftMonth(month, 1))}
            className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 transition"
            title="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Monthly Summary Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl bg-white border border-slate-200/80 p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">On-Time Present</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600">
            {summary.present}
          </p>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200/80 p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Late Arrivals</p>
          <p className="mt-1 text-2xl font-bold text-amber-600">
            {summary.late}
          </p>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200/80 p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Manual Logs</p>
          <p className="mt-1 text-2xl font-bold text-sky-600">
            {summary.manual}
          </p>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200/80 p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Missed Workdays</p>
          <p className="mt-1 text-2xl font-bold text-rose-600">{missedCount}</p>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}
        </div>
      )}

      {/* Calendar Grid + Day Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-2xl bg-white border border-slate-200/80 p-4 sm:p-6 shadow-sm">
          {/* Weekday Headers */}
          <div className="grid grid-cols-7 gap-1.5 text-center mb-2">
            {WEEKDAYS.map((dayName) => (
              <div
                key={dayName}
                className="py-1 text-xs font-semibold uppercase tracking-wider text-slate-400"
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
              let dotColor = 'bg-slate-300';
              let cellBg = 'bg-slate-50/70 hover:bg-slate-100 text-slate-700';

              if (cell.rec) {
                if (cell.rec.status === 'PRESENT') {
                  dotColor = 'bg-emerald-500';
                  cellBg =
                    'bg-emerald-50/70 hover:bg-emerald-100/80 text-emerald-950 border-emerald-200';
                } else if (cell.rec.status === 'LATE') {
                  dotColor = 'bg-amber-500';
                  cellBg =
                    'bg-amber-50/70 hover:bg-amber-100/80 text-amber-950 border-amber-200';
                } else {
                  dotColor = 'bg-sky-500';
                  cellBg =
                    'bg-sky-50/70 hover:bg-sky-100/80 text-sky-950 border-sky-200';
                }
              } else if (cell.isMissed) {
                dotColor = 'bg-rose-500';
                cellBg =
                  'bg-rose-50/50 hover:bg-rose-100/70 text-rose-900 border-rose-200/70';
              } else if (!cell.isWorkDay) {
                dotColor = 'bg-slate-300';
                cellBg = 'bg-slate-50/40 hover:bg-slate-100 text-slate-400';
              }

              return (
                <button
                  key={cell.dateStr}
                  type="button"
                  onClick={() => setSelectedDate(cell.dateStr)}
                  className={`relative aspect-square rounded-xl border p-1.5 flex flex-col items-center justify-between transition ${
                    isSelected
                      ? 'ring-2 ring-indigo-600 border-indigo-600'
                      : 'border-transparent'
                  } ${cellBg}`}
                >
                  <span
                    className={`text-xs sm:text-sm font-semibold ${
                      cell.isToday
                        ? 'underline decoration-indigo-600 decoration-2 underline-offset-2'
                        : ''
                    }`}
                  >
                    {cell.day}
                  </span>

                  <div className="flex flex-col items-center gap-0.5">
                    <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                    {cell.rec && (
                      <span className="hidden sm:block text-[10px] font-medium opacity-75 leading-none">
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
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              Present
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
              Late
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
              Manual
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
              Missed
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
              Off / Future
            </span>
          </div>
        </div>

        {/* Day Inspector & Note / Manual Override Panel */}
        <div className="rounded-2xl bg-white border border-slate-200/80 p-5 sm:p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
                  Selected Date
                </p>
                <h3 className="text-base font-bold text-slate-900 mt-0.5">
                  {formatDateReadable(selectedDate)}
                </h3>
              </div>
              {loading && (
                <span className="text-xs text-slate-400">Loading...</span>
              )}
            </div>

            {selectedRecord ? (
              <div className="mt-4 space-y-2.5 rounded-xl bg-slate-50 p-3.5 text-xs text-slate-700">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Status</span>
                  <span className="font-bold text-slate-900">
                    {selectedRecord.status}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Check-In Time</span>
                  <span className="font-semibold inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5 text-slate-400" />
                    {formatTime12h(selectedRecord.check_in_time)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Source</span>
                  <span className="font-medium uppercase">
                    {selectedRecord.trigger_type}
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 p-4 text-xs text-slate-500">
                No check-in logged for this date yet. You can record a manual entry or note below.
              </div>
            )}

            {/* Edit / Manual Log Form */}
            <form onSubmit={handleSaveDayRecord} className="mt-5 space-y-3.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <Edit3 className="h-3.5 w-3.5 text-indigo-600" />
                <span>
                  {selectedRecord ? 'Update Entry / Note' : 'Log Manual Entry'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Status
                  </label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-medium text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none"
                  >
                    <option value="PRESENT">PRESENT</option>
                    <option value="LATE">LATE</option>
                    <option value="MANUAL">MANUAL</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Arrival Time
                  </label>
                  <input
                    type="time"
                    value={editTime}
                    onChange={(e) => setEditTime(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-medium text-slate-900 focus:border-indigo-500 focus:bg-white focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Note
                </label>
                <textarea
                  rows={2}
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  placeholder="Add an optional note..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={savingDay}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition"
              >
                {selectedRecord ? (
                  <>
                    <Save className="h-3.5 w-3.5" />
                    {savingDay ? 'Saving...' : 'Save Changes'}
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {savingDay ? 'Logging...' : 'Save Manual Entry'}
                  </>
                )}
              </button>

              {saveMessage && (
                <p
                  className={`text-xs rounded-lg px-3 py-2 ${
                    saveMessage.type === 'success'
                      ? 'bg-emerald-50 text-emerald-800'
                      : 'bg-rose-50 text-rose-800'
                  }`}
                >
                  {saveMessage.text}
                </p>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
