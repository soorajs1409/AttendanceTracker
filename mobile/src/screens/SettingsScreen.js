const React = require('react');
const { useState, useEffect } = React;
const {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} = require('react-native');
const Location = require('expo-location');
const MobileMapPicker = require('../components/MobileMapPicker');
const {
  getConnectionConfig,
  saveConnectionConfig,
  saveSettings,
  fetchStatus,
} = require('../api');
const {
  syncGeofenceRegistration,
  stopGeofenceRegistration,
  processGeofenceEnterEvent,
} = require('../geofence');

const DAYS_OF_WEEK = [
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
  { id: 0, label: 'Sun' },
];

const RADIUS_PRESETS = [50, 100, 150, 250, 500];

function SettingsScreen({
  statusData,
  geofenceState,
  onRefreshStatus,
  onRefreshGeofence,
}) {
  const s = statusData?.settings || {};

  const [workName, setWorkName] = useState(s.work_name || 'Office');
  const [latitude, setLatitude] = useState(String(s.work_latitude ?? 0));
  const [longitude, setLongitude] = useState(String(s.work_longitude ?? 0));
  const [radiusMeters, setRadiusMeters] = useState(
    Number(s.radius_meters ?? 100)
  );
  const [windowStart, setWindowStart] = useState(s.window_start || '09:00');
  const [windowEnd, setWindowEnd] = useState(s.window_end || '10:00');
  const [workDays, setWorkDays] = useState(s.work_days || [1, 2, 3, 4, 5]);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);

  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState(null);

  const [geoMsg, setGeoMsg] = useState(null);
  const [simulating, setSimulating] = useState(false);

  const [serverUrl, setServerUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testingConn, setTestingConn] = useState(false);
  const [connMsg, setConnMsg] = useState(null);

  useEffect(() => {
    getConnectionConfig().then((cfg) => {
      setServerUrl(cfg.serverUrl);
      setApiKey(cfg.apiKey);
    });
  }, []);

  useEffect(() => {
    if (!statusData?.settings) return;
    const next = statusData.settings;
    setWorkName(next.work_name || 'Office');
    setLatitude(String(next.work_latitude ?? 0));
    setLongitude(String(next.work_longitude ?? 0));
    setRadiusMeters(Number(next.radius_meters ?? 100));
    setWindowStart(next.window_start || '09:00');
    setWindowEnd(next.window_end || '10:00');
    setWorkDays(next.work_days || [1, 2, 3, 4, 5]);
  }, [statusData]);

  function toggleWorkDay(dayId) {
    setWorkDays((prev) =>
      prev.includes(dayId)
        ? prev.filter((d) => d !== dayId)
        : [...prev, dayId].sort((a, b) => a - b)
    );
  }

  async function handleSearchPlace() {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=4&q=${encodeURIComponent(
          q
        )}`,
        {
          headers: {
            'User-Agent': 'AttendanceTrackerMobile/1.0',
          },
        }
      );
      if (res.ok) {
        const list = await res.json();
        setSearchResults(list || []);
      }
    } catch {
      // Ignore offline search errors
    } finally {
      setSearching(false);
    }
  }

  async function handleUseCurrentGps() {
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        setLatitude(pos.coords.latitude.toFixed(6));
        setLongitude(pos.coords.longitude.toFixed(6));
      } else {
        setSettingsMsg({
          type: 'error',
          text: 'Location permission denied on device.',
        });
      }
    } catch (err) {
      setSettingsMsg({
        type: 'error',
        text: err.message || 'Could not obtain current GPS position.',
      });
    } finally {
      setLocating(false);
    }
  }

  async function handleSaveSettings() {
    setSavingSettings(true);
    setSettingsMsg(null);
    try {
      const payload = {
        work_name: workName.trim() || 'Office',
        work_latitude: Number(latitude),
        work_longitude: Number(longitude),
        radius_meters: Number(radiusMeters),
        window_start: windowStart.trim(),
        window_end: windowEnd.trim(),
        work_days: workDays,
      };
      const res = await saveSettings(payload);
      const geoRes = await syncGeofenceRegistration(res.settings);
      if (onRefreshGeofence) await onRefreshGeofence();
      if (onRefreshStatus) await onRefreshStatus();

      setSettingsMsg({
        type: 'success',
        text: geoRes.active
          ? geoRes.mode === 'expo_go_live'
            ? `Saved & armed Live GPS Geofence (${geoRes.radius}m)!`
            : `Saved & armed OS geofence (${geoRes.radius}m radius)!`
          : `Saved to server! (${geoRes.reason || 'Grant location permission to arm geofence'})`,
      });
    } catch (err) {
      setSettingsMsg({
        type: 'error',
        text: err.message || 'Failed to save settings.',
      });
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleArmGeofence() {
    setGeoMsg(null);
    try {
      const res = await syncGeofenceRegistration({
        work_latitude: Number(latitude),
        work_longitude: Number(longitude),
        radius_meters: Number(radiusMeters),
      });
      if (onRefreshGeofence) await onRefreshGeofence();
      setGeoMsg({
        type: res.active ? 'success' : 'error',
        text: res.active
          ? res.mode === 'expo_go_live'
            ? `Armed in Expo Go Live GPS mode (${res.radius}m radius)!`
            : `OS circular geofence armed (${res.radius}m)!`
          : res.reason || 'Could not arm geofence.',
      });
    } catch (err) {
      setGeoMsg({
        type: 'error',
        text: err?.message || 'Failed to arm geofence.',
      });
    }
  }

  async function handlePauseGeofence() {
    try {
      await stopGeofenceRegistration();
      if (onRefreshGeofence) await onRefreshGeofence();
      setGeoMsg({
        type: 'success',
        text: 'Geofencing paused on this device.',
      });
    } catch (err) {
      setGeoMsg({
        type: 'error',
        text: err?.message || 'Failed to pause geofence.',
      });
    }
  }

  async function handleSimulateEnter() {
    setSimulating(true);
    setGeoMsg(null);
    try {
      const out = await processGeofenceEnterEvent({
        latitude: Number(latitude) || null,
        longitude: Number(longitude) || null,
        now: new Date(),
        bypassScheduleGuard: true,
      });
      if (onRefreshStatus) await onRefreshStatus();
      if (out.queuedOffline) {
        setGeoMsg({
          type: 'error',
          text: 'Server unreachable — check-in queued offline for retry!',
        });
      } else if (out.result) {
        setGeoMsg({
          type: 'success',
          text: out.result.already_existed
            ? `Simulated entry: already checked in today (${out.result.status} at ${out.result.time}).`
            : `Simulated entry: marked ${out.result.status} at ${out.result.time}!`,
        });
      }
    } finally {
      setSimulating(false);
    }
  }

  async function handleSaveConnection() {
    setTestingConn(true);
    setConnMsg(null);
    try {
      await fetchStatus({
        overrideServerUrl: serverUrl,
        overrideApiKey: apiKey,
      });
      await saveConnectionConfig({ serverUrl, apiKey });
      setConnMsg({
        type: 'success',
        text: 'Connected to centralized server & saved!',
      });
      if (onRefreshStatus) await onRefreshStatus();
    } catch (err) {
      await saveConnectionConfig({ serverUrl, apiKey });
      setConnMsg({
        type: 'error',
        text: `Saved locally, but connection test failed: ${err.message}`,
      });
    } finally {
      setTestingConn(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Background Geofencing Engine Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🛰️ Geofencing Engine</Text>
        <Text style={styles.cardSub}>
          Uses OS background regions in standalone builds, with automatic Live GPS fallback inside Expo Go.
        </Text>

        <View style={styles.permStatusBox}>
          <Text style={styles.permLine}>
            Status:{' '}
            <Text
              style={{
                fontWeight: '800',
                color: geofenceState?.active ? '#059669' : '#d97706',
              }}
            >
              {geofenceState?.active
                ? geofenceState?.mode === 'expo_go_live'
                  ? 'ARMED (Expo Go Live GPS)'
                  : 'ARMED (OS Background)'
                : 'INACTIVE'}
            </Text>
          </Text>
          <Text style={styles.permLine}>
            Location Permission:{' '}
            {geofenceState?.backgroundGranted
              ? 'Always Allowed ✅'
              : geofenceState?.foregroundGranted
                ? 'While Using App (Expo Go) ✅'
                : 'Not Granted ⚠️'}
          </Text>
        </View>

        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.secondaryBtn, { flex: 1 }]}
            onPress={handleArmGeofence}
          >
            <Text style={styles.secondaryBtnText}>Arm Geofence</Text>
          </TouchableOpacity>

          {geofenceState?.active ? (
            <TouchableOpacity
              style={[styles.outlineBtn, { flex: 1 }]}
              onPress={handlePauseGeofence}
            >
              <Text style={styles.outlineBtnText}>Pause</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <TouchableOpacity
          style={styles.simulateBtn}
          onPress={handleSimulateEnter}
          disabled={simulating}
        >
          <Text style={styles.simulateBtnText}>
            {simulating
              ? 'Triggering Check-In...'
              : '⚡ Simulate Geofence Entry (Test)'}
          </Text>
        </TouchableOpacity>

        {geoMsg && (
          <Text
            style={[
              styles.msgText,
              { color: geoMsg.type === 'success' ? '#059669' : '#e11d48' },
            ]}
          >
            {geoMsg.text}
          </Text>
        )}
      </View>

      {/* Workplace Destination & Schedule Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>📍 Work Destination & Window</Text>
        <Text style={styles.cardSub}>
          Tap or drag the pin on the map, or use your current GPS location.
        </Text>

        {/* Search & GPS Row */}
        <View style={styles.searchRow}>
          <TextInput
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search workplace address..."
            placeholderTextColor="#94a3b8"
            onSubmitEditing={handleSearchPlace}
          />
          <TouchableOpacity
            style={styles.smallActionBtn}
            onPress={handleSearchPlace}
            disabled={searching}
          >
            <Text style={styles.smallActionBtnText}>
              {searching ? '...' : 'Find'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.smallActionBtn, { backgroundColor: '#eef2ff' }]}
            onPress={handleUseCurrentGps}
            disabled={locating}
          >
            <Text style={[styles.smallActionBtnText, { color: '#4338ca' }]}>
              {locating ? '...' : 'GPS'}
            </Text>
          </TouchableOpacity>
        </View>

        {searchResults.length > 0 && (
          <View style={styles.searchResultsBox}>
            {searchResults.map((place) => (
              <TouchableOpacity
                key={String(place.place_id)}
                style={styles.searchResultItem}
                onPress={() => {
                  setLatitude(Number(place.lat).toFixed(6));
                  setLongitude(Number(place.lon).toFixed(6));
                  setSearchResults([]);
                }}
              >
                <Text style={styles.searchResultText} numberOfLines={2}>
                  📍 {place.display_name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <MobileMapPicker
          latitude={Number(latitude) || 0}
          longitude={Number(longitude) || 0}
          radiusMeters={Number(radiusMeters) || 100}
          onChangeCoords={(lat, lng) => {
            setLatitude(String(lat));
            setLongitude(String(lng));
          }}
        />

        <Text style={[styles.label, { marginTop: 12 }]}>Workplace Label</Text>
        <TextInput
          style={styles.input}
          value={workName}
          onChangeText={setWorkName}
          placeholder="Office HQ"
          placeholderTextColor="#94a3b8"
        />

        <View style={styles.twoCol}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Latitude</Text>
            <TextInput
              style={styles.input}
              value={latitude}
              onChangeText={setLatitude}
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Longitude</Text>
            <TextInput
              style={styles.input}
              value={longitude}
              onChangeText={setLongitude}
              keyboardType="numbers-and-punctuation"
            />
          </View>
        </View>

        {/* Radius Presets + Fine Step */}
        <View style={styles.radiusHeader}>
          <Text style={styles.label}>Geofence Radius</Text>
          <Text style={styles.radiusBadge}>{radiusMeters}m</Text>
        </View>
        <View style={styles.presetRow}>
          {RADIUS_PRESETS.map((preset) => {
            const active = Number(radiusMeters) === preset;
            return (
              <TouchableOpacity
                key={preset}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setRadiusMeters(preset)}
              >
                <Text
                  style={[styles.chipText, active && styles.chipTextActive]}
                >
                  {preset}m
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Arrival Window */}
        <View style={[styles.twoCol, { marginTop: 12 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Window Start (HH:MM)</Text>
            <TextInput
              style={styles.input}
              value={windowStart}
              onChangeText={setWindowStart}
              placeholder="09:00"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Window End (HH:MM)</Text>
            <TextInput
              style={styles.input}
              value={windowEnd}
              onChangeText={setWindowEnd}
              placeholder="10:00"
            />
          </View>
        </View>

        {/* Active Workdays */}
        <Text style={styles.label}>Active Workdays</Text>
        <View style={styles.presetRow}>
          {DAYS_OF_WEEK.map((d) => {
            const active = workDays.includes(d.id);
            return (
              <TouchableOpacity
                key={d.id}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => toggleWorkDay(d.id)}
              >
                <Text
                  style={[styles.chipText, active && styles.chipTextActive]}
                >
                  {d.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, { marginTop: 14 }]}
          onPress={handleSaveSettings}
          disabled={savingSettings}
        >
          <Text style={styles.primaryBtnText}>
            {savingSettings ? 'Saving...' : 'Save Location & Schedule'}
          </Text>
        </TouchableOpacity>

        {settingsMsg && (
          <Text
            style={[
              styles.msgText,
              {
                color: settingsMsg.type === 'success' ? '#059669' : '#e11d48',
              },
            ]}
          >
            {settingsMsg.text}
          </Text>
        )}
      </View>

      {/* Centralized Server Connection Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🖥️ Server Connection</Text>
        <Text style={styles.cardSub}>
          Point to your local LAN IP (e.g. http://192.168.1.50:3000) or public VPS / Homelab domain.
        </Text>

        <Text style={styles.label}>Server Base URL</Text>
        <TextInput
          style={styles.input}
          value={serverUrl}
          onChangeText={setServerUrl}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="http://192.168.1.50:3000"
          placeholderTextColor="#94a3b8"
        />

        <View style={styles.radiusHeader}>
          <Text style={styles.label}>Pre-Shared API Key (X-API-Key)</Text>
          <TouchableOpacity onPress={() => setShowKey((v) => !v)}>
            <Text style={{ fontSize: 12, color: '#4f46e5', fontWeight: '600' }}>
              {showKey ? 'Hide' : 'Show'}
            </Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.input}
          value={apiKey}
          onChangeText={setApiKey}
          secureTextEntry={!showKey}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="my_super_secret_key_123"
          placeholderTextColor="#94a3b8"
        />

        <TouchableOpacity
          style={styles.outlineBtn}
          onPress={handleSaveConnection}
          disabled={testingConn}
        >
          <Text style={styles.outlineBtnText}>
            {testingConn ? 'Testing Connection...' : 'Save & Test Connection'}
          </Text>
        </TouchableOpacity>

        {connMsg && (
          <Text
            style={[
              styles.msgText,
              { color: connMsg.type === 'success' ? '#059669' : '#e11d48' },
            ]}
          >
            {connMsg.text}
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
    paddingBottom: 36,
    gap: 16,
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
    fontWeight: '800',
    color: '#0f172a',
  },
  cardSub: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
    marginBottom: 12,
  },
  permStatusBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    gap: 4,
    marginBottom: 10,
  },
  permLine: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '600',
  },
  btnRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 10,
  },
  smallActionBtn: {
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  smallActionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  searchResultsBox: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
  },
  searchResultItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  searchResultText: {
    fontSize: 12,
    color: '#1e293b',
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
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
  twoCol: {
    flexDirection: 'row',
    gap: 10,
  },
  radiusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  radiusBadge: {
    backgroundColor: '#4f46e5',
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  chipActive: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  chipTextActive: {
    color: '#ffffff',
  },
  primaryBtn: {
    backgroundColor: '#4f46e5',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryBtn: {
    backgroundColor: '#4f46e5',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  simulateBtn: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  simulateBtnText: {
    color: '#4338ca',
    fontSize: 12,
    fontWeight: '700',
  },
  outlineBtn: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  outlineBtnText: {
    color: '#1e293b',
    fontSize: 13,
    fontWeight: '700',
  },
  msgText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
  },
});

module.exports = SettingsScreen;
