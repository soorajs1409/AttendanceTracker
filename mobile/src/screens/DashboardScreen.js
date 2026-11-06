const React = require('react');
const { useState, useEffect, useCallback } = React;
const {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  StyleSheet,
  ActivityIndicator,
} = require('react-native');
const { WebView } = require('react-native-webview');
const {
  fetchHistory,
  formatTime12h,
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

function StatusBadge({ status }) {
  let bg = '#f1f5f9';
  let fg = '#334155';
  if (status === 'WFO') {
    bg = '#dbeafe';
    fg = '#1e40af';
  } else if (status === 'WFH') {
    bg = '#d1fae5';
    fg = '#065f46';
  } else if (status === 'LEAVE') {
    bg = '#ffe4e6';
    fg = '#9f1239';
  }

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{status}</Text>
    </View>
  );
}

function PieChartSection({ wfo, wfh, leave, total }) {
  if (!total || total === 0) {
    return (
      <View style={styles.emptyChartBox}>
        <Text style={styles.emptyChartText}>
          No attendance records for this month yet.
        </Text>
      </View>
    );
  }

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

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            display: flex;
            align-items: center;
            justify-content: center;
            background: #ffffff;
            height: 100vh;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          }
          .container { position: relative; width: 170px; height: 170px; }
          svg { width: 100%; height: 100%; transform: rotate(-90deg); }
          .center {
            position: absolute;
            inset: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
          }
          .total { font-size: 24px; font-weight: 800; color: #0f172a; }
          .sub { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #64748b; }
        </style>
      </head>
      <body>
        <div class="container">
          <svg viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="${r}" fill="none" stroke="#f1f5f9" stroke-width="22" />
            ${wfo > 0 ? `<circle cx="50" cy="50" r="${r}" fill="none" stroke="#2563eb" stroke-width="22" stroke-dasharray="${wfoLen} ${circumference}" stroke-dashoffset="${wfoOffset}" />` : ''}
            ${wfh > 0 ? `<circle cx="50" cy="50" r="${r}" fill="none" stroke="#10b981" stroke-width="22" stroke-dasharray="${wfhLen} ${circumference}" stroke-dashoffset="${wfhOffset}" />` : ''}
            ${leave > 0 ? `<circle cx="50" cy="50" r="${r}" fill="none" stroke="#f43f5e" stroke-width="22" stroke-dasharray="${leaveLen} ${circumference}" stroke-dashoffset="${leaveOffset}" />` : ''}
          </svg>
          <div class="center">
            <div class="total">${total}</div>
            <div class="sub">Days</div>
          </div>
        </div>
      </body>
    </html>
  `;

  return (
    <View style={styles.chartWrapper}>
      <View style={styles.webViewContainer}>
        <WebView
          originWhitelist={['*']}
          source={{ html }}
          style={styles.webView}
          scrollEnabled={false}
        />
      </View>

      {/* Segmented bar visual */}
      <View style={styles.barTrack}>
        {wfo > 0 && <View style={[styles.barSlice, { flex: wfo, backgroundColor: '#2563eb' }]} />}
        {wfh > 0 && <View style={[styles.barSlice, { flex: wfh, backgroundColor: '#10b981' }]} />}
        {leave > 0 && <View style={[styles.barSlice, { flex: leave, backgroundColor: '#f43f5e' }]} />}
      </View>

      {/* Legend */}
      <View style={styles.legendContainer}>
        <View style={styles.legendRow}>
          <View style={styles.legendLeft}>
            <View style={[styles.legendDot, { backgroundColor: '#2563eb' }]} />
            <Text style={styles.legendLabel}>WFO (Office)</Text>
          </View>
          <Text style={styles.legendVal}>{wfo} days ({wfoPct}%)</Text>
        </View>

        <View style={styles.legendRow}>
          <View style={styles.legendLeft}>
            <View style={[styles.legendDot, { backgroundColor: '#10b981' }]} />
            <Text style={styles.legendLabel}>WFH (Home)</Text>
          </View>
          <Text style={styles.legendVal}>{wfh} days ({wfhPct}%)</Text>
        </View>

        <View style={styles.legendRow}>
          <View style={styles.legendLeft}>
            <View style={[styles.legendDot, { backgroundColor: '#f43f5e' }]} />
            <Text style={styles.legendLabel}>Leave</Text>
          </View>
          <Text style={styles.legendVal}>{leave} days ({leavePct}%)</Text>
        </View>
      </View>
    </View>
  );
}

function DashboardScreen({ statusData }) {
  const todayDateStr =
    statusData?.today?.date || new Date().toISOString().slice(0, 10);
  const defaultMonth = todayDateStr.slice(0, 7);

  const [month, setMonth] = useState(defaultMonth);
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

  const wfoRatio = total > 0 ? (wfo / total).toFixed(2) : '0.00';
  const wfhRatio = total > 0 ? (wfh / total).toFixed(2) : '0.00';
  const leaveRatio = total > 0 ? (leave / total).toFixed(2) : '0.00';
  const wfoToWfh = wfh > 0 ? (wfo / wfh).toFixed(2) : wfo > 0 ? `${wfo}:0` : '0:0';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={() => loadData(month)} />
      }
    >
      {/* Month Switcher Header */}
      <View style={styles.headerCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{formatMonthLabel(month)}</Text>
          <Text style={styles.headerSub}>Monthly Statistics & Pie Chart</Text>
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
            onPress={() => setMonth(defaultMonth)}
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

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* 4 Primary Metric Cards */}
      <View style={styles.metricsGrid}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>WFO (Office)</Text>
          <Text style={[styles.metricVal, { color: '#2563eb' }]}>{wfo}</Text>
          <Text style={styles.metricSub}>{summary.wfo_percent || 0}% • ratio {wfoRatio}</Text>
        </View>

        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>WFH (Home)</Text>
          <Text style={[styles.metricVal, { color: '#059669' }]}>{wfh}</Text>
          <Text style={styles.metricSub}>{summary.wfh_percent || 0}% • ratio {wfhRatio}</Text>
        </View>

        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Leave</Text>
          <Text style={[styles.metricVal, { color: '#e11d48' }]}>{leave}</Text>
          <Text style={styles.metricSub}>{summary.leave_percent || 0}% • ratio {leaveRatio}</Text>
        </View>

        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Total Tracked</Text>
          <Text style={[styles.metricVal, { color: '#0f172a' }]}>{total}</Text>
          <Text style={styles.metricSub}>WFO:WFH {wfoToWfh}</Text>
        </View>
      </View>

      {/* Pie Chart Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Attendance Pie Chart</Text>
        <Text style={styles.cardSub}>Percentage and ratio breakdown</Text>
        <PieChartSection wfo={wfo} wfh={wfh} leave={leave} total={total} />
      </View>

      {/* Ratios & Necessary Statistics */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Monthly Ratios & Metrics</Text>
        <View style={styles.ratioRows}>
          <View style={styles.ratioRow}>
            <Text style={styles.ratioKey}>Work from Office Ratio</Text>
            <Text style={[styles.ratioVal, { color: '#2563eb' }]}>
              {wfoRatio} ({wfo}/{total || 1})
            </Text>
          </View>
          <View style={styles.ratioRow}>
            <Text style={styles.ratioKey}>Work from Home Ratio</Text>
            <Text style={[styles.ratioVal, { color: '#059669' }]}>
              {wfhRatio} ({wfh}/{total || 1})
            </Text>
          </View>
          <View style={styles.ratioRow}>
            <Text style={styles.ratioKey}>Leave Ratio</Text>
            <Text style={[styles.ratioVal, { color: '#e11d48' }]}>
              {leaveRatio} ({leave}/{total || 1})
            </Text>
          </View>
          <View style={styles.ratioRow}>
            <Text style={styles.ratioKey}>Office vs Remote (WFO : WFH)</Text>
            <Text style={styles.ratioVal}>{wfoToWfh}</Text>
          </View>
        </View>
      </View>

      {/* Days Logged in this Month */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Days in {formatMonthLabel(month)} ({records.length})</Text>

        {records.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No attendance records for this month.</Text>
          </View>
        ) : (
          records.map((item, idx) => (
            <View
              key={item.date}
              style={[
                styles.recentRow,
                idx > 0 && styles.recentRowBorder,
              ]}
            >
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={styles.recentDate}>
                  {formatDateReadable(item.date)}
                </Text>
                <Text style={styles.recentMeta} numberOfLines={1}>
                  {item.check_in_time
                    ? `Arrival: ${formatTime12h(item.check_in_time)}`
                    : 'No arrival time logged'}{' '}
                  • {item.trigger_type || 'MANUAL'}
                  {item.notes ? ` — "${item.notes}"` : ''}
                </Text>
              </View>
              <StatusBadge status={item.status} />
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
    backgroundColor: '#f8fafc',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 14,
  },
  headerCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  headerSub: {
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
    borderRadius: 8,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#334155',
  },
  todayBtn: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 8,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  errorBox: {
    backgroundColor: '#fff1f2',
    borderColor: '#fecdd3',
    borderWidth: 1,
    padding: 10,
    borderRadius: 10,
  },
  errorText: {
    color: '#9f1239',
    fontSize: 12,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
  },
  metricVal: {
    fontSize: 22,
    fontWeight: '800',
    marginTop: 2,
  },
  metricSub: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 2,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  cardSub: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
    marginBottom: 10,
  },
  chartWrapper: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  webViewContainer: {
    width: 170,
    height: 170,
    borderRadius: 85,
    overflow: 'hidden',
  },
  webView: {
    width: 170,
    height: 170,
    backgroundColor: 'transparent',
  },
  barTrack: {
    flexDirection: 'row',
    height: 8,
    width: '100%',
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#f1f5f9',
    marginTop: 14,
    marginBottom: 10,
  },
  barSlice: {
    height: '100%',
  },
  emptyChartBox: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyChartText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  legendContainer: {
    width: '100%',
    gap: 8,
    marginTop: 4,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  legendLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 3,
  },
  legendLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  legendVal: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  ratioRows: {
    gap: 8,
    marginTop: 4,
  },
  ratioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
  },
  ratioKey: {
    fontSize: 12,
    color: '#64748b',
  },
  ratioVal: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  emptyBox: {
    marginTop: 8,
    paddingVertical: 16,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  recentRowBorder: {
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  recentDate: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },
  recentMeta: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
});

module.exports = DashboardScreen;
