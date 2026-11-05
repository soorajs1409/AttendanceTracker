const { registerRootComponent } = require('expo');
const Notifications = require('expo-notifications');
const { registerBackgroundGeofenceTask } = require('./src/geofence');
const App = require('./App');

// Configure notifications to display alerts even when app is open
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Register OS headless geofencing task at module top-level
registerBackgroundGeofenceTask();

registerRootComponent(App);
