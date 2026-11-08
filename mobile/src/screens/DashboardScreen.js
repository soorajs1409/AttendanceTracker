const React = require('react');
const { useState, useEffect, useCallback, useMemo } = React;
const {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  StyleSheet,
} = require('react-native');
const {
  fetchHistory,
  formatDateReadable,
} = require('../api');

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

function formatTime24(timeStr) {
  if (!timeStr) return '—';
  return String(timeStr).slice(0, 5);
}

function StatusBadge({ status, isDark }) {
  if (!status) {
    return (
      <View
        style={[
          styles.badge,
          {
            backgroundColor: isDark ? '#27272a' : '#f4f4f5',
            borderColor: isDark ? '#3f3f46' : '#e4e4e7',
          },
        ]}
      >
        <Text
          style={[
            styles.badgeText,
            { color: isDark ? '#a1a1aa' : '#52525b' },
          ]}
        >
          LOGGED
        </Text>
      </View>
    );
  }

  let bg = '#f4f4f5';
  let fg = '#3f3f46';
  let border = '#e4e4e7';
  let label = status;

  if (status === 'WFO') {
    bg = isDark ? 'rgba(37,99,235,0.15)' : '#eff6ff';
    fg = isDark ? '#60a5fa' : '#1d4ed8';
    border = isDark ? 'rgba(59,130,246,0.35)' : '#bfdbfe';
  } else if (status === 'WFH') {
    bg = isDark ? 'rgba(5,150,105,0.15)' : '#ecfdf5';
    fg = isDark ? '#34d399' : '#047857';
    border = isDark ? 'rgba(16,185,129,0.35)' : '#a7f3d0';
  } else if (status === 'LEAVE') {
    bg = isDark ? 'rgba(225,29,72,0.15)' : '#fff1f2';
    fg = isDark ? '#fb7185' : '#be123c';
    border = isDark ? 'rgba(244,63,94,0.35)' : '#fecdd3';
  } else if (status === 'HOLIDAY') {
    bg = isDark ? 'rgba(217,119,6,0.15)' : '#fffbeb';
    fg = isDark ? '#fbbf24' : '#b45309';
    border = isDark ? 'rgba(245,158,11,0.35)' : '#fde68a';
    label = 'PUBLIC HOLIDAY';
  }

  return (
    <View style={[styles.badge, { backgroundColor: bg, borderColor: border }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

function DashboardScreen({ statusData, theme = 'light' }) {
  const isDark = theme === 'dark';
  const todayDateStr =
    statusData?.today?.date || new Date().toISOString().slice(0, 10);
  const defaultMonth =
    (statusData?.available_months && statusData.available_months[0]) ||
    todayDateStr.slice(0, 7);

  const [month, setMonth] = useState(defaultMonth);
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

  // Activity Log Filters
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortDesc, setSortDesc] = useState(false);

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

  const summary = historyData?.summary || {};
  const records = historyData?.records || [];
  const availableMonths =
    historyData?.available_months || statusData?.available_months || [];
  const holidaysRef =
    historyData?.holidays_ref || statusData?.holidays_ref || [];

  const totalWorkingDays = summary.total_working_days ?? 0;
  const wfo = summary.wfo || 0;
  const wfh = summary.wfh || 0;
  const leaveCount = summary.leave || 0;
  const holidayCount = summary.holiday || 0;
  const nsaCount = summary.nsa_count || 0;
  const onCallCount = summary.on_call_count || 0;
  const unmarked = summary.unmarked_working_days ?? 0;

  const wfoPercent = summary.wfo_percent ?? 0;
  const wfhPercent = summary.wfh_percent ?? 0;
  const leavePercent = summary.leave_percent ?? 0;
  const holidayPercent = summary.holiday_percent ?? 0;

  const filteredRecords = useMemo(() => {
    return records
      .filter((r) => {
        if (statusFilter === 'ONCALL') {
          if (!r.on_call) return false;
        } else if (statusFilter !== 'ALL' && r.status !== statusFilter) {
          return false;
        }
        if (searchQuery.trim()) {
          const q = searchQuery.trim().toLowerCase();
          const matchDate = (r.date || '').toLowerCase().includes(q);
          const matchNotes = (r.notes || '').toLowerCase().includes(q);
          const matchStatus = (r.status || '').toLowerCase().includes(q);
          const matchOnCall = (r.on_call || '').toLowerCase().includes(q);
          if (!matchDate && !matchNotes && !matchStatus && !matchOnCall) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) =>
        sortDesc ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)
      );
  }, [records, statusFilter, searchQuery, sortDesc]);

  return (
    <ScrollView
      style={[styles.container, isDark && styles.containerDark]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={() => loadData(month)} />
      }
    >
      {/* Month Switcher Card */}
      <View style={[styles.card, isDark && styles.cardDark]}>
        <View style={styles.headerTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, isDark && styles.textPrimaryDark]}>
              {formatMonthLabel(month)}
            </Text>
            <Text style={[styles.headerSub, isDark && styles.textSecondaryDark]}>
              Working days exclude Sat/Sun, Leaves & Public Holidays
            </Text>
          </View>

          <View style={styles.navGroup}>
            <TouchableOpacity
              style={[styles.navBtn, isDark && styles.navBtnDark]}
              onPress={() => setMonth(shiftMonth(month, -1))}
            >
              <Text
                style={[styles.navBtnText, isDark && styles.textPrimaryDark]}
              >
                Prev
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.navBtn, isDark && styles.navBtnDark]}
              onPress={() => setMonth(shiftMonth(month, 1))}
            >
              <Text
                style={[styles.navBtnText, isDark && styles.textPrimaryDark]}
              >
                Next
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {availableMonths.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginTop: 10 }}
            contentContainerStyle={{ gap: 6 }}
          >
            {availableMonths.map((m) => {
              const active = m === month;
              return (
                <TouchableOpacity
                  key={m}
                  style={[
                    styles.filterChip,
                    isDark && styles.filterChipDark,
                    active &&
                      (isDark
                        ? styles.filterChipActiveDark
                        : styles.filterChipActive),
                  ]}
                  onPress={() => setMonth(m)}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      isDark && styles.textSecondaryDark,
                      active &&
                        (isDark
                          ? styles.filterChipTextActiveDark
                          : styles.filterChipTextActive),
                    ]}
                  >
                    {m}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* Key Metrics Grid */}
      <View style={styles.metricsGrid}>
        <View
          style={[
            styles.metricCard,
            styles.metricCardWide,
            isDark && styles.cardDark,
          ]}
        >
          <Text style={[styles.metricLabel, isDark && styles.textSecondaryDark]}>
            WORKING DAYS
          </Text>
          <Text style={[styles.metricVal, isDark && styles.textPrimaryDark]}>
            {totalWorkingDays}{' '}
            <Text style={styles.metricUnit}>days</Text>
          </Text>
          <Text style={[styles.metricSub, isDark && styles.textSecondaryDark]}>
            Excludes Sat, Sun, Leave & Public Holidays
          </Text>
        </View>

        <View style={[styles.metricCard, isDark && styles.cardDark]}>
          <Text style={[styles.metricLabel, isDark && styles.textSecondaryDark]}>
            WFO (OFFICE)
          </Text>
          <View style={styles.metricRowBetween}>
            <Text
              style={[
                styles.metricVal,
                { color: isDark ? '#60a5fa' : '#2563eb' },
              ]}
            >
              {wfo}
            </Text>
            <Text
              style={[
                styles.pctInline,
                { color: isDark ? '#60a5fa' : '#1d4ed8' },
              ]}
            >
              {wfoPercent}%
            </Text>
          </View>
          <Text style={[styles.metricSub, isDark && styles.textSecondaryDark]}>
            Of {totalWorkingDays} working days
          </Text>
        </View>

        <View style={[styles.metricCard, isDark && styles.cardDark]}>
          <Text style={[styles.metricLabel, isDark && styles.textSecondaryDark]}>
            WFH (HOME)
          </Text>
          <View style={styles.metricRowBetween}>
            <Text
              style={[
                styles.metricVal,
                { color: isDark ? '#34d399' : '#059669' },
              ]}
            >
              {wfh}
            </Text>
            <Text
              style={[
                styles.pctInline,
                { color: isDark ? '#34d399' : '#047857' },
              ]}
            >
              {wfhPercent}%
            </Text>
          </View>
          <Text style={[styles.metricSub, isDark && styles.textSecondaryDark]}>
            Of {totalWorkingDays} working days
          </Text>
        </View>

        <View style={[styles.metricCard, isDark && styles.cardDark]}>
          <Text style={[styles.metricLabel, isDark && styles.textSecondaryDark]}>
            PUBLIC HOLIDAY
          </Text>
          <View style={styles.metricRowBetween}>
            <Text
              style={[
                styles.metricVal,
                { color: isDark ? '#fbbf24' : '#d97706' },
              ]}
            >
              {holidayCount}
            </Text>
            <Text
              style={[
                styles.pctInline,
                { color: isDark ? '#fbbf24' : '#b45309' },
              ]}
            >
              {holidayPercent}%
            </Text>
          </View>
          <Text style={[styles.metricSub, isDark && styles.textSecondaryDark]}>
            Excluded from working days
          </Text>
        </View>

        <View style={[styles.metricCard, isDark && styles.cardDark]}>
          <Text style={[styles.metricLabel, isDark && styles.textSecondaryDark]}>
            LEAVE
          </Text>
          <View style={styles.metricRowBetween}>
            <Text
              style={[
                styles.metricVal,
                { color: isDark ? '#fb7185' : '#e11d48' },
              ]}
            >
              {leaveCount}
            </Text>
            <Text
              style={[
                styles.pctInline,
                { color: isDark ? '#fb7185' : '#be123c' },
              ]}
            >
              {leavePercent}%
            </Text>
          </View>
          <Text style={[styles.metricSub, isDark && styles.textSecondaryDark]}>
            Excluded from working days
          </Text>
        </View>

        <View style={[styles.metricCard, isDark && styles.cardDark]}>
          <Text style={[styles.metricLabel, isDark && styles.textSecondaryDark]}>
            NSA
          </Text>
          <Text style={[styles.metricVal, isDark && styles.textPrimaryDark]}>
            {nsaCount}
          </Text>
          <Text style={[styles.metricSub, isDark && styles.textSecondaryDark]}>
            Night shift allowance
          </Text>
        </View>

        <View style={[styles.metricCard, isDark && styles.cardDark]}>
          <Text style={[styles.metricLabel, isDark && styles.textSecondaryDark]}>
            ON CALL
          </Text>
          <Text style={[styles.metricVal, isDark && styles.textPrimaryDark]}>
            {onCallCount}
          </Text>
          <Text style={[styles.metricSub, isDark && styles.textSecondaryDark]}>
            Logged on-call shifts
          </Text>
        </View>
      </View>

      {/* Summary Breakdown & Working Days Derivation */}
      <View style={[styles.card, isDark && styles.cardDark]}>
        <Text
          style={[styles.sectionHeaderLabel, isDark && styles.textSecondaryDark]}
        >
          WORKING DAYS DISTRIBUTION
        </Text>

        <View style={[styles.barTrack, isDark && styles.barTrackDark]}>
          {wfo > 0 && (
            <View
              style={[styles.barSlice, { flex: wfo, backgroundColor: '#2563eb' }]}
            />
          )}
          {wfh > 0 && (
            <View
              style={[styles.barSlice, { flex: wfh, backgroundColor: '#059669' }]}
            />
          )}
          {unmarked > 0 && (
            <View
              style={[
                styles.barSlice,
                {
                  flex: unmarked,
                  backgroundColor: isDark ? '#3f3f46' : '#e4e4e7',
                },
              ]}
            />
          )}
        </View>

        <View style={styles.formulaRows}>
          <View style={[styles.formulaRow, isDark && styles.formulaRowDark]}>
            <Text style={[styles.formulaKey, isDark && styles.textSecondaryDark]}>
              Calendar Days in Month
            </Text>
            <Text style={[styles.formulaVal, isDark && styles.textPrimaryDark]}>
              {summary.calendar_days || 0}
            </Text>
          </View>
          <View style={[styles.formulaRow, isDark && styles.formulaRowDark]}>
            <Text style={[styles.formulaKey, isDark && styles.textSecondaryDark]}>
              Less Weekends (Sat & Sun)
            </Text>
            <Text style={[styles.formulaVal, isDark && styles.textPrimaryDark]}>
              -{summary.weekend_days || 0}
            </Text>
          </View>
          <View style={[styles.formulaRow, isDark && styles.formulaRowDark]}>
            <Text style={[styles.formulaKey, isDark && styles.textSecondaryDark]}>
              Less Public Holidays (Weekdays)
            </Text>
            <Text
              style={[
                styles.formulaVal,
                { color: isDark ? '#fbbf24' : '#d97706' },
              ]}
            >
              -{holidayCount}
            </Text>
          </View>
          <View style={[styles.formulaRow, isDark && styles.formulaRowDark]}>
            <Text style={[styles.formulaKey, isDark && styles.textSecondaryDark]}>
              Less Leave Days (Weekdays)
            </Text>
            <Text
              style={[
                styles.formulaVal,
                { color: isDark ? '#fb7185' : '#e11d48' },
              ]}
            >
              -{leaveCount}
            </Text>
          </View>
          <View
            style={[
              styles.formulaRow,
              styles.formulaTotalRow,
              isDark && styles.formulaTotalRowDark,
            ]}
          >
            <Text
              style={[
                styles.formulaTotalKey,
                isDark && styles.formulaTotalKeyDark,
              ]}
            >
              Total Working Days
            </Text>
            <Text
              style={[
                styles.formulaTotalVal,
                isDark && styles.formulaTotalKeyDark,
              ]}
            >
              {totalWorkingDays} days
            </Text>
          </View>
        </View>
      </View>

      {/* Public Holiday Reference */}
      {holidaysRef.length > 0 && (
        <View style={[styles.card, isDark && styles.cardDark]}>
          <Text
            style={[
              styles.sectionHeaderLabel,
              isDark && styles.textSecondaryDark,
            ]}
          >
            PUBLIC HOLIDAY REFERENCE ({holidaysRef.length})
          </Text>
          <View style={{ marginTop: 8, gap: 6 }}>
            {holidaysRef.map((h) => (
              <View
                key={h.date}
                style={[styles.formulaRow, isDark && styles.formulaRowDark]}
              >
                <Text
                  style={[styles.formulaKey, isDark && styles.textSecondaryDark]}
                >
                  {h.date}
                </Text>
                <Text
                  style={[styles.formulaVal, isDark && styles.textPrimaryDark]}
                >
                  {h.name}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Filterable Monthly Attendance Sheet */}
      <View style={[styles.card, isDark && styles.cardDark]}>
        <View style={styles.logHeaderRow}>
          <Text
            style={[
              styles.sectionHeaderLabel,
              isDark && styles.textSecondaryDark,
            ]}
          >
            MONTHLY ATTENDANCE SHEET ({filteredRecords.length})
          </Text>
          <TouchableOpacity
            style={[styles.sortBtn, isDark && styles.navBtnDark]}
            onPress={() => setSortDesc((v) => !v)}
          >
            <Text
              style={[styles.sortBtnText, isDark && styles.textPrimaryDark]}
            >
              {sortDesc ? 'Newest First' : 'Date Asc'}
            </Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={[styles.searchInput, isDark && styles.searchInputDark]}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search date, description, or status..."
          placeholderTextColor="#71717a"
        />

        <View style={styles.filterGroup}>
          {[
            { id: 'ALL', label: 'All' },
            { id: 'WFO', label: 'WFO' },
            { id: 'WFH', label: 'WFH' },
            { id: 'HOLIDAY', label: 'Holiday' },
            { id: 'LEAVE', label: 'Leave' },
            { id: 'ONCALL', label: 'On Call' },
          ].map((tab) => {
            const active = statusFilter === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[
                  styles.filterChip,
                  isDark && styles.filterChipDark,
                  active &&
                    (isDark
                      ? styles.filterChipActiveDark
                      : styles.filterChipActive),
                ]}
                onPress={() => setStatusFilter(tab.id)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    isDark && styles.textSecondaryDark,
                    active &&
                      (isDark
                        ? styles.filterChipTextActiveDark
                        : styles.filterChipTextActive),
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {filteredRecords.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={[styles.emptyText, isDark && styles.textSecondaryDark]}>
              No attendance records match the current filters.
            </Text>
          </View>
        ) : (
          filteredRecords.map((item, idx) => (
            <View
              key={item.date}
              style={[
                styles.recentRow,
                idx > 0 &&
                  (isDark ? styles.recentRowBorderDark : styles.recentRowBorder),
              ]}
            >
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text
                  style={[styles.recentDate, isDark && styles.textPrimaryDark]}
                >
                  {formatDateReadable(item.date)}
                </Text>
                <Text
                  style={[styles.recentMeta, isDark && styles.textSecondaryDark]}
                >
                  Login: {formatTime24(item.check_in_time)} | Logout:{' '}
                  {formatTime24(item.check_out_time)}
                  {item.nsa ? ` | NSA: ${item.nsa}` : ''}
                  {item.on_call ? ` | ON Call: ${item.on_call}` : ''}
                </Text>
                {(item.notes || item.remarks) && (
                  <Text
                    style={[
                      styles.recentNotes,
                      isDark && styles.textSecondaryDark,
                    ]}
                  >
                    {item.notes || ''}
                    {item.remarks ? ` [${item.remarks}]` : ''}
                  </Text>
                )}
              </View>
              <StatusBadge status={item.status} isDark={isDark} />
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fafafa',
  },
  containerDark: {
    backgroundColor: '#09090b',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e4e4e7',
  },
  cardDark: {
    backgroundColor: '#18181b',
    borderColor: '#27272a',
  },
  textPrimaryDark: {
    color: '#f4f4f5',
  },
  textSecondaryDark: {
    color: '#a1a1aa',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#18181b',
  },
  headerSub: {
    fontSize: 11,
    color: '#71717a',
    marginTop: 2,
  },
  navGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  navBtn: {
    borderWidth: 1,
    borderColor: '#e4e4e7',
    borderRadius: 6,
    paddingHorizontal: 10,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fafafa',
  },
  navBtnDark: {
    borderColor: '#3f3f46',
    backgroundColor: '#27272a',
  },
  navBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#27272a',
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
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metricCard: {
    flex: 1,
    minWidth: '46%',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e4e4e7',
  },
  metricCardWide: {
    minWidth: '100%',
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#71717a',
    letterSpacing: 0.5,
  },
  metricRowBetween: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  metricVal: {
    fontSize: 22,
    fontWeight: '600',
    color: '#18181b',
    marginTop: 2,
  },
  metricUnit: {
    fontSize: 12,
    fontWeight: '400',
    color: '#71717a',
  },
  metricSub: {
    fontSize: 10,
    color: '#71717a',
    marginTop: 3,
  },
  pctInline: {
    fontSize: 12,
    fontWeight: '600',
  },
  sectionHeaderLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#71717a',
    letterSpacing: 0.6,
  },
  barTrack: {
    flexDirection: 'row',
    height: 6,
    width: '100%',
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: '#f4f4f5',
    marginTop: 10,
    marginBottom: 8,
  },
  barTrackDark: {
    backgroundColor: '#27272a',
  },
  barSlice: {
    height: '100%',
  },
  formulaRows: {
    gap: 4,
    marginTop: 4,
  },
  formulaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f4f4f5',
  },
  formulaRowDark: {
    borderBottomColor: '#27272a',
  },
  formulaKey: {
    fontSize: 12,
    color: '#52525b',
  },
  formulaVal: {
    fontSize: 12,
    fontWeight: '600',
    color: '#18181b',
  },
  formulaTotalRow: {
    backgroundColor: '#18181b',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 4,
    borderBottomWidth: 0,
  },
  formulaTotalRowDark: {
    backgroundColor: '#f4f4f5',
  },
  formulaTotalKey: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ffffff',
  },
  formulaTotalKeyDark: {
    color: '#09090b',
  },
  formulaTotalVal: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  logHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sortBtn: {
    borderWidth: 1,
    borderColor: '#e4e4e7',
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#fafafa',
  },
  sortBtnText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#27272a',
  },
  searchInput: {
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#e4e4e7',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 12,
    color: '#18181b',
    marginBottom: 8,
  },
  searchInputDark: {
    backgroundColor: '#09090b',
    borderColor: '#3f3f46',
    color: '#f4f4f5',
  },
  filterGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  filterChip: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#e4e4e7',
    backgroundColor: '#fafafa',
  },
  filterChipDark: {
    borderColor: '#3f3f46',
    backgroundColor: '#27272a',
  },
  filterChipActive: {
    backgroundColor: '#18181b',
    borderColor: '#18181b',
  },
  filterChipActiveDark: {
    backgroundColor: '#f4f4f5',
    borderColor: '#f4f4f5',
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#52525b',
  },
  filterChipTextActive: {
    color: '#ffffff',
  },
  filterChipTextActiveDark: {
    color: '#09090b',
  },
  emptyBox: {
    marginTop: 8,
    paddingVertical: 16,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 12,
    color: '#71717a',
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  recentRowBorder: {
    borderTopWidth: 1,
    borderTopColor: '#f4f4f5',
  },
  recentRowBorderDark: {
    borderTopWidth: 1,
    borderTopColor: '#27272a',
  },
  recentDate: {
    fontSize: 12,
    fontWeight: '600',
    color: '#18181b',
  },
  recentMeta: {
    fontSize: 11,
    color: '#71717a',
    marginTop: 2,
  },
  recentNotes: {
    fontSize: 11,
    color: '#52525b',
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
});

module.exports = DashboardScreen;
