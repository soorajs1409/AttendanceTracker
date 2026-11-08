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
  getTheme,
  saveTheme,
} = require('./src/api');
const { getGeofenceStatus } = require('./src/geofence');

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'history', label: 'Calendar' },
  { id: 'settings', label: 'Settings' },
  { id: 'profile', label: 'Profile' },
];

function MainShell() {
  const [authUser, setAuthUserState] = useState(undefined);
  const [isOnboarded, setIsOnboarded] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [statusData, setStatusData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connError, setConnError] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [theme, setTheme] = useState('light');
  const [geofenceState, setGeofenceState] = useState({
    active: false,
    foregroundGranted: false,
    backgroundGranted: false,
  });

  const isDark = theme === 'dark';

  const handleToggleTheme = useCallback(async () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    await saveTheme(next);
  }, [theme]);

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
    Promise.all([getAuthUser(), isOnboardingCompleted(), getTheme()]).then(
      ([user, completed, savedTheme]) => {
        if (!mounted) return;
        setAuthUserState(user);
        setIsOnboarded(completed);
        setTheme(savedTheme || 'light');
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

  if (authUser === undefined || isOnboarded === null) {
    return (
      <SafeAreaView
        style={[
          styles.safeArea,
          isDark && styles.safeAreaDark,
          styles.loadingCenter,
        ]}
      >
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ActivityIndicator
          size="large"
          color={isDark ? '#f4f4f5' : '#18181b'}
        />
      </SafeAreaView>
    );
  }

  if (!authUser) {
    return (
      <SafeAreaView
        style={[styles.safeArea, isDark && styles.safeAreaDark]}
        edges={['top', 'left', 'right']}
      >
        <StatusBar style={isDark ? 'light' : 'dark'} />
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

  if (!isOnboarded) {
    return (
      <SafeAreaView
        style={[styles.safeArea, isDark && styles.safeAreaDark]}
        edges={['top', 'left', 'right']}
      >
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <OnboardingScreen
          onComplete={async () => {
            setIsOnboarded(true);
            await loadAll();
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.safeArea, isDark && styles.safeAreaDark]}
      edges={['top', 'left', 'right']}
    >
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {/* Top App Bar */}
      <View style={[styles.header, isDark && styles.headerDark]}>
        <View style={styles.brandRow}>
          <View style={[styles.logoBadge, isDark && styles.logoBadgeDark]}>
            <Text style={[styles.logoText, isDark && styles.logoTextDark]}>
              AT
            </Text>
          </View>
          <View>
            <Text style={[styles.headerTitle, isDark && styles.headerTitleDark]}>
              Attendance
            </Text>
            <Text style={[styles.headerSub, isDark && styles.headerSubDark]}>
              {statusData?.user?.username || authUser.username}
            </Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            style={[styles.themeBtn, isDark && styles.themeBtnDark]}
            onPress={handleToggleTheme}
          >
            <Text style={[styles.themeBtnText, isDark && styles.themeBtnTextDark]}>
              {isDark ? 'Light' : 'Dark'}
            </Text>
          </TouchableOpacity>

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
      <View style={[styles.body, isDark && styles.bodyDark]}>
        {activeTab === 'dashboard' && (
          <DashboardScreen
            statusData={statusData}
            loading={loading}
            geofenceState={geofenceState}
            pendingCount={pendingCount}
            onRefresh={loadAll}
            onNavigateSettings={() => setActiveTab('settings')}
            theme={theme}
          />
        )}

        {activeTab === 'history' && (
          <HistoryScreen
            statusData={statusData}
            onRefreshStatus={loadAll}
            theme={theme}
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
      <SafeAreaView
        edges={['bottom']}
        style={[styles.bottomBarSafe, isDark && styles.bottomBarSafeDark]}
      >
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
                    active &&
                      (isDark
                        ? styles.tabIndicatorActiveDark
                        : styles.tabIndicatorActive),
                  ]}
                />
                <Text
                  style={[
                    styles.tabLabel,
                    isDark && styles.tabLabelDark,
                    active &&
                      (isDark
                        ? styles.tabLabelActiveDark
                        : styles.tabLabelActive),
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
  safeAreaDark: {
    backgroundColor: '#09090b',
  },
  loadingCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#e4e4e7',
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerDark: {
    backgroundColor: '#09090b',
    borderBottomColor: '#27272a',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoBadge: {
    width: 30,
    height: 30,
    borderRadius: 6,
    backgroundColor: '#18181b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoBadgeDark: {
    backgroundColor: '#f4f4f5',
  },
  logoText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.4,
  },
  logoTextDark: {
    color: '#09090b',
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#18181b',
  },
  headerTitleDark: {
    color: '#f4f4f5',
  },
  headerSub: {
    fontSize: 11,
    color: '#71717a',
  },
  headerSubDark: {
    color: '#a1a1aa',
  },
  themeBtn: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#d4d4d8',
    backgroundColor: '#fafafa',
  },
  themeBtnDark: {
    borderColor: '#3f3f46',
    backgroundColor: '#18181b',
  },
  themeBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#3f3f46',
  },
  themeBtnTextDark: {
    color: '#e4e4e7',
  },
  syncPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 5,
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
    fontWeight: '600',
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
    fontWeight: '600',
    color: '#881337',
  },
  connBannerSub: {
    fontSize: 11,
    color: '#9f1239',
  },
  connBannerBtn: {
    backgroundColor: '#18181b',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 5,
  },
  connBannerBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },
  body: {
    flex: 1,
    backgroundColor: '#fafafa',
  },
  bodyDark: {
    backgroundColor: '#09090b',
  },
  bottomBarSafe: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e4e4e7',
  },
  bottomBarSafeDark: {
    backgroundColor: '#09090b',
    borderTopColor: '#27272a',
  },
  bottomBar: {
    flexDirection: 'row',
    height: 50,
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
    backgroundColor: '#18181b',
  },
  tabIndicatorActiveDark: {
    backgroundColor: '#f4f4f5',
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#71717a',
  },
  tabLabelDark: {
    color: '#a1a1aa',
  },
  tabLabelActive: {
    color: '#18181b',
    fontWeight: '600',
  },
  tabLabelActiveDark: {
    color: '#f4f4f5',
    fontWeight: '600',
  },
});

module.exports = App;
