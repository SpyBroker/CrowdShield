# 🛡️ CrowdShield

**AI-Powered Real-Time Crowd Stampede Early Warning System**

CrowdShield is a fully simulated but production-architected prototype that detects and prevents crowd crush events before they happen. It combines an agent-based crowd physics simulation, a trained ML risk classifier, a rule-based recommendation engine, a real-time command dashboard, and a citizen-facing Progressive Web App — all streaming live over WebSocket.

> Built for Demo Day · Aug 23, 2026

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  CrowdShield Stack                       │
├──────────────┬──────────────────────┬───────────────────┤
│  Simulation  │      Backend API     │     Frontends     │
│  (Mesa ABM)  │  (FastAPI + uvicorn) │                   │
│              │                      │  React Dashboard  │
│  100×100m    │  WebSocket /ws       │  (Vite + React)   │
│  venue grid  │  REST endpoints      │                   │
│              │  H3 spatial binning  │  Citizen PWA      │
│  Agent-based │  ML Classifier       │  (Leaflet HTML)   │
│  crowd model │  Recommendation Eng  │                   │
└──────────────┴──────────────────────┴───────────────────┘
```

**Data flow:** Agents move → positions binned into Uber H3 hexagons → features extracted → GradientBoosting ML classifier scores each hex → Recommendation Engine fires alerts → WebSocket pushes frame to dashboard every ~1s → React renders live hex map + charts.

---

## 📂 Project Structure

```
CrowdProject/
├── backend/
│   ├── main.py                  # FastAPI server, WebSocket broadcast, REST API
│   ├── simulation.py            # Mesa agent-based crowd simulation (100×100m)
│   ├── recommendation.py        # Rule + ML hybrid recommendation engine
│   ├── generate_training_data.py # Script to regenerate ML training data
│   ├── train_classifier.py      # Trains the GradientBoosting risk classifier
│   ├── risk_model.pkl           # Trained ML model (already included)
│   ├── model_scaler.pkl         # Feature scaler (already included)
│   ├── training_data.csv        # Labelled simulation dataset
│   └── requirements.txt         # Python dependencies
│
├── dashboard/                   # React command dashboard (Vite)
│   ├── src/
│   │   ├── App.jsx              # Main dashboard UI (map, charts, tabs)
│   │   └── index.css            # Dark-mode design system
│   └── dist/                    # Built static files (served by backend)
│
├── pwa-dist/                    # Citizen-facing Progressive Web App
│   └── index.html               # Leaflet map + incident report form
│
├── stress_test.py               # Automated API stress test (16 checks)
├── integration_test.py          # Full feature integration test (22 checks)
├── live_demo_script.md          # Step-by-step Demo Day script
└── architecture_diagram.md      # System architecture diagrams
```

---

## ⚡ Quick Start

### Prerequisites
- Python 3.10+ with `venv`
- Node.js 18+ and `npm`

---

### Step 1 — Clone & Set Up the Python Environment

```powershell
# From the CrowdProject root
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
```

---

### Step 2 — Build the React Dashboard

```powershell
cd dashboard
npm install
npm run build
cd ..
```

> The build output goes to `dashboard/dist/` which is already configured to be served by the FastAPI backend at `/`.

---

### Step 3 — Start the Backend Server

```powershell
# From the CrowdProject root (with venv active)
venv\Scripts\uvicorn.exe main:app --app-dir backend --port 8000
```

The server starts at **`http://localhost:8000`**

---

### Step 4 — Open the Apps

| URL | What it is |
|-----|-----------|
| `http://localhost:8000/` | 🖥️ Command Dashboard (React) |
| `http://localhost:8000/pwa/` | 📱 Citizen PWA (mobile-friendly) |
| `http://localhost:8000/docs` | 📄 FastAPI Swagger API docs |

---

## 🎮 Dashboard Features

### Map Toolbar (top-right of map)
| Button | Action |
|--------|--------|
| 🖱️ Mouse pointer | Select mode — click map to auto-fill incident coordinates |
| 🔵 `+` | Add custom entrance point |
| 🟢 `+` | Add custom safe exit point |
| 🔴 ⚠️ | Add red zone obstacle |
| 🧊 | Toggle **3D perspective view** (CSS digital twin mode) |
| **▶ Demo Drill** | Runs automated 50-second crisis scenario end-to-end |

### Bottom Analytics Panel Tabs
| Tab | Contents |
|-----|---------|
| 📈 Analytics & Graphs | Live crowd density, speed, risk cell charts + hex drill-down |
| 📋 Incident Logs | All reported incidents with coordinates and timestamps |
| 🤖 AI Recommendation Logs | Full recommendation history with severity and action codes |
| 📖 Operations Manual | Operator guide for all features |
| 🎤 Pitch Deck | 6-slide animated project pitch (for demo judges) |

### Sidebar Controls
- **Surge Mode toggle** — doubles crowd spawn rate to simulate event surge
- **AI Summary** — generates plain-English incident summary (Gemini API or static fallback)
- **Audio / Voice / Siren toggles** — control alert sound types
- **Dispatch Citizen Report form** — submit incidents with GPS coordinates

---

## 🔌 REST API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/status` | Agent count, surge mode, active incidents |
| `POST` | `/toggle-surge` | Toggle crowd surge spawning |
| `POST` | `/report-incident` | Submit a citizen incident report |
| `GET` | `/incidents` | List all reported incidents |
| `GET` | `/recommendations` | Full recommendation history |
| `GET` | `/recommendations/active` | Active (unacknowledged) recommendations |
| `POST` | `/acknowledge-recommendation` | Acknowledge a recommendation by ID |
| `GET` | `/incident-summary` | AI-generated or static incident summary |
| `POST` | `/update-simulation-assets` | Update entrances, exits, obstacles |
| `POST` | `/trigger-drill` | Start automated 50-second demo drill |
| `WS` | `/ws` | WebSocket live data stream |

Full interactive docs at `http://localhost:8000/docs`

---

## 🧪 Running Tests

### Stress Test — 16 API checks
```powershell
venv\Scripts\python.exe stress_test.py
# or against a remote URL:
venv\Scripts\python.exe stress_test.py --url https://your-deployment-url.com
```

### Integration Test — 22 full-stack feature checks
```powershell
venv\Scripts\python.exe integration_test.py
```

Expected output: `22/22 checks passed — All systems nominal`

---

## 🤖 ML Classifier

- **Algorithm:** GradientBoostingClassifier (scikit-learn)
- **Accuracy:** 99.97% on held-out validation set
- **Features:** `density`, `avg_speed`, `flow_variance`, `d_density`, `d_speed`, `d_flow`, `entry_dist`
- **Labels:** `green` (safe) · `amber` (caution) · `red` (critical)
- **Integration:** Dual-gate fusion — rule engine pre-filters, ML scores each hex cell per frame

To retrain the model from scratch:
```powershell
cd backend
..\venv\Scripts\python.exe generate_training_data.py   # generates training_data.csv
..\venv\Scripts\python.exe train_classifier.py          # trains & saves risk_model.pkl
```

---

## 🔴 Demo Drill — Automated Crisis Scenario

Click **▶ Demo Drill** in the dashboard toolbar (or `POST /trigger-drill`) to run a scripted sequence:

| Time | Event |
|------|-------|
| T+0s | Normal crowd flow, all green cells |
| T+8s | **Surge mode ON** — crowd density climbs, amber zones appear |
| T+20s | **Bottleneck obstacle placed** — RED alerts fire, recommendations trigger |
| T+35s | Obstacle removed — agents reroute, recovery begins |
| T+45s | Surge OFF — full green recovery, drill complete |

---

## 🛠️ Development

### Rebuild dashboard after code changes
```powershell
cd dashboard
npm run build
```

### Run dashboard in hot-reload dev mode (separate from backend)
```powershell
cd dashboard
npm run dev   # runs on http://localhost:5173
```

### Lint / format
```powershell
cd dashboard
npm run lint
```

---

## 📦 Tech Stack

| Layer | Technology |
|-------|-----------|
| Crowd Simulation | Python · [Mesa ABM](https://mesa.readthedocs.io/) |
| Spatial Binning | [Uber H3](https://h3geo.org/) (Resolution 14, ~60m² cells) |
| ML Classifier | scikit-learn · GradientBoostingClassifier |
| Backend API | FastAPI · uvicorn · WebSocket |
| Command Dashboard | React 18 · Vite · Recharts · React-Leaflet |
| Citizen PWA | Vanilla HTML/JS · Leaflet · Service Worker |
| Map Tiles | CartoDB Dark Matter (OpenStreetMap) |

---

## 📜 License

MIT — built as a hackathon prototype. Not for production use without significant hardening.
