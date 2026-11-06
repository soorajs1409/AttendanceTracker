const React = require('react');
const { useState, useEffect } = React;
const {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} = require('react-native');
const Location = require('expo-location');
const MobileMapPicker = require('../components/MobileMapPicker');
const {
  getConnectionConfig,
  saveConnectionConfig,
  saveSettings,
  fetchStatus,
  setOnboardingCompleted,
} = require('../api');
const { syncGeofenceRegistration } = require('../geofence');

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

function OnboardingScreen({ onComplete }) {
  // 1. Server connection
  const [serverUrl, setServerUrl] = useState('http://10.3.3.88:3000');
  const [apiKey, setApiKey] = useState('my_super_secret_key_123');
  const [showKey, setShowKey] = useState(false);
  const [testingConn, setTestingConn] = useState(false);
  const [connResult, setConnResult] = useState(null); // { success: boolean, msg: string }

  // 2. Workplace coordinates & geofence
  const [workName, setWorkName] = useState('Office');
  const [latitude, setLatitude] = useState('12.900752');
  const [longitude, setLongitude] = useState('77.694440');
  const [radiusMeters, setRadiusMeters] = useState(100);

  // 3. Arrival window & workdays
  const [windowStart, setWindowStart] = useState('09:00');
  const [windowEnd, setWindowEnd] = useState('10:00');
  const [workDays, setWorkDays] = useState([1, 2, 3, 4, 5]);

  // Search & GPS helpers
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);

  // Submission state
  const [finishing, setFinishing] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    getConnectionConfig().then((cfg) => {
      if (cfg.serverUrl && cfg.serverUrl !== 'http://localhost:3000') {
        setServerUrl(cfg.serverUrl);
      }
      if (cfg.apiKey) {
        setApiKey(cfg.apiKey);
      }
    });
  }, []);

  function toggleWorkDay(dayId) {
    setWorkDays((prev) =>
      prev.includes(dayId)
        ? prev.filter((d) => d !== dayId)
        : [...prev, dayId].sort((a, b) => a - b)
    );
  }

  async function handleTestConnection() {
    const trimmedUrl = serverUrl.trim();
    if (!trimmedUrl) {
      setConnResult({ success: false, msg: 'Please enter a server URL first.' });
      return;
    }
    setTestingConn(true);
    setConnResult(null);
    try {
      const data = await fetchStatus({
        overrideServerUrl: trimmedUrl,
        overrideApiKey: apiKey.trim(),
      });
      setConnResult({
        success: true,
        msg: `Connected! Server is online (${data?.settings?.work_name || 'Ready'}).`,
      });

      // If server already has saved settings, pre-fill them
      if (data?.settings) {
        const s = data.settings;
        if (s.work_name) setWorkName(s.work_name);
        if (Number(s.work_latitude) !== 0) setLatitude(String(s.work_latitude));
        if (Number(s.work_longitude) !== 0) setLongitude(String(s.work_longitude));
        if (s.radius_meters) setRadiusMeters(Number(s.radius_meters));
        if (s.window_start) setWindowStart(s.window_start);
        if (s.window_end) setWindowEnd(s.window_end);
        if (Array.isArray(s.work_days) && s.work_days.length > 0) {
          setWorkDays(s.work_days);
        }
      }
    } catch (err) {
      setConnResult({
        success: false,
        msg: `Connection failed: ${err.message || 'Cannot reach server'}. Check IP and port.`,
      });
    } finally {
      setTestingConn(false);
    }
  }

  async function handleUseCurrentLocation() {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Location Permission Required',
          'Please allow location access to auto-fill your workplace coordinates.'
        );
        return;
      }

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const lat = Number(pos.coords.latitude.toFixed(6));
      const lng = Number(pos.coords.longitude.toFixed(6));
      setLatitude(String(lat));
      setLongitude(String(lng));
    } catch (err) {
      Alert.alert('GPS Error', err.message || 'Unable to retrieve current location.');
    } finally {
      setLocating(false);
    }
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
            'User-Agent': 'AttendanceTrackerMobileSetup/1.0',
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

  function handleSelectSearchResult(item) {
    const lat = Number(parseFloat(item.lat).toFixed(6));
    const lon = Number(parseFloat(item.lon).toFixed(6));
    setLatitude(String(lat));
    setLongitude(String(lon));
    const shortName = item.display_name.split(',')[0];
    if (shortName && workName === 'Office') {
      setWorkName(shortName);
    }
    setSearchResults([]);
    setSearchQuery('');
  }

  async function handleCompleteSetup() {
    setFinishing(true);
    setSubmitError(null);

    const trimmedUrl = serverUrl.trim().replace(/\/+$/, '');
    const trimmedKey = apiKey.trim();
    const latNum = Number(latitude);
    const lngNum = Number(longitude);

    if (!trimmedUrl) {
      setSubmitError('Server URL is required.');
      setFinishing(false);
      return;
    }

    if (Number.isNaN(latNum) || Number.isNaN(lngNum) || (latNum === 0 && lngNum === 0)) {
      setSubmitError('Please set valid workplace map coordinates.');
      setFinishing(false);
      return;
    }

    try {
      // 1. Save connection config in mobile storage
      await saveConnectionConfig({ serverUrl: trimmedUrl, apiKey: trimmedKey });

      // 2. Save settings to the server
      const payload = {
        work_name: workName.trim() || 'Office',
        work_latitude: latNum,
        work_longitude: lngNum,
        radius_meters: radiusMeters,
        window_start: windowStart.trim() || '09:00',
        window_end: windowEnd.trim() || '10:00',
        work_days: workDays,
      };

      const settingsRes = await saveSettings(payload);

      // 3. Request permissions & register OS Geofence
      try {
        await syncGeofenceRegistration(settingsRes.settings);
      } catch (geoErr) {
        // Geofence registration warning won't block onboarding completion
        console.warn('Geofence warning during setup:', geoErr);
      }

      // 4. Mark onboarding completed in AsyncStorage
      await setOnboardingCompleted(true);

      // 5. Trigger transition to main shell
      if (onComplete) {
        onComplete();
      }
    } catch (err) {
      setSubmitError(
        `Setup failed: ${err.message || 'Could not connect to server'}. Please verify server URL & key.`
      );
    } finally {
      setFinishing(false);
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Top Welcome Banner */}
      <View style={styles.heroCard}>
        <View style={styles.heroBadge}>
          <Text style={styles.heroBadgeText}>📍 Welcome</Text>
        </View>
        <Text style={styles.heroTitle}>Initial App Setup</Text>
        <Text style={styles.heroSub}>
          Configure your server URL and workplace map coordinates to start tracking your Work from Office (WFO) automatically.
        </Text>
      </View>

      {/* Step 1: Server Connection */}
      <View style={styles.card}>
        <View style={styles.stepHeader}>
          <View style={styles.stepCircle}>
            <Text style={styles.stepNumber}>1</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Server Connection</Text>
            <Text style={styles.cardSub}>
              Point to your computer's local IP or public URL
            </Text>
          </View>
        </View>

        <Text style={styles.label}>Server Base URL</Text>
        <TextInput
          style={styles.input}
          value={serverUrl}
          onChangeText={setServerUrl}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="http://10.3.3.88:3000 or https://..."
          placeholderTextColor="#94a3b8"
        />

        <View style={styles.rowBetween}>
          <Text style={styles.label}>Pre-Shared API Key</Text>
          <TouchableOpacity onPress={() => setShowKey((v) => !v)}>
            <Text style={styles.linkText}>{showKey ? 'Hide' : 'Show'}</Text>
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
          style={[styles.outlineBtn, testingConn && styles.disabledBtn]}
          onPress={handleTestConnection}
          disabled={testingConn}
        >
          {testingConn ? (
            <ActivityIndicator color="#4f46e5" size="small" />
          ) : (
            <Text style={styles.outlineBtnText}>Test Server Connection</Text>
          )}
        </TouchableOpacity>

        {connResult && (
          <View
            style={[
              styles.feedbackBox,
              connResult.success ? styles.feedbackSuccess : styles.feedbackError,
            ]}
          >
            <Text
              style={[
                styles.feedbackText,
                connResult.success ? { color: '#065f46' } : { color: '#9f1239' },
              ]}
            >
              {connResult.msg}
            </Text>
          </View>
        )}
      </View>

      {/* Step 2: Workplace Coordinates & Map */}
      <View style={styles.card}>
        <View style={styles.stepHeader}>
          <View style={styles.stepCircle}>
            <Text style={styles.stepNumber}>2</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Workplace Coordinates</Text>
            <Text style={styles.cardSub}>
              Set the office pin and arrival boundary
            </Text>
          </View>
        </View>

        <Text style={styles.label}>Location Name</Text>
        <TextInput
          style={styles.input}
          value={workName}
          onChangeText={setWorkName}
          placeholder="e.g. Office, Tech Park, Studio"
          placeholderTextColor="#94a3b8"
        />

        <View style={styles.coordRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Latitude</Text>
            <TextInput
              style={styles.input}
              value={latitude}
              onChangeText={setLatitude}
              keyboardType="numeric"
              placeholder="12.9716"
              placeholderTextColor="#94a3b8"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Longitude</Text>
            <TextInput
              style={styles.input}
              value={longitude}
              onChangeText={setLongitude}
              keyboardType="numeric"
              placeholder="77.5946"
              placeholderTextColor="#94a3b8"
            />
          </View>
        </View>

        <TouchableOpacity
          style={styles.gpsBtn}
          onPress={handleUseCurrentLocation}
          disabled={locating}
        >
          {locating ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Text style={styles.gpsBtnText}>📍 Use Current GPS Location</Text>
          )}
        </TouchableOpacity>

        {/* Address Search */}
        <Text style={[styles.label, { marginTop: 10 }]}>Search Office Address</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search building, street, or landmark..."
            placeholderTextColor="#94a3b8"
            onSubmitEditing={handleSearchPlace}
          />
          <TouchableOpacity
            style={styles.searchBtn}
            onPress={handleSearchPlace}
            disabled={searching}
          >
            <Text style={styles.searchBtnText}>
              {searching ? '...' : 'Search'}
            </Text>
          </TouchableOpacity>
        </View>

        {searchResults.length > 0 && (
          <View style={styles.resultsBox}>
            {searchResults.map((item, idx) => (
              <TouchableOpacity
                key={String(item.place_id || idx)}
                style={styles.resultItem}
                onPress={() => handleSelectSearchResult(item)}
              >
                <Text style={styles.resultText} numberOfLines={2}>
                  📍 {item.display_name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Interactive Map Picker */}
        <Text style={[styles.label, { marginTop: 12 }]}>
          Interactive Map (Tap or drag pin to adjust)
        </Text>
        <View style={styles.mapContainer}>
          <MobileMapPicker
            latitude={Number(latitude) || 12.9716}
            longitude={Number(longitude) || 77.5946}
            radiusMeters={radiusMeters}
            onChangeCoords={(lat, lng) => {
              setLatitude(String(lat));
              setLongitude(String(lng));
            }}
          />
        </View>

        {/* Geofence Radius */}
        <Text style={[styles.label, { marginTop: 12 }]}>
          Geofence Radius: {radiusMeters}m
        </Text>
        <View style={styles.chipRow}>
          {RADIUS_PRESETS.map((r) => {
            const active = radiusMeters === r;
            return (
              <TouchableOpacity
                key={r}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setRadiusMeters(r)}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {r}m
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Step 3: Arrival Window & Workdays */}
      <View style={styles.card}>
        <View style={styles.stepHeader}>
          <View style={styles.stepCircle}>
            <Text style={styles.stepNumber}>3</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Arrival Window & Workdays</Text>
            <Text style={styles.cardSub}>
              Arrivals by window end qualify as WFO
            </Text>
          </View>
        </View>

        <View style={styles.coordRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Window Start (24h)</Text>
            <TextInput
              style={styles.input}
              value={windowStart}
              onChangeText={setWindowStart}
              placeholder="09:00"
              placeholderTextColor="#94a3b8"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Window End (24h)</Text>
            <TextInput
              style={styles.input}
              value={windowEnd}
              onChangeText={setWindowEnd}
              placeholder="10:00"
              placeholderTextColor="#94a3b8"
            />
          </View>
        </View>

        <Text style={styles.label}>Working Days</Text>
        <View style={styles.chipRow}>
          {DAYS_OF_WEEK.map((d) => {
            const active = workDays.includes(d.id);
            return (
              <TouchableOpacity
                key={d.id}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => toggleWorkDay(d.id)}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {d.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Error message if final submission fails */}
      {submitError && (
        <View style={[styles.feedbackBox, styles.feedbackError]}>
          <Text style={[styles.feedbackText, { color: '#9f1239' }]}>
            {submitError}
          </Text>
        </View>
      )}

      {/* Final Action Button */}
      <TouchableOpacity
        style={[styles.finishBtn, finishing && styles.disabledBtn]}
        onPress={handleCompleteSetup}
        disabled={finishing}
      >
        {finishing ? (
          <ActivityIndicator color="#ffffff" size="small" />
        ) : (
          <Text style={styles.finishBtnText}>Complete Setup & Enter App 🚀</Text>
        )}
      </TouchableOpacity>
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
    paddingBottom: 40,
    gap: 16,
  },
  heroCard: {
    backgroundColor: '#4338ca',
    borderRadius: 18,
    padding: 20,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 8,
  },
  heroBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
  },
  heroSub: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 13,
    marginTop: 6,
    lineHeight: 18,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#4f46e5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumber: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  cardSub: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 4,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  linkText: {
    fontSize: 12,
    color: '#4f46e5',
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: '#0f172a',
    marginBottom: 10,
  },
  coordRow: {
    flexDirection: 'row',
    gap: 10,
  },
  gpsBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 6,
  },
  gpsBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  outlineBtn: {
    borderWidth: 1,
    borderColor: '#4f46e5',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  outlineBtnText: {
    color: '#4f46e5',
    fontSize: 13,
    fontWeight: '700',
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  searchBtn: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  searchBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  resultsBox: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 10,
  },
  resultItem: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  resultText: {
    fontSize: 12,
    color: '#1e293b',
  },
  mapContainer: {
    height: 220,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
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
    fontWeight: '600',
    color: '#475569',
  },
  chipTextActive: {
    color: '#ffffff',
  },
  finishBtn: {
    backgroundColor: '#059669',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  finishBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  disabledBtn: {
    opacity: 0.6,
  },
  feedbackBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
  },
  feedbackSuccess: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  feedbackError: {
    backgroundColor: '#fff1f2',
    borderWidth: 1,
    borderColor: '#fecdd3',
  },
  feedbackText: {
    fontSize: 12,
    fontWeight: '600',
  },
});

module.exports = OnboardingScreen;
