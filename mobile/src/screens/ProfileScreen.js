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
} = require('react-native');
const { getAuthUser, updateProfile } = require('../api');

function ProfileScreen({
  statusData,
  onRefreshStatus,
  onReopenSetup,
  onLogout,
}) {
  const [username, setUsername] = useState(
    statusData?.user?.username || 'sunil'
  );
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    if (statusData?.user?.username) {
      setUsername(statusData.user.username);
    } else {
      getAuthUser().then((u) => {
        if (u?.username) setUsername(u.username);
      });
    }
  }, [statusData]);

  async function handleSaveProfile() {
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
      setFeedback({ type: 'success', text: 'User profile updated.' });
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
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Minimal User Credentials Card */}
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(username || 'U').slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <View>
            <Text style={styles.cardTitle}>User Profile</Text>
            <Text style={styles.cardSub}>
              Update your login username and password
            </Text>
          </View>
        </View>

        <Text style={styles.label}>Username</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="sunil"
          placeholderTextColor="#94a3b8"
        />

        <View style={styles.rowBetween}>
          <Text style={styles.label}>
            New Password{' '}
            <Text style={styles.optionalHint}>(blank to keep current)</Text>
          </Text>
          <TouchableOpacity onPress={() => setShowPass((v) => !v)}>
            <Text style={styles.linkText}>{showPass ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPass}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Enter new password"
          placeholderTextColor="#94a3b8"
        />

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
              {feedback.text}
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.primaryBtn, saving && styles.disabledBtn]}
          onPress={handleSaveProfile}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Text style={styles.primaryBtnText}>Save Changes</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Session & Setup Actions */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>SESSION & SETUP</Text>

        <TouchableOpacity style={styles.secondaryBtn} onPress={onReopenSetup}>
          <Text style={styles.secondaryBtnText}>Run Initial Setup</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}>
          <Text style={styles.logoutBtnText}>Log Out</Text>
        </TouchableOpacity>
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
    gap: 16,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 14,
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
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
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  optionalHint: {
    fontWeight: '400',
    color: '#94a3b8',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  linkText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0f172a',
    marginBottom: 12,
  },
  primaryBtn: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  disabledBtn: {
    opacity: 0.6,
  },
  feedbackBox: {
    padding: 10,
    borderRadius: 10,
    marginBottom: 10,
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
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  secondaryBtn: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    marginBottom: 10,
  },
  secondaryBtnText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
  },
  logoutBtn: {
    backgroundColor: '#fff1f2',
    borderWidth: 1,
    borderColor: '#fecdd3',
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  logoutBtnText: {
    color: '#be123c',
    fontSize: 13,
    fontWeight: '700',
  },
});

module.exports = ProfileScreen;
