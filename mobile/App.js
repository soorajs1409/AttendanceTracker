const React = require('react');
const { useState, useEffect, useCallback } = React;
const {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  AppState,
  ActivityIndicator,
} = require('react-native');
const { StatusBar } = require('expo-status-bar');
const {
  SafeAreaProvider,
  SafeAreaView,
} = require('react-native-safe-area-context');

const LoginScreen = require('./src/screens/LoginScreen');
const OnboardingScreen = require('./src/screens/OnboardingScreen');
const DashboardScreen = require('./src/screens/DashboardScreen');
const HistoryScreen = require('./src/screens/HistoryScreen');
const SettingsScreen = require('./src/screens/SettingsScreen');
const ProfileScreen = require('./src/screens/ProfileScreen');
const {
  fetchStatus,
  getPendingCheckIns,
  flushPendingCheckIns,
  isOnboardingCompleted,
  resetOnboarding,
  getAuthUser,
  logoutUser,
} = require('./src/api');
const { getGeofenceStatus } = require('./src/geofence');

const TABS = [
  { id: 'dashboard', label: 'Dashboard', code: 'DB' },
  { id: 'history', label: 'Calendar', code: 'CL' },
  { id: 'settings', label: 'Settings', code: 'ST' },
  { id: 'profile', label: 'Profile', code: 'PR' },
];

function MainShell() {
  const [authUser, setAuthUserState] = useState(undefined);
  const [isOnboarded, setIsOnboarded] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [statusData, setStatusData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connError, setConnError] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [geofenceState, setGeofenceState] = useState({
    active: false,
    foregroundGranted: false,
    backgroundGranted: false,
  });

  const refreshGeofenceState = useCallback(async () => {
    const st = await getGeofenceStatus();
    setGeofenceState(st);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      await flushPendingCheckIns();
      const data = await fetchStatus();
      setStatusData(data);
      setConnError(null);
    } catch (err) {
      setConnError(err.message || 'Server unreachable');
    } finally {
      const pending = await getPendingCheckIns();
      setPendingCount(pending.length);
      await refreshGeofenceState();
      setLoading(false);
    }
  }, [refreshGeofenceState]);

  useEffect(() => {
    let mounted = true;
    Promise.all([getAuthUser(), isOnboardingCompleted()]).then(
      ([user, completed]) => {
        if (!mounted) return;
        setAuthUserState(user);
        setIsOnboarded(completed);
        if (user && completed) {
          loadAll();
        } else {
          setLoading(false);
        }
      }
    );

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        Promise.all([getAuthUser(), isOnboardingCompleted()]).then(
          ([user, completed]) => {
            if (!mounted) return;
            if (user && completed) {
              loadAll();
            }
          }
        );
      }
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, [loadAll]);

  // While checking initial auth & onboarding state
  if (authUser === undefined || isOnboarded === null) {
    return (
      <SafeAreaView style={[styles.safeArea, styles.loadingCenter]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color="#0f172a" />
      </SafeAreaView>
    );
  }

  // 1. Not Logged In -> Display Minimal Login Screen
  if (!authUser) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <StatusBar style="dark" />
        <LoginScreen
          onLoginSuccess={async ({ user, settings }) => {
            setAuthUserState(user);
            if (settings) {
              setStatusData((prev) => ({ ...(prev || {}), settings, user }));
            }
            const completed = await isOnboardingCompleted();
            setIsOnboarded(completed);
            if (completed) {
              await loadAll();
            }
          }}
        />
      </SafeAreaView>
    );
  }

  // 2. Post-Login Initial Setup Prompt (Server URL, API Key, Lat & Long)
  if (!isOnboarded) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <StatusBar style="dark" />
        <OnboardingScreen
          onComplete={async () => {
            setIsOnboarded(true);
            await loadAll();
          }}
        />
      </SafeAreaView>
    );
  }

  // 3. Main Synced 4-Tab Application
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar style="dark" />

      {/* Top App Bar */}
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoText}>AT</Text>
          </View>
          <View>
            <Text style={styles.headerTitle}>Attendance</Text>
            <Text style={styles.headerSub}>
              {statusData?.user?.username || authUser.username}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[
            styles.syncPill,
            connError ? styles.syncPillOffline : styles.syncPillOnline,
          ]}
          onPress={() => {
            if (connError) setActiveTab('settings');
            else loadAll();
          }}
        >
          <View
            style={[
              styles.syncDot,
              { backgroundColor: connError ? '#e11d48' : '#059669' },
            ]}
          />
          <Text
            style={[
              styles.syncText,
              { color: connError ? '#9f1239' : '#065f46' },
            ]}
          >
            {connError ? 'Offline' : 'Synced'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Disconnected Callout Banner */}
      {connError && activeTab !== 'settings' ? (
        <View style={styles.connBanner}>
          <View style={{ flex: 1 }}>
            <Text style={styles.connBannerTitle}>
              Cannot reach centralized server
            </Text>
            <Text style={styles.connBannerSub} numberOfLines={2}>
              {connError}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.connBannerBtn}
            onPress={() => setActiveTab('settings')}
          >
            <Text style={styles.connBannerBtnText}>Configure</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Active Screen Body */}
      <View style={styles.body}>
        {activeTab === 'dashboard' && (
          <DashboardScreen
            statusData={statusData}
            loading={loading}
            geofenceState={geofenceState}
            pendingCount={pendingCount}
            onRefresh={loadAll}
            onNavigateSettings={() => setActiveTab('settings')}
          />
        )}

        {activeTab === 'history' && (
          <HistoryScreen
            statusData={statusData}
            onRefreshStatus={loadAll}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsScreen
            statusData={statusData}
            geofenceState={geofenceState}
            onRefreshStatus={loadAll}
            onRefreshGeofence={refreshGeofenceState}
            onResetOnboarding={async () => {
              await resetOnboarding();
              setIsOnboarded(false);
            }}
          />
        )}

        {activeTab === 'profile' && (
          <ProfileScreen
            statusData={statusData}
            onRefreshStatus={loadAll}
            onReopenSetup={async () => {
              await resetOnboarding();
              setIsOnboarded(false);
            }}
            onLogout={async () => {
              await logoutUser();
              setAuthUserState(null);
              setActiveTab('dashboard');
            }}
          />
        )}
      </View>

      {/* Bottom Tab Navigation Bar */}
      <SafeAreaView edges={['bottom']} style={styles.bottomBarSafe}>
        <View style={styles.bottomBar}>
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                style={styles.tabBtn}
                onPress={() => setActiveTab(tab.id)}
              >
                <View
                  style={[
                    styles.tabIndicator,
                    active && styles.tabIndicatorActive,
                  ]}
                />
                <Text
                  style={[
                    styles.tabLabel,
                    active && styles.tabLabelActive,
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </SafeAreaView>
    </SafeAreaView>
  );
}

function App() {
  return (
    <SafeAreaProvider>
      <MainShell />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  loadingCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoBadge: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.6,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    letterSpacing: -0.2,
  },
  headerSub: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500',
  },
  syncPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  syncPillOnline: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  syncPillOffline: {
    backgroundColor: '#fff1f2',
    borderColor: '#fecdd3',
  },
  syncDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
  },
  syncText: {
    fontSize: 11,
    fontWeight: '700',
  },
  connBanner: {
    backgroundColor: '#fff1f2',
    borderBottomWidth: 1,
    borderBottomColor: '#fecdd3',
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  connBannerTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#881337',
  },
  connBannerSub: {
    fontSize: 11,
    color: '#9f1239',
  },
  connBannerBtn: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  connBannerBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  body: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  bottomBarSafe: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  bottomBar: {
    flexDirection: 'row',
    height: 52,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  tabIndicator: {
    position: 'absolute',
    top: 0,
    width: 28,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'transparent',
  },
  tabIndicatorActive: {
    backgroundColor: '#0f172a',
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  tabLabelActive: {
    color: '#0f172a',
    fontWeight: '700',
  },
});

module.exports = App;
