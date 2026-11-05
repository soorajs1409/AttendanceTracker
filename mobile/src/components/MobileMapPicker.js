const React = require('react');
const { useRef, useEffect, useMemo } = React;
const { View, StyleSheet } = require('react-native');
const { WebView } = require('react-native-webview');

function buildLeafletHtml(initialLat, initialLng, initialRadius) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #f1f5f9; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    const startLat = ${Number(initialLat) || 12.9716};
    const startLng = ${Number(initialLng) || 77.5946};
    const startRadius = ${Number(initialRadius) || 100};

    const map = L.map('map', { zoomControl: true }).setView([startLat, startLng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OSM'
    }).addTo(map);

    const pinIcon = L.divIcon({
      className: 'pin',
      html: '<div style="width:30px;height:30px;border-radius:999px;background:#4f46e5;border:3px solid #fff;box-shadow:0 4px 12px rgba(79,70,229,0.45);display:flex;align-items:center;justify-content:center;"><div style="width:8px;height:8px;border-radius:999px;background:#fff;"></div></div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    const marker = L.marker([startLat, startLng], { draggable: true, icon: pinIcon }).addTo(map);
    const circle = L.circle([startLat, startLng], {
      radius: startRadius,
      color: '#4f46e5',
      weight: 2,
      fillColor: '#6366f1',
      fillOpacity: 0.18
    }).addTo(map);

    function notifyRN(lat, lng) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'coords',
          latitude: Number(lat.toFixed(6)),
          longitude: Number(lng.toFixed(6))
        }));
      }
    }

    marker.on('dragend', function () {
      const p = marker.getLatLng();
      circle.setLatLng(p);
      notifyRN(p.lat, p.lng);
    });

    map.on('click', function (e) {
      marker.setLatLng(e.latlng);
      circle.setLatLng(e.latlng);
      notifyRN(e.latlng.lat, e.latlng.lng);
    });

    window.updateFromRN = function (lat, lng, radius) {
      if (typeof lat === 'number' && typeof lng === 'number' && (lat !== 0 || lng !== 0)) {
        const cur = marker.getLatLng();
        const delta = Math.abs(cur.lat - lat) + Math.abs(cur.lng - lng);
        marker.setLatLng([lat, lng]);
        circle.setLatLng([lat, lng]);
        if (delta > 0.002) {
          map.setView([lat, lng], Math.max(map.getZoom(), 16));
        }
      }
      if (typeof radius === 'number' && radius > 0) {
        circle.setRadius(radius);
      }
    };
  </script>
</body>
</html>`;
}

function MobileMapPicker({ latitude, longitude, radiusMeters, onChangeCoords }) {
  const webViewRef = useRef(null);

  const hasValid =
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    (latitude !== 0 || longitude !== 0);

  // Memoize initial HTML so WebView does not reload on every slider/coord change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialHtml = useMemo(
    () =>
      buildLeafletHtml(
        hasValid ? latitude : 12.9716,
        hasValid ? longitude : 77.5946,
        radiusMeters || 100
      ),
    []
  );

  useEffect(() => {
    if (!webViewRef.current) return;
    const lat = Number(latitude) || 0;
    const lng = Number(longitude) || 0;
    const rad = Number(radiusMeters) || 100;
    webViewRef.current.injectJavaScript(
      `if (window.updateFromRN) { window.updateFromRN(${lat}, ${lng}, ${rad}); } true;`
    );
  }, [latitude, longitude, radiusMeters]);

  function handleMessage(event) {
    try {
      const payload = JSON.parse(event.nativeEvent.data);
      if (
        payload?.type === 'coords' &&
        typeof payload.latitude === 'number' &&
        typeof payload.longitude === 'number'
      ) {
        onChangeCoords(payload.latitude, payload.longitude);
      }
    } catch {
      // Ignore malformed messages
    }
  }

  return (
    <View style={styles.mapWrap}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: initialHtml }}
        onMessage={handleMessage}
        scrollEnabled={false}
        nestedScrollEnabled={true}
        style={styles.webview}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  mapWrap: {
    height: 240,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f1f5f9',
  },
  webview: {
    flex: 1,
  },
});

module.exports = MobileMapPicker;
