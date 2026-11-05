const { registerRootComponent } = require('expo');
const { registerBackgroundGeofenceTask } = require('./src/geofence');
const App = require('./App');

// Safely configure foreground notification behavior (guards against Expo Go sandbox limits)
try {
  const Notifications = require('expo-notifications');
  if (Notifications && typeof Notifications.setNotificationHandler === 'function') {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  }
} catch (err) {
  console.warn('Notification handler setup skipped:', err?.message || err);
}

// Safely register OS headless geofencing task at module top-level
try {
  registerBackgroundGeofenceTask();
} catch (err) {
  console.warn('Background geofence task registration skipped:', err?.message || err);
}

registerRootComponent(App);
