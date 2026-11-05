# Attendance Tracker

An automated personal attendance tracking application and web portal designed for a single user.

The system allows you to configure your work location and daily arrival time window. When your mobile device enters the designated work location within the scheduled time, you are automatically marked **Present** without needing to open the app or remember to check in manually.

---

## 📌 Architecture Overview

Because standard web browsers on iOS and Android cannot execute background location monitoring when the device is locked, the project is structured as a dual-client system:

1. **Mobile Application (iOS / Android)**:
   - Registers native OS circular geofences (`CLCircularRegion` on iOS, `GeofenceManager` on Android) via React Native / Expo.
   - Wakes up in the background upon entering the destination and dispatches an arrival payload to the backend.
   - Minimal battery consumption (uses cell tower & Wi-Fi transitions; activates GPS only when approaching the geofence perimeter).
2. **Web Portal (Desktop & Mobile Web)**:
   - Interactive map to set work location coordinates and radius.
   - Schedule configuration (work days, arrival window, grace periods).
   - Monthly calendar heatmaps, attendance streaks, and manual adjustments/overrides.
3. **Backend Service**:
   - Manages schedules, computes attendance status (`PRESENT`, `LATE`, `ABSENT`), stores historical logs, and sends push notifications upon check-in.

---

## 📁 Repository Structure (Planned)

```text
AttendanceTracker/
├── apps/
│   ├── web/               # Web Dashboard (Next.js / Vite + React + Tailwind + Mapbox/Leaflet)
│   └── mobile/            # Mobile Client (Expo / React Native with Background Geofencing)
├── packages/
│   ├── api/               # Backend API / Cloud functions / Database service
│   └── shared/            # Shared TypeScript types, validation schemas, and constants
├── docs/
│   └── TECHNICAL_REQUIREMENTS.md  # Complete technical specifications & design docs
├── .gitignore
└── README.md
```

---

## 📖 Documentation
Detailed architectural specifications, data models, API endpoints, and technical constraints are available in [docs/TECHNICAL_REQUIREMENTS.md](docs/TECHNICAL_REQUIREMENTS.md).
