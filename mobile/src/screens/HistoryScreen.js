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
  submitCheckIn,
  formatTime12h,
  formatDateReadable,
} = require('../api');

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUS_OPTIONS = ['PRESENT', 'LATE', 'MANUAL'];

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
  const [editStatus, setEditStatus] = useState('PRESENT');
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
        data.summary || { total: 0, present: 0, late: 0, manual: 0 }
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
      setEditStatus(existing.status || 'PRESENT');
      setEditTime((existing.check_in_time || '09:00').slice(0, 5));
      setEditNote(existing.notes || '');
    } else {
      setEditStatus('MANUAL');
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

  let missedCount = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateStr = `${month}-${String(day).padStart(2, '0')}`;
    const dow = new Date(yearNum, monthNum - 1, day).getDay();
    const isWorkDay = workDays.includes(dow);
    const rec = recordMap[dateStr] || null;
    const isPast = dateStr < todayDateStr;
    const isMissed = !rec && isWorkDay && isPast;
    if (isMissed) missedCount += 1;

    cells.push({
      day,
      dateStr,
      isWorkDay,
      rec,
      isMissed,
      isToday: dateStr === todayDateStr,
    });
  }

  // Pad trailing cells to full 7-column rows
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
      await submitCheckIn({
        date: selectedDate,
        time: editTime.trim() || '09:00',
        status: editStatus,
        trigger: selectedRecord ? selectedRecord.trigger_type : 'MANUAL',
        notes: editNote.trim() || null,
        overwrite: true,
      });
      setSaveMsg({
        type: 'success',
        text: `Saved attendance record for ${selectedDate}.`,
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Month Switcher Header */}
      <View style={styles.monthHeader}>
        <View>
          <Text style={styles.monthTitle}>{formatMonthLabel(month)}</Text>
          <Text style={styles.monthSub}>
            Tap any date to view timestamp or log note
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
            <Text style={styles.todayBtnText}>Today</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navBtn}
            onPress={() => setMonth(shiftMonth(month, 1))}
          >
            <Text style={styles.navBtnText}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Summary Stats Row */}
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Present</Text>
          <Text style={[styles.statValue, { color: '#059669' }]}>
            {summary.present}
          </Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Late</Text>
          <Text style={[styles.statValue, { color: '#d97706' }]}>
            {summary.late}
          </Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Manual</Text>
          <Text style={[styles.statValue, { color: '#0284c7' }]}>
            {summary.manual}
          </Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Missed</Text>
          <Text style={[styles.statValue, { color: '#e11d48' }]}>
            {missedCount}
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
            <ActivityIndicator color="#4f46e5" />
          </View>
        ) : (
          rows.map((row, rIdx) => (
            <View key={`row-${rIdx}`} style={styles.weekRow}>
              {row.map((cell, cIdx) => {
                if (!cell) {
                  return <View key={`empty-${rIdx}-${cIdx}`} style={styles.dayCellEmpty} />;
                }

                const isSelected = cell.dateStr === selectedDate;
                let dotColor = '#cbd5e1';
                let cellBg = '#f8fafc';

                if (cell.rec) {
                  if (cell.rec.status === 'PRESENT') {
                    dotColor = '#10b981';
                    cellBg = '#ecfdf5';
                  } else if (cell.rec.status === 'LATE') {
                    dotColor = '#f59e0b';
                    cellBg = '#fffbeb';
                  } else {
                    dotColor = '#0ea5e9';
                    cellBg = '#f0f9ff';
                  }
                } else if (cell.isMissed) {
                  dotColor = '#f43f5e';
                  cellBg = '#fff1f2';
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
                        !cell.isWorkDay && !cell.rec && { color: '#94a3b8' },
                        cell.isToday && styles.dayNumberToday,
                      ]}
                    >
                      {cell.day}
                    </Text>
                    <View
                      style={[styles.dot, { backgroundColor: dotColor }]}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>
          ))
        )}

        {/* Legend */}
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: '#10b981' }]} />
            <Text style={styles.legendText}>Present</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: '#f59e0b' }]} />
            <Text style={styles.legendText}>Late</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: '#0ea5e9' }]} />
            <Text style={styles.legendText}>Manual</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: '#f43f5e' }]} />
            <Text style={styles.legendText}>Missed</Text>
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
              <Text style={styles.detailVal}>{selectedRecord.status}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailKey}>Check-In Time</Text>
              <Text style={styles.detailVal}>
                {formatTime12h(selectedRecord.check_in_time)}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailKey}>Source</Text>
              <Text style={styles.detailVal}>
                {selectedRecord.trigger_type}
              </Text>
            </View>
          </View>
        ) : (
          <Text style={styles.noRecordText}>
            No check-in logged for this date yet. You can record a manual entry below.
          </Text>
        )}

        <Text style={styles.formSectionLabel}>
          {selectedRecord ? 'Update Entry / Note' : 'Log Manual Entry'}
        </Text>

        {/* Status Selector Pills */}
        <View style={styles.statusSelectorRow}>
          {STATUS_OPTIONS.map((opt) => {
            const active = editStatus === opt;
            return (
              <TouchableOpacity
                key={opt}
                style={[
                  styles.statusOptBtn,
                  active && styles.statusOptBtnActive,
                ]}
                onPress={() => setEditStatus(opt)}
              >
                <Text
                  style={[
                    styles.statusOptText,
                    active && styles.statusOptTextActive,
                  ]}
                >
                  {opt}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.inputLabel}>Arrival Time (24h HH:MM)</Text>
        <TextInput
          style={styles.input}
          value={editTime}
          onChangeText={setEditTime}
          placeholder="09:00"
          placeholderTextColor="#94a3b8"
        />

        <Text style={styles.inputLabel}>Note</Text>
        <TextInput
          style={[styles.input, { minHeight: 56 }]}
          value={editNote}
          onChangeText={setEditNote}
          placeholder="Add an optional note..."
          placeholderTextColor="#94a3b8"
          multiline
        />

        <TouchableOpacity
          style={styles.saveBtn}
          onPress={handleSaveDay}
          disabled={saving}
        >
          <Text style={styles.saveBtnText}>
            {saving
              ? 'Saving...'
              : selectedRecord
                ? 'Save Changes'
                : 'Save Manual Entry'}
          </Text>
        </TouchableOpacity>

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
    gap: 14,
  },
  monthHeader: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthTitle: {
    fontSize: 18,
    fontWeight: '800',
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
    gap: 6,
  },
  navBtn: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#334155',
  },
  todayBtn: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  statLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
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
    padding: 12,
    borderRadius: 12,
  },
  errorText: {
    color: '#9f1239',
    fontSize: 12,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
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
    fontSize: 11,
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
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  dayCellSelected: {
    borderColor: '#4f46e5',
  },
  dayNumber: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1e293b',
  },
  dayNumberToday: {
    color: '#4f46e5',
    textDecorationLine: 'underline',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  legendRow: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
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
    fontSize: 11,
    fontWeight: '700',
    color: '#4f46e5',
    letterSpacing: 0.5,
  },
  inspectorDate: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 2,
  },
  recordDetailBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
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
    marginTop: 10,
  },
  formSectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
    marginTop: 14,
    marginBottom: 8,
  },
  statusSelectorRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  statusOptBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    alignItems: 'center',
  },
  statusOptBtnActive: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
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
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: '#0f172a',
    marginBottom: 10,
  },
  saveBtn: {
    backgroundColor: '#4f46e5',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  saveMsgText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
  },
});

module.exports = HistoryScreen;
