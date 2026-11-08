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
  let border = '#e2e8f0';
  let label = status || 'UNMARKED';

  if (status === 'WFO') {
    bg = '#eff6ff';
    fg = '#1d4ed8';
    border = '#bfdbfe';
  } else if (status === 'WFH') {
    bg = '#ecfdf5';
    fg = '#047857';
    border = '#a7f3d0';
  } else if (status === 'LEAVE') {
    bg = '#fff1f2';
    fg = '#be123c';
    border = '#fecdd3';
  } else if (status === 'HOLIDAY') {
    bg = '#f5f3ff';
    fg = '#6d28d9';
    border = '#ddd6fe';
    label = 'PUBLIC HOLIDAY';
  }

  return (
    <View style={[styles.badge, { backgroundColor: bg, borderColor: border }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

/**
 * Interactive minimalist range slider control built with native Views & touch targets.
 */
function StepSlider({
  label,
  valueLabel,
  value,
  min,
  max,
  step = 1,
  accentColor = '#0f172a',
  onChange,
  presets,
}) {
  const safeMax = Math.max(min + step, max);
  const pct = Math.min(100, Math.max(0, ((value - min) / (safeMax - min)) * 100));

  function clamp(next) {
    return Math.min(max, Math.max(min, next));
  }

  return (
    <View style={styles.sliderBox}>
      <View style={styles.sliderHeader}>
        <Text style={styles.sliderLabel}>{label}</Text>
        <View style={[styles.sliderValuePill, { backgroundColor: accentColor }]}>
          <Text style={styles.sliderValueText}>{valueLabel}</Text>
        </View>
      </View>

      <View style={styles.sliderControlRow}>
        <TouchableOpacity
          style={styles.stepBtn}
          onPress={() => onChange(clamp(value - step))}
        >
          <Text style={styles.stepBtnText}>-</Text>
        </TouchableOpacity>

        <View style={styles.sliderTrack}>
          <View
            style={[
              styles.sliderFill,
              { width: `${pct}%`, backgroundColor: accentColor },
            ]}
          />
        </View>

        <TouchableOpacity
          style={styles.stepBtn}
          onPress={() => onChange(clamp(value + step))}
        >
          <Text style={styles.stepBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      {Array.isArray(presets) && presets.length > 0 ? (
        <View style={styles.presetPillRow}>
          {presets.map((p) => {
            const active = value === p.value;
            return (
              <TouchableOpacity
                key={String(p.label)}
                style={[styles.presetPill, active && styles.presetPillActive]}
                onPress={() => onChange(p.value)}
              >
                <Text
                  style={[
                    styles.presetPillText,
                    active && styles.presetPillTextActive,
                  ]}
                >
                  {p.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function WorkingDaysDistributionSection({
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
      <View style={styles.emptyChartBox}>
        <Text style={styles.emptyChartText}>
          No active working days in this period.
        </Text>
      </View>
    );
  }

  const r = 35;
  const circumference = 2 * Math.PI * r;
  const wfoLen = Math.min(1, wfo / totalWorkingDays) * circumference;
  const wfhLen = Math.min(1, wfh / totalWorkingDays) * circumference;
  const wfoOffset = 0;
  const wfhOffset = -wfoLen;
  const unmarkedPct = Math.max(
    0,
    Math.round((100 - wfoPercent - wfhPercent) * 10) / 10
  );

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
          .container { position: relative; width: 164px; height: 164px; }
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
          .sub { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #64748b; margin-top: 2px; }
        </style>
      </head>
      <body>
        <div class="container">
          <svg viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="${r}" fill="none" stroke="#f1f5f9" stroke-width="18" />
            ${wfo > 0 ? `<circle cx="50" cy="50" r="${r}" fill="none" stroke="#2563eb" stroke-width="18" stroke-dasharray="${wfoLen} ${circumference}" stroke-dashoffset="${wfoOffset}" />` : ''}
            ${wfh > 0 ? `<circle cx="50" cy="50" r="${r}" fill="none" stroke="#059669" stroke-width="18" stroke-dasharray="${wfhLen} ${circumference}" stroke-dashoffset="${wfhOffset}" />` : ''}
          </svg>
          <div class="center">
            <div class="total">${totalWorkingDays}</div>
            <div class="sub">Working Days</div>
          </div>
        </div>
      </body>
    </html>
  `;

  return (
    <View style={styles.chartWrapper}>
      {chartStyle === 'donut' ? (
        <View style={styles.webViewContainer}>
          <WebView
            originWhitelist={['*']}
            source={{ html }}
            style={styles.webView}
            scrollEnabled={false}
          />
        </View>
      ) : null}

      {/* Segmented bar visual over working days */}
      <View style={styles.barTrack}>
        {wfo > 0 && (
          <View
            style={[
              styles.barSlice,
              { flex: wfo, backgroundColor: '#2563eb' },
            ]}
          />
        )}
        {wfh > 0 && (
          <View
            style={[
              styles.barSlice,
              { flex: wfh, backgroundColor: '#059669' },
            ]}
          />
        )}
        {unmarked > 0 && (
          <View
            style={[
              styles.barSlice,
              { flex: unmarked, backgroundColor: '#e2e8f0' },
            ]}
          />
        )}
      </View>

      {/* Legend */}
      <View style={styles.legendContainer}>
        <View style={styles.legendRow}>
          <View style={styles.legendLeft}>
            <View style={[styles.legendDot, { backgroundColor: '#2563eb' }]} />
            <Text style={styles.legendLabel}>Work from Office (WFO)</Text>
          </View>
          <Text style={styles.legendVal}>
            {wfo} days ({wfoPercent}%)
          </Text>
        </View>

        <View style={styles.legendRow}>
          <View style={styles.legendLeft}>
            <View style={[styles.legendDot, { backgroundColor: '#059669' }]} />
            <Text style={styles.legendLabel}>Work from Home (WFH)</Text>
          </View>
          <Text style={styles.legendVal}>
            {wfh} days ({wfhPercent}%)
          </Text>
        </View>

        <View style={[styles.legendRow, { borderBottomWidth: 0 }]}>
          <View style={styles.legendLeft}>
            <View style={[styles.legendDot, { backgroundColor: '#cbd5e1' }]} />
            <Text style={styles.legendLabel}>Unlogged Working Days</Text>
          </View>
          <Text style={styles.legendVal}>
            {unmarked} days ({unmarkedPct}%)
          </Text>
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
  const [showCustomize, setShowCustomize] = useState(false);
  const [targetWfoPercent, setTargetWfoPercent] = useState(60);
  const [chartStyle, setChartStyle] = useState('donut');
  const [showTargetPlanner, setShowTargetPlanner] = useState(true);
  const [showDistribution, setShowDistribution] = useState(true);
  const [showBreakdown, setShowBreakdown] = useState(true);
  const [showLogTable, setShowLogTable] = useState(true);

  const [customWorkingDays, setCustomWorkingDays] = useState(null);
  const [simulatedExtraWfo, setSimulatedExtraWfo] = useState(0);

  // Activity Log Filters
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [triggerFilter, setTriggerFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortDesc, setSortDesc] = useState(true);

  const loadData = useCallback(async (targetMonth) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHistory(targetMonth);
      setHistoryData(data);
      setCustomWorkingDays(null);
      setSimulatedExtraWfo(0);
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

  const requiredWfoDays = Math.ceil(
    (targetWfoPercent / 100) * effectiveWorkingDays
  );
  const remainingWfoToTarget = Math.max(0, requiredWfoDays - effectiveWfo);
  const targetMet = effectiveWfo >= requiredWfoDays;

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
        sortDesc ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)
      );
  }, [records, statusFilter, triggerFilter, searchQuery, sortDesc]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={() => loadData(month)} />
      }
    >
      {/* Month Switcher & Customize Header */}
      <View style={styles.headerCard}>
        <View style={styles.headerTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>{formatMonthLabel(month)}</Text>
            <Text style={styles.headerSub}>
              Working days exclude Sat/Sun, Leaves & Public Holidays
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
              onPress={() => setMonth(defaultMonth)}
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

        <View style={styles.headerActionRow}>
          <TouchableOpacity
            style={[
              styles.customizeToggleBtn,
              showCustomize && styles.customizeToggleBtnActive,
            ]}
            onPress={() => setShowCustomize((v) => !v)}
          >
            <Text
              style={[
                styles.customizeToggleText,
                showCustomize && styles.customizeToggleTextActive,
              ]}
            >
              {showCustomize ? 'Hide Customization' : 'Customize Dashboard'}
            </Text>
          </TouchableOpacity>

          {(customWorkingDays !== null || simulatedExtraWfo > 0) && (
            <TouchableOpacity
              style={styles.resetSimBtn}
              onPress={() => {
                setCustomWorkingDays(null);
                setSimulatedExtraWfo(0);
              }}
            >
              <Text style={styles.resetSimText}>Reset Simulation</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Customizable Sliders & Controls Panel */}
      {showCustomize && (
        <View style={styles.card}>
          <Text style={styles.sectionHeaderLabel}>
            DASHBOARD CUSTOMIZATION & SLIDERS
          </Text>

          <View style={{ gap: 12, marginTop: 8 }}>
            <StepSlider
              label="Target WFO Policy (%)"
              valueLabel={`${targetWfoPercent}%`}
              value={targetWfoPercent}
              min={0}
              max={100}
              step={5}
              accentColor="#0f172a"
              onChange={setTargetWfoPercent}
              presets={[
                { label: '40%', value: 40 },
                { label: '50%', value: 50 },
                { label: '60%', value: 60 },
                { label: '80%', value: 80 },
                { label: '100%', value: 100 },
              ]}
            />

            <StepSlider
              label="Simulate Additional WFO Days"
              valueLabel={`+${simulatedExtraWfo}d`}
              value={simulatedExtraWfo}
              min={0}
              max={Math.max(0, effectiveWorkingDays - rawWfo - rawWfh)}
              step={1}
              accentColor="#2563eb"
              onChange={setSimulatedExtraWfo}
            />

            <StepSlider
              label="Working Days Denominator"
              valueLabel={`${effectiveWorkingDays}d ${
                customWorkingDays === null ? '(Auto)' : '(Custom)'
              }`}
              value={effectiveWorkingDays || 1}
              min={1}
              max={summary.calendar_days || 31}
              step={1}
              accentColor="#475569"
              onChange={setCustomWorkingDays}
              presets={[
                { label: `Auto (${baseWorkingDays}d)`, value: baseWorkingDays },
                { label: '20d', value: 20 },
                { label: '22d', value: 22 },
              ]}
            />
          </View>

          <Text style={[styles.sectionHeaderLabel, { marginTop: 14 }]}>
            VISIBLE SECTIONS & CHART VIEW
          </Text>
          <View style={styles.toggleChipsWrap}>
            {[
              {
                id: 'planner',
                label: 'WFO Target',
                active: showTargetPlanner,
                toggle: () => setShowTargetPlanner((v) => !v),
              },
              {
                id: 'dist',
                label: 'Distribution',
                active: showDistribution,
                toggle: () => setShowDistribution((v) => !v),
              },
              {
                id: 'breakdown',
                label: 'Formula',
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
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.filterChip,
                  item.active && styles.filterChipActive,
                ]}
                onPress={item.toggle}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    item.active && styles.filterChipTextActive,
                  ]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={[styles.toggleChipsWrap, { marginTop: 8 }]}>
            {[
              { id: 'donut', label: 'Donut View' },
              { id: 'bar', label: 'Bar View' },
            ].map((mode) => {
              const active = chartStyle === mode.id;
              return (
                <TouchableOpacity
                  key={mode.id}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  onPress={() => setChartStyle(mode.id)}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      active && styles.filterChipTextActive,
                    ]}
                  >
                    {mode.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* 5 Primary Metric Cards: Working Days, WFO, WFH, Leave, Public Holidays */}
      <View style={styles.metricsGrid}>
        <View style={[styles.metricCard, styles.metricCardWide]}>
          <Text style={styles.metricLabel}>TOTAL WORKING DAYS</Text>
          <Text style={[styles.metricVal, { color: '#0f172a' }]}>
            {effectiveWorkingDays}{' '}
            <Text style={styles.metricUnit}>days</Text>
          </Text>
          <Text style={styles.metricSub}>
            Excludes Sat, Sun, Leaves & Public Holidays
          </Text>
        </View>

        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>WFO (OFFICE)</Text>
          <View style={styles.metricRowBetween}>
            <Text style={[styles.metricVal, { color: '#2563eb' }]}>
              {effectiveWfo}
            </Text>
            <View style={styles.pctBadgeBlue}>
              <Text style={styles.pctBadgeBlueText}>{wfoPercent}%</Text>
            </View>
          </View>
          <Text style={styles.metricSub}>
            {wfoPercent}% of {effectiveWorkingDays} working days
          </Text>
        </View>

        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>WFH (HOME)</Text>
          <View style={styles.metricRowBetween}>
            <Text style={[styles.metricVal, { color: '#059669' }]}>
              {effectiveWfh}
            </Text>
            <View style={styles.pctBadgeGreen}>
              <Text style={styles.pctBadgeGreenText}>{wfhPercent}%</Text>
            </View>
          </View>
          <Text style={styles.metricSub}>
            {wfhPercent}% of {effectiveWorkingDays} working days
          </Text>
        </View>

        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>LEAVE</Text>
          <Text style={[styles.metricVal, { color: '#e11d48' }]}>
            {leaveCount}
          </Text>
          <Text style={styles.metricSub}>Deducted from working days</Text>
        </View>

        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>PUBLIC HOLIDAYS</Text>
          <Text style={[styles.metricVal, { color: '#7c3aed' }]}>
            {holidayCount}
          </Text>
          <Text style={styles.metricSub}>Deducted from working days</Text>
        </View>
      </View>

      {/* WFO Target Tracker Card */}
      {showTargetPlanner && (
        <View style={styles.card}>
          <View style={styles.targetHeaderRow}>
            <Text style={styles.sectionHeaderLabel}>
              WFO TARGET TRACKER ({targetWfoPercent}%)
            </Text>
            <View
              style={[
                styles.targetStatusBadge,
                targetMet ? styles.targetMetBg : styles.targetPendingBg,
              ]}
            >
              <Text
                style={[
                  styles.targetStatusText,
                  targetMet ? styles.targetMetText : styles.targetPendingText,
                ]}
              >
                {targetMet
                  ? `Target Met (${effectiveWfo}/${requiredWfoDays}d)`
                  : `${remainingWfoToTarget} more WFO needed (${effectiveWfo}/${requiredWfoDays}d)`}
              </Text>
            </View>
          </View>

          <View style={styles.targetBarContainer}>
            <View style={styles.targetBarTrack}>
              <View
                style={[
                  styles.targetBarFill,
                  {
                    width: `${Math.min(100, wfoPercent)}%`,
                    backgroundColor: targetMet ? '#059669' : '#2563eb',
                  },
                ]}
              />
            </View>
          </View>

          <View style={styles.targetFooterRow}>
            <Text style={styles.targetMetaText}>
              Current WFO: {wfoPercent}% ({effectiveWfo} of{' '}
              {effectiveWorkingDays} working days)
            </Text>
            <View style={styles.quickStepGroup}>
              <TouchableOpacity
                style={styles.quickStepBtn}
                onPress={() =>
                  setTargetWfoPercent((p) => Math.max(0, p - 5))
                }
              >
                <Text style={styles.quickStepBtnText}>-5%</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.quickStepBtn}
                onPress={() =>
                  setTargetWfoPercent((p) => Math.min(100, p + 5))
                }
              >
                <Text style={styles.quickStepBtnText}>+5%</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Working Days Distribution Chart */}
      {showDistribution && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Working Days Attendance Distribution
          </Text>
          <Text style={styles.cardSub}>
            WFO and WFH percentages calculated over {effectiveWorkingDays}{' '}
            working days
          </Text>
          <WorkingDaysDistributionSection
            wfo={effectiveWfo}
            wfh={effectiveWfh}
            unmarked={effectiveUnmarked}
            totalWorkingDays={effectiveWorkingDays}
            wfoPercent={wfoPercent}
            wfhPercent={wfhPercent}
            chartStyle={chartStyle}
          />
        </View>
      )}

      {/* Monthly Working Days Calculation Breakdown */}
      {showBreakdown && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Monthly Working Days Calculation
          </Text>
          <View style={styles.formulaRows}>
            <View style={styles.formulaRow}>
              <Text style={styles.formulaKey}>Calendar Days in Month</Text>
              <Text style={styles.formulaVal}>
                {summary.calendar_days || 0}
              </Text>
            </View>
            <View style={styles.formulaRow}>
              <Text style={styles.formulaKey}>Less Weekends (Sat & Sun)</Text>
              <Text style={styles.formulaVal}>
                -{summary.weekend_days || 0}
              </Text>
            </View>
            <View style={styles.formulaRow}>
              <Text style={styles.formulaKey}>Less Leave Days</Text>
              <Text style={[styles.formulaVal, { color: '#e11d48' }]}>
                -{leaveCount}
              </Text>
            </View>
            <View style={styles.formulaRow}>
              <Text style={styles.formulaKey}>Less Public Holidays</Text>
              <Text style={[styles.formulaVal, { color: '#7c3aed' }]}>
                -{holidayCount}
              </Text>
            </View>
            <View style={[styles.formulaRow, styles.formulaTotalRow]}>
              <Text style={styles.formulaTotalKey}>Total Working Days</Text>
              <Text style={styles.formulaTotalVal}>
                {effectiveWorkingDays} days
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Filterable Recorded Days List */}
      {showLogTable && (
        <View style={styles.card}>
          <View style={styles.logHeaderRow}>
            <Text style={styles.cardTitle}>
              Recorded Days ({filteredRecords.length} of {records.length})
            </Text>
            <TouchableOpacity
              style={styles.sortBtn}
              onPress={() => setSortDesc((v) => !v)}
            >
              <Text style={styles.sortBtnText}>
                {sortDesc ? 'Sort: Newest' : 'Sort: Oldest'}
              </Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Filter by date, category, or notes..."
            placeholderTextColor="#94a3b8"
          />

          {/* Status Filter Pills */}
          <View style={styles.filterGroup}>
            {[
              { id: 'ALL', label: 'All' },
              { id: 'WFO', label: 'WFO' },
              { id: 'WFH', label: 'WFH' },
              { id: 'LEAVE', label: 'Leave' },
              { id: 'HOLIDAY', label: 'Public Holiday' },
            ].map((tab) => {
              const active = statusFilter === tab.id;
              return (
                <TouchableOpacity
                  key={tab.id}
                  style={[
                    styles.filterChip,
                    active && styles.filterChipActive,
                  ]}
                  onPress={() => setStatusFilter(tab.id)}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      active && styles.filterChipTextActive,
                    ]}
                  >
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Trigger Filter Pills */}
          <View style={[styles.filterGroup, { marginTop: 6, marginBottom: 8 }]}>
            {['ALL', 'GEOFENCE', 'MANUAL', 'AUTO'].map((trig) => {
              const active = triggerFilter === trig;
              return (
                <TouchableOpacity
                  key={trig}
                  style={[
                    styles.filterChipSmall,
                    active && styles.filterChipActive,
                  ]}
                  onPress={() => setTriggerFilter(trig)}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      active && styles.filterChipTextActive,
                    ]}
                  >
                    {trig === 'ALL' ? 'All Sources' : trig}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {filteredRecords.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>
                No attendance records match the current filters.
              </Text>
            </View>
          ) : (
            filteredRecords.map((item, idx) => (
              <View
                key={item.date}
                style={[styles.recentRow, idx > 0 && styles.recentRowBorder]}
              >
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={styles.recentDate}>
                    {formatDateReadable(item.date)}
                  </Text>
                  <Text style={styles.recentMeta} numberOfLines={1}>
                    {item.check_in_time
                      ? `Arrival: ${formatTime12h(item.check_in_time)}`
                      : 'No arrival timestamp'}{' '}
                    • {item.trigger_type || 'MANUAL'}
                    {item.notes ? ` — "${item.notes}"` : ''}
                  </Text>
                </View>
                <StatusBadge status={item.status} />
              </View>
            ))
          )}
        </View>
      )}
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
  headerCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 10,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
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
  headerActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  customizeToggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  customizeToggleBtnActive: {
    backgroundColor: '#0f172a',
    borderColor: '#0f172a',
  },
  customizeToggleText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
  },
  customizeToggleTextActive: {
    color: '#ffffff',
  },
  resetSimBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  resetSimText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
    textDecorationLine: 'underline',
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
    gap: 10,
  },
  metricCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  metricCardWide: {
    minWidth: '100%',
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
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
    fontWeight: '800',
    marginTop: 2,
  },
  metricUnit: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94a3b8',
  },
  metricSub: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 3,
  },
  pctBadgeBlue: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pctBadgeBlueText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1d4ed8',
  },
  pctBadgeGreen: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pctBadgeGreenText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#047857',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 15,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  sectionHeaderLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
    letterSpacing: 0.6,
  },
  sliderBox: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 10,
    gap: 8,
  },
  sliderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sliderLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
  },
  sliderValuePill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  sliderValueText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#ffffff',
  },
  sliderControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  sliderTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#e2e8f0',
    overflow: 'hidden',
  },
  sliderFill: {
    height: '100%',
  },
  presetPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  presetPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  presetPillActive: {
    backgroundColor: '#0f172a',
    borderColor: '#0f172a',
  },
  presetPillText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#475569',
  },
  presetPillTextActive: {
    color: '#ffffff',
  },
  toggleChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  targetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  targetStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  targetMetBg: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  targetPendingBg: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  targetStatusText: {
    fontSize: 10,
    fontWeight: '700',
  },
  targetMetText: {
    color: '#047857',
  },
  targetPendingText: {
    color: '#92400e',
  },
  targetBarContainer: {
    marginTop: 10,
    marginBottom: 8,
  },
  targetBarTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f1f5f9',
    overflow: 'hidden',
  },
  targetBarFill: {
    height: '100%',
  },
  targetFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  targetMetaText: {
    fontSize: 11,
    color: '#64748b',
    flex: 1,
  },
  quickStepGroup: {
    flexDirection: 'row',
    gap: 4,
  },
  quickStepBtn: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  quickStepBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#334155',
  },
  cardTitle: {
    fontSize: 14,
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
    width: 164,
    height: 164,
    borderRadius: 82,
    overflow: 'hidden',
  },
  webView: {
    width: 164,
    height: 164,
    backgroundColor: 'transparent',
  },
  barTrack: {
    flexDirection: 'row',
    height: 8,
    width: '100%',
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#f1f5f9',
    marginTop: 12,
    marginBottom: 10,
  },
  barSlice: {
    height: '100%',
  },
  emptyChartBox: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyChartText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  legendContainer: {
    width: '100%',
    gap: 6,
    marginTop: 4,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  legendLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 2,
  },
  legendLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#334155',
  },
  legendVal: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  formulaRows: {
    gap: 6,
    marginTop: 8,
  },
  formulaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
  },
  formulaKey: {
    fontSize: 12,
    color: '#64748b',
  },
  formulaVal: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  formulaTotalRow: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 4,
    borderBottomWidth: 0,
  },
  formulaTotalKey: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  formulaTotalVal: {
    fontSize: 13,
    fontWeight: '800',
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
    borderColor: '#e2e8f0',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#f8fafc',
  },
  sortBtnText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#334155',
  },
  searchInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 12,
    color: '#0f172a',
    marginBottom: 8,
  },
  filterGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  filterChip: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  filterChipSmall: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  filterChipActive: {
    backgroundColor: '#0f172a',
    borderColor: '#0f172a',
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  filterChipTextActive: {
    color: '#ffffff',
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
    fontSize: 12,
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
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
});

module.exports = DashboardScreen;
