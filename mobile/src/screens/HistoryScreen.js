const React = require('react');
const { useState, useEffect, useCallback } = React;
const {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} = require('react-native');
const {
  fetchHistory,
  setDayAttendance,
  formatTime12h,
  formatDateReadable,
} = require('../api');

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

function HistoryScreen({ statusData, onRefreshStatus }) {
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
  const [editStatus, setEditStatus] = useState('WFO');
  const [editTime, setEditTime] = useState('09:00');
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);

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
      setError(err.message || 'Failed to load monthly history.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMonth(month);
  }, [month, loadMonth]);

  const recordMap = {};
  for (const r of records) {
    recordMap[r.date] = r;
  }

  useEffect(() => {
    const existing = recordMap[selectedDate];
    setSaveMsg(null);
    if (existing) {
      setEditStatus(existing.status || 'WFO');
      setEditTime((existing.check_in_time || '09:00').slice(0, 5));
      setEditNote(existing.notes || '');
    } else {
      setEditStatus('WFO');
      setEditTime(statusData?.settings?.window_start || '09:00');
      setEditNote('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, records]);

  const [yearNum, monthNum] = month.split('-').map(Number);
  const firstDayDow = new Date(yearNum, monthNum - 1, 1).getDay();
  const daysInMonth = new Date(yearNum, monthNum, 0).getDate();

  const cells = [];
  for (let i = 0; i < firstDayDow; i += 1) {
    cells.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateStr = `${month}-${String(day).padStart(2, '0')}`;
    const dow = new Date(yearNum, monthNum - 1, day).getDay();
    const isWeekend = dow === 0 || dow === 6;
    const rec = recordMap[dateStr] || null;

    cells.push({
      day,
      dateStr,
      isWeekend,
      rec,
      isToday: dateStr === todayDateStr,
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  const rows = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }

  const selectedRecord = recordMap[selectedDate] || null;

  async function handleSaveDay() {
    setSaving(true);
    setSaveMsg(null);
    try {
      await setDayAttendance(selectedDate, {
        status: editStatus,
        time: editStatus === 'WFO' ? editTime : null,
        notes: editNote.trim() || null,
      });
      setSaveMsg({
        type: 'success',
        text: `Marked ${selectedDate} as ${
          editStatus === 'HOLIDAY' ? 'Public Holiday' : editStatus
        }.`,
      });
      await loadMonth(month);
      if (onRefreshStatus) await onRefreshStatus();
    } catch (err) {
      setSaveMsg({
        type: 'error',
        text: err.message || 'Failed to save entry.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleClearDay() {
    setSaving(true);
    setSaveMsg(null);
    try {
      await setDayAttendance(selectedDate, { status: null });
      setSaveMsg({
        type: 'success',
        text: `Cleared attendance record for ${selectedDate}.`,
      });
      await loadMonth(month);
      if (onRefreshStatus) await onRefreshStatus();
    } catch (err) {
      setSaveMsg({
        type: 'error',
        text: err.message || 'Failed to clear entry.',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Month Switcher Header */}
      <View style={styles.monthHeader}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={styles.monthTitle}>{formatMonthLabel(month)}</Text>
          <Text style={styles.monthSub}>
            Select any date to record WFO, WFH, Leave, or Public Holiday
          </Text>
        </View>

        <View style={styles.navGroup}>
          <TouchableOpacity
            style={styles.navBtn}
            onPress={() => setMonth(shiftMonth(month, -1))}
          >
            <Text style={styles.navBtnText}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.todayBtn}
            onPress={() => {
              setMonth(defaultMonth);
              setSelectedDate(todayDateStr);
            }}
          >
            <Text style={styles.todayBtnText}>Current</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navBtn}
            onPress={() => setMonth(shiftMonth(month, 1))}
          >
            <Text style={styles.navBtnText}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Summary Stats Row: WFO, WFH, Leave, Public Holidays */}
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>WFO</Text>
          <Text style={[styles.statValue, { color: '#2563eb' }]}>
            {summary.wfo || 0}
          </Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>WFH</Text>
          <Text style={[styles.statValue, { color: '#059669' }]}>
            {summary.wfh || 0}
          </Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>LEAVE</Text>
          <Text style={[styles.statValue, { color: '#e11d48' }]}>
            {summary.leave || 0}
          </Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>HOLIDAYS</Text>
          <Text style={[styles.statValue, { color: '#7c3aed' }]}>
            {summary.holiday || 0}
          </Text>
        </View>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* Calendar Grid Card */}
      <View style={styles.card}>
        <View style={styles.weekHeaderRow}>
          {WEEKDAYS.map((d) => (
            <Text key={d} style={styles.weekHeaderText}>
              {d}
            </Text>
          ))}
        </View>

        {loading ? (
          <View style={{ paddingVertical: 28 }}>
            <ActivityIndicator color="#0f172a" />
          </View>
        ) : (
          rows.map((row, rIdx) => (
            <View key={`row-${rIdx}`} style={styles.weekRow}>
              {row.map((cell, cIdx) => {
                if (!cell) {
                  return (
                    <View
                      key={`empty-${rIdx}-${cIdx}`}
                      style={styles.dayCellEmpty}
                    />
                  );
                }

                const isSelected = cell.dateStr === selectedDate;
                let dotColor = null;
                let cellBg = cell.isWeekend ? '#f8fafc' : '#f1f5f9';

                if (cell.rec) {
                  if (cell.rec.status === 'WFO') {
                    dotColor = '#2563eb';
                    cellBg = '#eff6ff';
                  } else if (cell.rec.status === 'WFH') {
                    dotColor = '#059669';
                    cellBg = '#ecfdf5';
                  } else if (cell.rec.status === 'LEAVE') {
                    dotColor = '#e11d48';
                    cellBg = '#fff1f2';
                  } else if (cell.rec.status === 'HOLIDAY') {
                    dotColor = '#7c3aed';
                    cellBg = '#f5f3ff';
                  }
                }

                return (
                  <TouchableOpacity
                    key={cell.dateStr}
                    style={[
                      styles.dayCell,
                      { backgroundColor: cellBg },
                      isSelected && styles.dayCellSelected,
                    ]}
                    onPress={() => setSelectedDate(cell.dateStr)}
                  >
                    <Text
                      style={[
                        styles.dayNumber,
                        cell.isWeekend && !cell.rec && { color: '#94a3b8' },
                        cell.isToday && styles.dayNumberToday,
                      ]}
                    >
                      {cell.day}
                    </Text>
                    {dotColor ? (
                      <View
                        style={[styles.dot, { backgroundColor: dotColor }]}
                      />
                    ) : (
                      <View style={styles.dotPlaceholder} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))
        )}

        {/* Legend */}
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: '#2563eb' }]} />
            <Text style={styles.legendText}>WFO</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: '#059669' }]} />
            <Text style={styles.legendText}>WFH</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: '#e11d48' }]} />
            <Text style={styles.legendText}>Leave</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: '#7c3aed' }]} />
            <Text style={styles.legendText}>Public Holiday</Text>
          </View>
        </View>
      </View>

      {/* Selected Day Inspector & Manual Override Card */}
      <View style={styles.card}>
        <Text style={styles.inspectorLabel}>SELECTED DATE</Text>
        <Text style={styles.inspectorDate}>
          {formatDateReadable(selectedDate)}
        </Text>

        {selectedRecord ? (
          <View style={styles.recordDetailBox}>
            <View style={styles.detailRow}>
              <Text style={styles.detailKey}>Status</Text>
              <Text style={styles.detailVal}>
                {selectedRecord.status === 'HOLIDAY'
                  ? 'PUBLIC HOLIDAY'
                  : selectedRecord.status}
              </Text>
            </View>
            {selectedRecord.check_in_time ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailKey}>Check-In Time</Text>
                <Text style={styles.detailVal}>
                  {formatTime12h(selectedRecord.check_in_time)}
                </Text>
              </View>
            ) : null}
            <View style={styles.detailRow}>
              <Text style={styles.detailKey}>Source</Text>
              <Text style={styles.detailVal}>
                {selectedRecord.trigger_type || 'MANUAL'}
              </Text>
            </View>
            {selectedRecord.notes ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailKey}>Notes</Text>
                <Text style={styles.detailVal}>{selectedRecord.notes}</Text>
              </View>
            ) : null}
          </View>
        ) : (
          <Text style={styles.noRecordText}>
            No attendance recorded for this date (unmarked).
          </Text>
        )}

        <Text style={styles.formSectionLabel}>
          {selectedRecord ? 'Update Day Category' : 'Record Day Category'}
        </Text>

        {/* 2x2 Status Selector Grid: WFO, WFH, LEAVE, HOLIDAY */}
        <View style={styles.statusSelectorGrid}>
          {STATUS_OPTIONS.map((opt) => {
            const active = editStatus === opt.id;
            let activeStyle = styles.statusOptBtnActiveBlue;
            if (opt.id === 'WFH') activeStyle = styles.statusOptBtnActiveGreen;
            if (opt.id === 'LEAVE') activeStyle = styles.statusOptBtnActiveRose;
            if (opt.id === 'HOLIDAY')
              activeStyle = styles.statusOptBtnActiveViolet;

            return (
              <TouchableOpacity
                key={opt.id}
                style={[styles.statusOptBtn, active && activeStyle]}
                onPress={() => setEditStatus(opt.id)}
              >
                <Text
                  style={[
                    styles.statusOptText,
                    active && styles.statusOptTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {editStatus === 'WFO' && (
          <>
            <Text style={styles.inputLabel}>Arrival Time (24h HH:MM)</Text>
            <TextInput
              style={styles.input}
              value={editTime}
              onChangeText={setEditTime}
              placeholder="09:00"
              placeholderTextColor="#94a3b8"
            />
          </>
        )}

        <Text style={styles.inputLabel}>Note (Optional)</Text>
        <TextInput
          style={[styles.input, { minHeight: 52 }]}
          value={editNote}
          onChangeText={setEditNote}
          placeholder={
            editStatus === 'HOLIDAY'
              ? 'e.g. National Holiday, Festival...'
              : 'Add an optional note...'
          }
          placeholderTextColor="#94a3b8"
          multiline
        />

        <View style={styles.buttonStack}>
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={handleSaveDay}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.saveBtnText}>
                {selectedRecord
                  ? 'Save Changes'
                  : `Mark as ${
                      editStatus === 'HOLIDAY' ? 'Public Holiday' : editStatus
                    }`}
              </Text>
            )}
          </TouchableOpacity>

          {selectedRecord ? (
            <TouchableOpacity
              style={styles.clearBtn}
              onPress={handleClearDay}
              disabled={saving}
            >
              <Text style={styles.clearBtnText}>Clear (Unmark Day)</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {saveMsg && (
          <Text
            style={[
              styles.saveMsgText,
              { color: saveMsg.type === 'success' ? '#059669' : '#e11d48' },
            ]}
          >
            {saveMsg.text}
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  monthHeader: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  monthSub: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  navGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  navBtn: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 6,
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  navBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#334155',
  },
  todayBtn: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 6,
    paddingHorizontal: 8,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  todayBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statCard: {
    flex: 1,
    minWidth: '22%',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  statLabel: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
    marginTop: 2,
  },
  errorBox: {
    backgroundColor: '#fff1f2',
    borderColor: '#fecdd3',
    borderWidth: 1,
    padding: 10,
    borderRadius: 8,
  },
  errorText: {
    color: '#9f1239',
    fontSize: 12,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 15,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  weekHeaderRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  weekHeaderText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '700',
    color: '#94a3b8',
    textTransform: 'uppercase',
  },
  weekRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 4,
  },
  dayCellEmpty: {
    flex: 1,
    aspectRatio: 1,
  },
  dayCell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  dayCellSelected: {
    borderColor: '#0f172a',
  },
  dayNumber: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1e293b',
  },
  dayNumberToday: {
    color: '#0f172a',
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 999,
  },
  dotPlaceholder: {
    width: 6,
    height: 6,
  },
  legendRow: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendText: {
    fontSize: 11,
    color: '#64748b',
  },
  inspectorLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 0.6,
  },
  inspectorDate: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 2,
  },
  recordDetailBox: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#f1f5f9',
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    gap: 6,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailKey: {
    fontSize: 12,
    color: '#64748b',
  },
  detailVal: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  noRecordText: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 8,
  },
  formSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1e293b',
    marginTop: 12,
    marginBottom: 8,
  },
  statusSelectorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  statusOptBtn: {
    minWidth: '47%',
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    alignItems: 'center',
  },
  statusOptBtnActiveBlue: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  statusOptBtnActiveGreen: {
    backgroundColor: '#059669',
    borderColor: '#059669',
  },
  statusOptBtnActiveRose: {
    backgroundColor: '#e11d48',
    borderColor: '#e11d48',
  },
  statusOptBtnActiveViolet: {
    backgroundColor: '#7c3aed',
    borderColor: '#7c3aed',
  },
  statusOptText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  statusOptTextActive: {
    color: '#ffffff',
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: '#0f172a',
    marginBottom: 10,
  },
  buttonStack: {
    gap: 8,
    marginTop: 4,
  },
  saveBtn: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  clearBtn: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
  },
  clearBtnText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '600',
  },
  saveMsgText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
  },
});

module.exports = HistoryScreen;
