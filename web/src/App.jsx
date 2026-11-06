import React, { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  CalendarDays,
  Settings as SettingsIcon,
  MapPinCheck,
  Wifi,
  WifiOff,
} from 'lucide-react';
import DashboardView from './components/DashboardView';
import HistoryView from './components/HistoryView';
import SettingsView from './components/SettingsView';
import { fetchStatus } from './api';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { id: 'history', label: 'Calendar', Icon: CalendarDays },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [statusData, setStatusData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connError, setConnError] = useState(null);

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
    loadStatus();
  }, [loadStatus]);

  return (
    <div className="min-h-screen flex flex-col pb-20 sm:pb-10">
      {/* Sticky Top Header */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <MapPinCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-slate-900 leading-tight">
                Attendance Tracker
              </h1>
              <p className="text-[11px] font-medium text-slate-500">
                Automated Geofence Portal
              </p>
            </div>
          </div>

          {/* Desktop Navigation Tabs */}
          <nav className="hidden sm:flex items-center gap-1 rounded-xl bg-slate-100 p-1">
            {TABS.map(({ id, label, Icon }) => {
              const isActive = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                    isActive
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>

          {/* Connection Status Indicator */}
          <button
            type="button"
            onClick={() => {
              if (connError) setActiveTab('settings');
              else loadStatus();
            }}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold border transition ${
              connError
                ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
            }`}
            title={
              connError
                ? `Disconnected: ${connError}. Click to configure connection.`
                : 'Connected to centralized server'
            }
          >
            {connError ? (
              <>
                <WifiOff className="h-3.5 w-3.5" />
                <span>Offline</span>
              </>
            ) : (
              <>
                <Wifi className="h-3.5 w-3.5" />
                <span>Synced</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 pt-6 sm:px-6">
        {connError && activeTab !== 'settings' && (
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900">
            <div className="text-xs sm:text-sm">
              <p className="font-semibold">Cannot connect to Attendance Server</p>
              <p className="text-rose-700 mt-0.5">{connError}</p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className="self-start sm:self-center shrink-0 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-700 transition"
            >
              Configure Server / Key
            </button>
          </div>
        )}

        {activeTab === 'dashboard' && (
          <DashboardView
            statusData={statusData}
            loading={loading}
            onRefresh={loadStatus}
            onNavigateSettings={() => setActiveTab('settings')}
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
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md sm:hidden">
        <div className="grid grid-cols-3">
          {TABS.map(({ id, label, Icon }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-semibold transition ${
                  isActive ? 'text-indigo-600' : 'text-slate-500'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
