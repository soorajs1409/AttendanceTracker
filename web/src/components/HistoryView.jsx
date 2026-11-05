import React, { useEffect, useState, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  Edit3,
  Save,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  fetchHistory,
  setDayAttendance,
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

  const [month, setMonth] = useState(defaultMonth);
  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState({
    present: 0,
    absent: 0,
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
        data.summary || { present: 0, absent: 0 }
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
      setEditStatus(existing.status === 'ABSENT' ? 'ABSENT' : 'PRESENT');
      setEditTime((existing.check_in_time || '09:00').slice(0, 5));
    } else {
      setEditNote('');
      setEditStatus('PRESENT');
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
    const rec = recordMap[dateStr] || null;

    calendarCells.push({
      day,
      dateStr,
      dow,
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
        time: editStatus === 'PRESENT' ? editTime : null,
        notes: editNote.trim() || null,
      });
      setSaveMessage({
        type: 'success',
        text: `Marked ${selectedDate} as ${editStatus}.`,
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
        text: `Cleared attendance mark for ${selectedDate}. Day is now unmarked.`,
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
              Only explicitly marked days show status. Unmarked days stay clean.
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

      {/* Two Summary Metrics: Present or Absent */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl bg-white border border-slate-200/80 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Present Days
          </p>
          <p className="mt-1 text-3xl font-extrabold text-emerald-600">
            {summary.present}
          </p>
        </div>
        <div className="rounded-2xl bg-white border border-slate-200/80 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Absent Days
          </p>
          <p className="mt-1 text-3xl font-extrabold text-rose-600">
            {summary.absent}
          </p>
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
              let dotColor = null;
              let cellBg = 'bg-slate-50/50 hover:bg-slate-100 text-slate-700';

              if (cell.rec) {
                if (cell.rec.status === 'PRESENT') {
                  dotColor = 'bg-emerald-500';
                  cellBg =
                    'bg-emerald-50/70 hover:bg-emerald-100/80 text-emerald-950 border-emerald-200';
                } else if (cell.rec.status === 'ABSENT') {
                  dotColor = 'bg-rose-500';
                  cellBg =
                    'bg-rose-50/70 hover:bg-rose-100/80 text-rose-950 border-rose-200';
                }
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

                  <div className="flex flex-col items-center gap-0.5 min-h-[14px]">
                    {dotColor && (
                      <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                    )}
                    {cell.rec?.check_in_time && (
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
          <div className="mt-5 pt-4 border-t border-slate-100 flex flex-wrap items-center gap-5 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              Present
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
              Absent
            </span>
            <span className="inline-flex items-center gap-1.5 text-slate-400">
              <span className="h-2.5 w-2.5 rounded-full border border-slate-300 bg-transparent" />
              Unmarked
            </span>
          </div>
        </div>

        {/* Day Inspector & Manual Mark / Override Panel */}
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
                  <span
                    className={`font-bold px-2 py-0.5 rounded ${
                      selectedRecord.status === 'PRESENT'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {selectedRecord.status}
                  </span>
                </div>
                {selectedRecord.check_in_time && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Arrival Time</span>
                    <span className="font-semibold inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-slate-400" />
                      {formatTime12h(selectedRecord.check_in_time)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Source</span>
                  <span className="font-medium uppercase">
                    {selectedRecord.trigger_type}
                  </span>
                </div>
                {selectedRecord.notes && (
                  <div className="pt-1 text-slate-600">
                    <span className="text-slate-400">Note: </span>
                    {selectedRecord.notes}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 p-4 text-xs text-slate-500">
                This day is currently unmarked. You can mark it Present or Absent below.
              </div>
            )}

            {/* Edit / Mark Form */}
            <form onSubmit={handleSaveDayRecord} className="mt-5 space-y-3.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <Edit3 className="h-3.5 w-3.5 text-indigo-600" />
                <span>
                  {selectedRecord ? 'Update Day Status' : 'Mark Day'}
                </span>
              </div>

              {/* Two Options: PRESENT or ABSENT */}
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditStatus('PRESENT')}
                  className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border text-xs font-bold transition ${
                    editStatus === 'PRESENT'
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>PRESENT</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditStatus('ABSENT')}
                  className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border text-xs font-bold transition ${
                    editStatus === 'ABSENT'
                      ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <XCircle className="h-4 w-4" />
                  <span>ABSENT</span>
                </button>
              </div>

              {editStatus === 'PRESENT' && (
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
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Note (optional)
                </label>
                <textarea
                  rows={2}
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  placeholder="e.g. Sick day, WFH, manual adjustment..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={savingDay}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>{savingDay ? 'Saving...' : 'Save Status'}</span>
                </button>

                {selectedRecord && (
                  <button
                    type="button"
                    onClick={handleClearDay}
                    disabled={savingDay}
                    className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-600 transition"
                    title="Unmark day"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Clear</span>
                  </button>
                )}
              </div>

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
