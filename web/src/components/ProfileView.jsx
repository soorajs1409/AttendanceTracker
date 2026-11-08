import React, { useEffect, useState } from 'react';
import {
  User,
  Lock,
  LogOut,
  RotateCcw,
  Save,
  Eye,
  EyeOff,
  Sun,
  Moon,
  // Smartphone,
  // Download,
} from 'lucide-react';
import { getAuthUser, updateProfile } from '../api';

export default function ProfileView({
  statusData,
  theme,
  onToggleTheme,
  onRefreshStatus,
  onReopenSetup,
  onLogout,
}) {
  const currentUser = statusData?.user || getAuthUser() || { username: 'sunil' };

  const [username, setUsername] = useState(currentUser.username || 'sunil');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    if (statusData?.user?.username) {
      setUsername(statusData.user.username);
    }
  }, [statusData]);

  async function handleSaveProfile(e) {
    e.preventDefault();
    setFeedback(null);

    if (!username.trim()) {
      setFeedback({ type: 'error', text: 'Username cannot be empty.' });
      return;
    }

    setSaving(true);
    try {
      await updateProfile({
        username: username.trim(),
        ...(password ? { password } : {}),
      });
      setPassword('');
      setFeedback({
        type: 'success',
        text: 'User profile updated.',
      });
      if (onRefreshStatus) await onRefreshStatus();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err.message || 'Failed to update profile.',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      {/* User Credentials Card */}
      <form
        onSubmit={handleSaveProfile}
        className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 sm:p-6 space-y-4"
      >
        <div className="flex items-center gap-3 border-b border-zinc-100 dark:border-zinc-800 pb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-semibold text-sm">
            {(username || 'U').slice(0, 1).toUpperCase()}
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              User Profile
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Update your login username and password
            </p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
            Username
          </label>
          <div className="relative">
            <User className="h-4 w-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 pl-9 pr-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:border-zinc-900 dark:focus:border-zinc-400 focus:bg-white dark:focus:bg-zinc-900 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
            New Password{' '}
            <span className="font-normal text-zinc-400 dark:text-zinc-500">
              (leave blank to keep current)
            </span>
          </label>
          <div className="relative">
            <Lock className="h-4 w-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type={showPass ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter new password"
              className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 pl-9 pr-10 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:border-zinc-900 dark:focus:border-zinc-400 focus:bg-white dark:focus:bg-zinc-900 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPass((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              {showPass ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {feedback && (
          <div
            className={`rounded-md px-3.5 py-2 text-xs font-medium border ${
              feedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/60'
                : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/60'
            }`}
          >
            {feedback.text}
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-md bg-zinc-900 dark:bg-zinc-100 px-4 py-2 text-xs font-medium text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-60 transition"
          >
            <Save className="h-3.5 w-3.5" />
            <span>{saving ? 'Saving...' : 'Save Changes'}</span>
          </button>
        </div>
      </form>

      {/* Appearance Switcher */}
      {onToggleTheme && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 sm:p-6 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Appearance
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Currently using {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
            </p>
          </div>
          <button
            type="button"
            onClick={onToggleTheme}
            className="inline-flex items-center gap-2 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3.5 py-2 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="h-3.5 w-3.5 text-amber-400" />
                <span>Switch to Light</span>
              </>
            ) : (
              <>
                <Moon className="h-3.5 w-3.5 text-zinc-600" />
                <span>Switch to Dark</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Mobile App Download Card (Commented out while mobile deployment is disabled)
      <div className="rounded-lg border border-zinc-200 bg-white p-5 sm:p-6 space-y-3">
        ...
      </div>
      */}

      {/* Account Actions */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 sm:p-6 space-y-3">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          Session & Setup
        </h3>

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={onReopenSetup}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-4 py-2.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Run Initial Setup</span>
          </button>

          <button
            type="button"
            onClick={onLogout}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-md border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 px-4 py-2.5 text-xs font-medium text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/70 transition"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Log Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
