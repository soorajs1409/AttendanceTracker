const React = require('react');
const { useState } = React;
const {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  StyleSheet,
  ActivityIndicator,
} = require('react-native');
const Location = require('expo-location');
const {
  submitCheckIn,
  flushPendingCheckIns,
  formatTime12h,
  formatDateReadable,
} = require('../api');

function StatusBadge({ status }) {
  let bg = '#f1f5f9';
  let fg = '#334155';
  if (status === 'PRESENT') {
    bg = '#d1fae5';
    fg = '#065f46';
  } else if (status === 'LATE') {
    bg = '#fef3c7';
    fg = '#92400e';
  } else if (status === 'MANUAL') {
    bg = '#e0f2fe';
    fg = '#075985';
  }

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{status}</Text>
    </View>
  );
}

function DashboardScreen({
  statusData,
  loading,
  geofenceState,
  pendingCount,
  onRefresh,
  onNavigateSettings,
}) {
  const [note, setNote] = useState('');
  const [checkingIn, setCheckingIn] = useState(false);
  const [syncingQueue, setSyncingQueue] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const today = statusData?.today || {};
  const settings = statusData?.settings || {};
  const recent = (statusData?.recent || []).slice(0, 5);

  const isLocationConfigured =
    Number(settings.work_latitude || 0) !== 0 ||
    Number(settings.work_longitude || 0) !== 0;

  let bannerBg = '#4338ca'; // Indigo awaiting
  let bannerTitle = '⏳ Awaiting Arrival';
  let bannerSub = `Target Window: ${formatTime12h(
    settings.window_start
  )} – ${formatTime12h(settings.window_end)}`;

  if (today.checked_in) {
    if (today.status === 'LATE') {
      bannerBg = '#d97706'; // Amber late
      bannerTitle = `⏰ Marked Late at ${formatTime12h(today.check_in_time)}`;
      bannerSub = `Logged via ${today.trigger_type || 'GEOFENCE'} • ${
        settings.work_name || 'Office'
      }`;
    } else {
      bannerBg = '#059669'; // Emerald present
      bannerTitle = `✅ Marked Present at ${formatTime12h(today.check_in_time)}`;
      bannerSub = `Logged via ${today.trigger_type || 'GEOFENCE'} • ${
        settings.work_name || 'Office'
      }`;
    }
  } else if (today.is_work_day === false) {
    bannerBg = '#334155'; // Slate off-day
    bannerTitle = '🏖️ Non-Working Day';
    bannerSub = 'Enjoy your day off! Automatic window resumes next workday.';
  }

  async function handleManualCheckIn() {
    setCheckingIn(true);
    setFeedback(null);

    let coords = {};
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        coords = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        };
      }
    } catch {
      // Proceed cleanly without GPS coordinates
    }

    try {
      const res = await submitCheckIn({
        ...coords,
        trigger: 'MANUAL',
        notes: note.trim() || undefined,
      });

      setFeedback({
        type: 'success',
        message: res.already_existed
          ? `Already checked in today at ${formatTime12h(res.time)} (${res.status}).`
          : `Checked in at ${formatTime12h(res.time)} — marked ${res.status}!`,
      });
      setNote('');
      if (onRefresh) await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to check in.',
      });
    } finally {
      setCheckingIn(false);
    }
  }

  async function handleFlushQueue() {
    setSyncingQueue(true);
    try {
      await flushPendingCheckIns();
      if (onRefresh) await onRefresh();
    } finally {
      setSyncingQueue(false);
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={Boolean(loading)} onRefresh={onRefresh} />
      }
    >
      {/* Unconfigured Destination Callout */}
      {!isLocationConfigured && statusData && (
        <View style={styles.warningCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.warningTitle}>
              Work destination not configured
            </Text>
            <Text style={styles.warningSub}>
              Drop a pin on the map in Settings to arm automatic geofence check-ins.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.warningBtn}
            onPress={onNavigateSettings}
          >
            <Text style={styles.warningBtnText}>Set Location</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Offline Queue Sync Callout */}
      {pendingCount > 0 && (
        <View style={styles.queueCard}>
          <Text style={styles.queueText}>
            {pendingCount} offline arrival(s) waiting to sync
          </Text>
          <TouchableOpacity
            style={styles.queueBtn}
            onPress={handleFlushQueue}
            disabled={syncingQueue}
          >
            <Text style={styles.queueBtnText}>
              {syncingQueue ? 'Syncing...' : 'Sync Now'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Big Today Banner */}
      <View style={[styles.banner, { backgroundColor: bannerBg }]}>
        <View style={styles.datePill}>
          <Text style={styles.datePillText}>
            {formatDateReadable(today.date) || 'Today'}
          </Text>
        </View>

        <Text style={styles.bannerTitle}>{bannerTitle}</Text>
        <Text style={styles.bannerSub}>{bannerSub}</Text>

        {today.notes ? (
          <View style={styles.notePill}>
            <Text style={styles.notePillText}>Note: {today.notes}</Text>
          </View>
        ) : null}

        <View style={styles.bannerFooter}>
          <Text style={styles.bannerFooterText}>
            📍 {settings.work_name || 'Office'}{' '}
            {isLocationConfigured ? `(${settings.radius_meters}m)` : ''}
          </Text>
          <Text style={styles.bannerFooterText}>
            {geofenceState?.active
              ? '🛰️ Geofence Armed'
              : '⚠️ Geofence Inactive'}
          </Text>
        </View>
      </View>

      {/* Quick Manual Check-In Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Quick Manual Check-In</Text>
        <Text style={styles.cardSub}>
          Use this if indoor GPS missed the boundary or you forgot your phone.
        </Text>

        <TextInput
          style={styles.input}
          value={note}
          onChangeText={setNote}
          placeholder="Optional note (e.g., Underground parking)"
          placeholderTextColor="#94a3b8"
          editable={!today.checked_in && !checkingIn}
        />

        <TouchableOpacity
          style={[
            styles.primaryBtn,
            (today.checked_in || checkingIn) && styles.disabledBtn,
          ]}
          onPress={handleManualCheckIn}
          disabled={Boolean(today.checked_in) || checkingIn}
        >
          {checkingIn ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Text style={styles.primaryBtnText}>
              {today.checked_in ? 'Checked In Today' : 'Manual Check In'}
            </Text>
          )}
        </TouchableOpacity>

        {feedback && (
          <View
            style={[
              styles.feedbackBox,
              feedback.type === 'success'
                ? styles.feedbackSuccess
                : styles.feedbackError,
            ]}
          >
            <Text
              style={[
                styles.feedbackText,
                feedback.type === 'success'
                  ? { color: '#065f46' }
                  : { color: '#9f1239' },
              ]}
            >
              {feedback.message}
            </Text>
          </View>
        )}
      </View>

      {/* Recent 5-Day Summary */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Recent Attendance</Text>

        {recent.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>
              No check-ins recorded yet. Your arrivals will appear here automatically.
            </Text>
          </View>
        ) : (
          recent.map((item, idx) => (
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
                  Arrived {formatTime12h(item.check_in_time)} •{' '}
                  {item.trigger_type}
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
    gap: 16,
  },
  warningCard: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  warningTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#78350f',
  },
  warningSub: {
    fontSize: 12,
    color: '#92400e',
    marginTop: 2,
  },
  warningBtn: {
    backgroundColor: '#d97706',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  warningBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  queueCard: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  queueText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3730a3',
  },
  queueBtn: {
    backgroundColor: '#4f46e5',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  queueBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  banner: {
    borderRadius: 22,
    padding: 20,
  },
  datePill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 10,
  },
  datePillText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  bannerTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
  },
  bannerSub: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    marginTop: 4,
  },
  notePill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0,0,0,0.18)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 8,
  },
  notePillText: {
    color: '#ffffff',
    fontSize: 12,
  },
  bannerFooter: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  bannerFooterText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  cardSub: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
    marginBottom: 12,
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0f172a',
    marginBottom: 10,
  },
  primaryBtn: {
    backgroundColor: '#4f46e5',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledBtn: {
    backgroundColor: '#cbd5e1',
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  feedbackBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
  },
  feedbackSuccess: {
    backgroundColor: '#ecfdf5',
  },
  feedbackError: {
    backgroundColor: '#fff1f2',
  },
  feedbackText: {
    fontSize: 12,
    fontWeight: '600',
  },
  emptyBox: {
    marginTop: 12,
    paddingVertical: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#cbd5e1',
    borderRadius: 12,
  },
  emptyText: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  recentRowBorder: {
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  recentDate: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  recentMeta: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
});

module.exports = DashboardScreen;
