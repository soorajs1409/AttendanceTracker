import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LocateFixed, Search, MapPin } from 'lucide-react';

// Custom crisp SVG marker icon so we never rely on broken default PNG asset paths
const workPinIcon = L.divIcon({
  className: 'custom-work-pin',
  html: `
    <div style="
      width: 34px;
      height: 34px;
      border-radius: 9999px;
      background: #4f46e5;
      border: 3px solid #ffffff;
      box-shadow: 0 6px 16px rgba(79, 70, 229, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <div style="width: 10px; height: 10px; border-radius: 9999px; background: #ffffff;"></div>
    </div>
  `,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

export default function LocationMapPicker({
  latitude,
  longitude,
  radiusMeters,
  onChangeCoords,
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const circleRef = useRef(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);

  const hasValidPoint =
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    (latitude !== 0 || longitude !== 0);

  // Default fallback center (Bengaluru / India) until configured
  const initialCenter = hasValidPoint ? [latitude, longitude] : [12.9716, 77.5946];
  const initialZoom = hasValidPoint ? 16 : 12;

  // Initialize Leaflet Map once
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: initialZoom,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const marker = L.marker(initialCenter, {
      draggable: true,
      icon: workPinIcon,
    }).addTo(map);

    const circle = L.circle(initialCenter, {
      radius: radiusMeters || 100,
      color: '#4f46e5',
      weight: 2,
      fillColor: '#6366f1',
      fillOpacity: 0.18,
    }).addTo(map);

    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      const lat = Number(pos.lat.toFixed(6));
      const lng = Number(pos.lng.toFixed(6));
      circle.setLatLng([lat, lng]);
      onChangeCoords(lat, lng);
    });

    map.on('click', (e) => {
      const lat = Number(e.latlng.lat.toFixed(6));
      const lng = Number(e.latlng.lng.toFixed(6));
      marker.setLatLng([lat, lng]);
      circle.setLatLng([lat, lng]);
      onChangeCoords(lat, lng);
    });

    mapInstanceRef.current = map;
    markerRef.current = marker;
    circleRef.current = circle;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external coordinate / radius updates to Leaflet marker & circle
  useEffect(() => {
    const map = mapInstanceRef.current;
    const marker = markerRef.current;
    const circle = circleRef.current;
    if (!map || !marker || !circle) return;

    if (
      typeof latitude === 'number' &&
      typeof longitude === 'number' &&
      !Number.isNaN(latitude) &&
      !Number.isNaN(longitude) &&
      (latitude !== 0 || longitude !== 0)
    ) {
      const cur = marker.getLatLng();
      const dist = Math.abs(cur.lat - latitude) + Math.abs(cur.lng - longitude);
      marker.setLatLng([latitude, longitude]);
      circle.setLatLng([latitude, longitude]);
      if (dist > 0.002) {
        map.setView([latitude, longitude], Math.max(map.getZoom(), 16));
      }
    }
    circle.setRadius(Number(radiusMeters) || 100);
  }, [latitude, longitude, radiusMeters]);

  async function handleAddressSearch(e) {
    if (e) e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(
          q
        )}`
      );
      if (res.ok) {
        const list = await res.json();
        setSearchResults(list || []);
      }
    } catch {
      // Ignore network errors if offline
    } finally {
      setSearching(false);
    }
  }

  function handleSelectPlace(place) {
    const lat = Number(parseFloat(place.lat).toFixed(6));
    const lng = Number(parseFloat(place.lon).toFixed(6));
    onChangeCoords(lat, lng);
    setSearchResults([]);
    setSearchQuery(place.display_name.split(',')[0] || searchQuery);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([lat, lng], 17);
    }
  }

  function handleUseCurrentLocation() {
    if (!('geolocation' in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        onChangeCoords(lat, lng);
        if (mapInstanceRef.current) {
          mapInstanceRef.current.setView([lat, lng], 17);
        }
        setLocating(false);
      },
      () => {
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 6000 }
    );
  }

  return (
    <div className="space-y-3">
      {/* Search Bar + Current Location Button */}
      <div className="relative flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddressSearch();
                }
              }}
              placeholder="Search workplace address or landmark..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={handleAddressSearch}
            disabled={searching}
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            {searching ? '...' : 'Search'}
          </button>
        </div>

        <button
          type="button"
          onClick={handleUseCurrentLocation}
          disabled={locating}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition"
        >
          <LocateFixed className="h-4 w-4" />
          <span>{locating ? 'Locating...' : 'Use My Location'}</span>
        </button>

        {/* Search Dropdown Results */}
        {searchResults.length > 0 && (
          <div className="absolute left-0 right-0 top-12 z-30 rounded-xl border border-slate-200 bg-white shadow-xl divide-y divide-slate-100 overflow-hidden">
            {searchResults.map((place) => (
              <button
                key={place.place_id}
                type="button"
                onClick={() => handleSelectPlace(place)}
                className="w-full flex items-start gap-2.5 px-3.5 py-2.5 text-left text-xs hover:bg-indigo-50 transition"
              >
                <MapPin className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5" />
                <span className="text-slate-700 line-clamp-2">
                  {place.display_name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Interactive Map Canvas */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-inner">
        <div ref={mapContainerRef} className="h-72 sm:h-80 w-full bg-slate-100" />
      </div>

      <p className="text-xs text-slate-500">
        Tip: Click anywhere on the map or drag the blue pin to place your workplace boundary.
      </p>
    </div>
  );
}
