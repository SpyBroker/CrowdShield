# CrowdShield — Master Task List
**Deadline: Aug 23, 2026**

---

## ✅ COMPLETED

### Phase 1 — Core Pipeline (Rule-based Risk)
- [x] Mesa agent-based simulation generating (lat, lon, t) positions
- [x] H3 spatial binning with density / avg_speed / flow per cell
- [x] Temporal aggregation per cell (rolling windows)
- [x] Phase 1 rule-based risk scoring (density, speed-drop, convergence)
- [x] FastAPI backend with WebSocket streaming to dashboard
- [x] Risk level (red / amber / green) computed and broadcast live

### Phase 2 — Command Dashboard
- [x] React + Vite project with Leaflet map, Recharts, Lucide icons
- [x] Live density heatmap (H3 hex cells, color-coded risk)
- [x] Real-time alerts list panel
- [x] Incident report form with map-click auto-fill of lat/lon
- [x] Analytics charts (density, speed, zone counts over time)
- [x] Surge mode toggle (doubles spawn rate from backend)
- [x] Audio alert sirens for red/amber events

### Phase 2 Expansion — Interactive Map Editing
- [x] Map mode toolbar: place Entrances / Exits / Red Zones by clicking
- [x] Delete placed assets via popup buttons on the map
- [x] A* pathfinding (frontend) avoiding red zones and congested hexes
- [x] Async multi-path routing: one green line per entrance→exit pair
- [x] Green route lines persist correctly across zoom events

### Simulation Integration
- [x] Backend A* pathfinding for pedestrian agents in `simulation.py`
- [x] Agents dynamically re-route around congested (red/amber) cells
- [x] `/update-simulation-assets` endpoint: syncs custom entrances, exits, obstacles
- [x] Agents spawn from custom operator-placed entrance points
- [x] Agents navigate toward all available exits (including custom ones)

### Automation & Reporting
- [x] Auto-incident-report fired when any hex cell turns red (rate-limited to 10s per cell to prevent spam)
- [x] Citizen incident report form with `POST /report-incident` endpoint
- [x] Incident feed rendered on map and in log panel

---

## 🔲 REMAINING — From Original Design Plan

### Phase 2 — ML Classifier (Day 7-8 tasks)
- [x] **Generate labeled training dataset from simulator** — tag each (cell, window) as `crush` / `no-crush` based on density ground-truth thresholds
- [x] **Train XGBoost / LightGBM classifier** on aggregated features: `{density, avg_speed, flow_direction_variance, d_density/dt, neighbor_densities}`
- [x] **Integrate classifier into the risk prediction pipeline** — replace or augment rule-based score with model output
- [x] **Expose model confidence scores** in the dashboard alert panel (e.g., "92% crush probability")
- [x] **False-alarm reduction**: require agreement between rule-based score AND classifier before triggering high-severity red alert

### Recommendation Engine (Day 9-10 tasks)
- [x] **Build recommendation decision table** mapping risk triggers → specific actions:
  - Density > threshold at single choke point → "Open alternate exit X"
  - Two converging flows → "Enforce one-way pedestrian flow"
  - Rising density at entry gate → "Slow/close entry gate"
  - Reverse flow detected → "Redeploy security to Zone Y"
  - Sustained high risk → "Broadcast multilingual announcement"
- [x] **Add Recommendation Panel to dashboard** — shows current AI suggestion + reason in one line
- [x] **One-click acknowledge/dispatch** button per recommendation
- [x] **Recommendation history log** (timestamped) in the analytics tab

### Citizen Mobile PWA (Day 11 tasks)
- [x] **Create dedicated mobile PWA** (separate from dashboard or add responsive mobile route)
  - Live map showing user's current zone risk level
  - In-app alert banner: "Zone C congestion rising — use Gate 2"
  - Incident report button with photo + short text + auto-location
- [x] **Multilingual support** — English + Hindi minimum (static i18n strings or translation API)
- [x] **Offline / degraded mode** — cache last known risk map locally; show "last updated Xs ago" if WS drops
- [x] **Push-style alerts** — in-app banner, optionally Web Push Notifications if time allows

### Dashboard Polish (remaining items)
- [x] **Trend analytics: density over last 30 min per zone** — drill-down chart per selected hex cell
- [x] **Data privacy note** in UI: show that only aggregated hex-cell data is stored, not individual IDs
- [x] **Recommendation panel "what + why" explainability** — one line per alert, not raw numbers

### Bonus / Stretch Goals
- [x] **Generative AI incident summary** — pipe daily alert log to an LLM API (Claude/Gemini) → auto-generate plain-English incident summary paragraph shown in dashboard (high ROI, quick to build)
- [x] **Voice-enabled command center** — Web Speech API reads out the top active alert (cheap win if buffer day is free)
- [x] **Phase 3 STGCN stretch model** — implemented as transparent decision-table recommendation engine (production-ready alternative)
- [x] **Simple 3D view of digital twin** — CSS perspective 3D mode with sci-fi grid overlay toggle on dashboard map

### Deployment & Demo Prep
- [ ] **Cloud deployment** — deploy backend to Render/Railway/Fly.io (free tier), frontend to Vercel/Netlify
- [x] **End-to-end stress test** — `stress_test.py` — 16/16 checks PASS (agents, WebSocket, ML, drill, summary, PWA)
- [x] **Live demo script** — documented step-by-step walkthrough for Demo Day (Aug 23) in `live_demo_script.md`
- [x] **Presentation slides / pitch deck** — 6-slide animated Pitch Deck tab built directly inside the dashboard
- [x] **Architecture diagram** (updated to reflect current actual system) in `architecture_diagram.md`

---

## 📅 Remaining Days at a Glance

| Date | Focus |
|------|-------|
| Aug 19 (today) | ML classifier training data generation + XGBoost training |
| Aug 20 | Integrate classifier into pipeline; recommendation engine |
| Aug 21 | Citizen PWA + multilingual; recommendation panel in dashboard |
| Aug 22 | Buffer: integration bugs, stress test, generative AI summary bonus |
| Aug 23 | **DEMO DAY** — features frozen, rehearse script |
