import React, { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  CalendarDays,
  Settings as SettingsIcon,
  User,
  Sun,
  Moon,
  Wifi,
  WifiOff,
  Smartphone,
} from 'lucide-react';
import LoginView from './components/LoginView';
import SetupView from './components/SetupView';
import DashboardView from './components/DashboardView';
import HistoryView from './components/HistoryView';
import SettingsView from './components/SettingsView';
import ProfileView from './components/ProfileView';
import {
  fetchStatus,
  getAuthUser,
  logoutUser,
  isSetupCompleted,
  setSetupCompleted,
  getInitialTheme,
  applyTheme,
} from './api';

const TABS = [
  { id: 'dashboard', label: 'Overview', Icon: LayoutDashboard },
  { id: 'history', label: 'Calendar', Icon: CalendarDays },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
  { id: 'profile', label: 'Profile', Icon: User },
];

export default function App() {
  const [theme, setTheme] = useState(() => getInitialTheme());
  const [authUser, setAuthUserState] = useState(() => getAuthUser());
  const [setupDone, setSetupDone] = useState(() => isSetupCompleted());
  const [activeTab, setActiveTab] = useState('dashboard');
  const [statusData, setStatusData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [connError, setConnError] = useState(null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchStatus();
      setStatusData(data);
      setConnError(null);
    } catch (err) {
      setConnError(err.message || 'Unable to reach server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authUser && setupDone) {
      loadStatus();
    }
  }, [authUser, setupDone, loadStatus]);

  // 1. Login Screen
  if (!authUser) {
    return (
      <LoginView
        theme={theme}
        onToggleTheme={toggleTheme}
        onLoginSuccess={({ user, settings }) => {
          setAuthUserState(user);
          if (settings) {
            setStatusData((prev) => ({ ...(prev || {}), settings, user }));
          }
        }}
      />
    );
  }

  // 2. Post-Login Initial Setup Prompt (Server URL, API Key, Lat & Long)
  if (!setupDone) {
    return (
      <SetupView
        theme={theme}
        onToggleTheme={toggleTheme}
        initialSettings={statusData?.settings}
        onComplete={async () => {
          setSetupDone(true);
          await loadStatus();
        }}
      />
    );
  }

  // 3. Main Application
  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 pb-20 sm:pb-12 transition-colors">
      {/* Sticky Top Header */}
      <header className="sticky top-0 z-40 border-b border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 text-xs font-bold tracking-tight">
                AT
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                  Attendance
                </span>
                <span className="text-zinc-300 dark:text-zinc-700">/</span>
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {statusData?.user?.username || authUser.username}
                </span>
              </div>
            </div>

            {/* Desktop Navigation Tabs */}
            <nav className="hidden sm:flex items-center gap-1">
              {TABS.map(({ id, label, Icon }) => {
                const isActive = activeTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                      isActive
                        ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800/90 dark:text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            {/* Download Mobile APK Button */}
            <a
              href="/attendance-tracker.apk"
              download="attendance-tracker.apk"
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
              title="Download Android APK"
            >
              <Smartphone className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Get App</span>
            </a>

            {/* Connection Status Indicator */}
            <button
              type="button"
              onClick={() => {
                if (connError) setActiveTab('settings');
                else loadStatus();
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium border transition ${
                connError
                  ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300'
                  : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800'
              }`}
              title={
                connError
                  ? `Disconnected: ${connError}. Click to configure connection.`
                  : 'Connected to server'
              }
            >
              {connError ? (
                <>
                  <WifiOff className="h-3.5 w-3.5 text-rose-500" />
                  <span>Offline</span>
                </>
              ) : (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <span>Synced</span>
                </>
              )}
            </button>

            {/* Light / Dark Mode Switcher */}
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              aria-label="Toggle color theme"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="h-3.5 w-3.5 text-amber-400" />
                  <span className="hidden md:inline">Light</span>
                </>
              ) : (
                <>
                  <Moon className="h-3.5 w-3.5 text-zinc-600" />
                  <span className="hidden md:inline">Dark</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 sm:px-6">
        {connError && activeTab !== 'settings' && (
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 p-3.5 text-rose-900 dark:text-rose-200">
            <div className="text-xs">
              <p className="font-semibold">Server connection unavailable</p>
              <p className="text-rose-700 dark:text-rose-300 mt-0.5">{connError}</p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className="self-start sm:self-center shrink-0 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 transition"
            >
              Configure Server
            </button>
          </div>
        )}

        {activeTab === 'dashboard' && (
          <DashboardView
            statusData={statusData}
            loading={loading}
            onRefresh={loadStatus}
          />
        )}

        {activeTab === 'history' && (
          <HistoryView
            statusData={statusData}
            onRefreshStatus={loadStatus}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            statusData={statusData}
            onRefreshStatus={loadStatus}
          />
        )}

        {activeTab === 'profile' && (
          <ProfileView
            statusData={statusData}
            theme={theme}
            onToggleTheme={toggleTheme}
            onRefreshStatus={loadStatus}
            onReopenSetup={() => {
              setSetupCompleted(false);
              setSetupDone(false);
            }}
            onLogout={() => {
              logoutUser();
              setAuthUserState(null);
              setActiveTab('dashboard');
            }}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 backdrop-blur sm:hidden">
        <div className="grid grid-cols-4">
          {TABS.map(({ id, label, Icon }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition ${
                  isActive
                    ? 'text-zinc-900 dark:text-zinc-100'
                    : 'text-zinc-400 dark:text-zinc-500'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
