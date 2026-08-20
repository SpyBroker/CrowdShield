# CrowdShield — Project Design Plan
**AI-Powered Early Warning System for Crowd Stampedes**
Deadline: **23 August 2026** (~2 weeks from today, 9 Aug)

---

## 0. Reality Check First — What "Done" Means by Aug 23

With ~14 days, you will **not** get real GPS/CCTV/SIM data, a trained STGCN/AGCRN model, and a production cloud deployment all working end-to-end. Trying to build all of it will leave you with nothing that runs on demo day.

**Strategy: build a simulated but fully-functional prototype.**
- Real crowd sensor data doesn't exist for you → **generate it** with a crowd simulation engine (PedPy / Mesa).
- The simulation feeds the *same* data pipeline a real deployment would use (GPS/SIM pings → binning → model → dashboard), so the architecture is real and swappable later — only the data source is synthetic.
- This is completely standard for hackathons/PoCs judging "predictive public safety," and it satisfies the bonus point for "AI-powered simulation of crowd movement" too.

So the goal by Aug 23 is:
> A working demo: simulated venue → live density/heatmap → risk prediction model flags a bottleneck 5–10 min before crowd crush → dashboard shows alert + recommended action → mobile app shows a push alert.

---

## 1. Scope Decisions (lock these before coding)

| Area | Decision |
|---|---|
| Data source | Simulated pedestrian movement (PedPy/Mesa) generating synthetic GPS-like pings, NOT real telecom data |
| Venue | One fixed digital-twin layout (e.g., a stadium/temple ground with gates, corridors, choke points) — drawn once in QGIS/CAD, reused everywhere |
| Prediction model | Start with a **lightweight, explainable model** (density-gradient + rule-based risk score + a small trained classifier), and layer STGCN/AGCRN as a "stretch" model if time allows |
| Cloud | Keep it minimal — one managed DB + one lightweight compute service. Full AWS Kinesis/Glue/SageMaker pipeline is the "future production" story, not the Aug 23 build |
| Mobile app | A single-screen web app (PWA) is enough — a native app is not necessary to prove the concept |
| Command dashboard | This is your centerpiece — invest the most polish here |

Cut ruthlessly. A working density heatmap + one accurate crush prediction + one clean recommendation flow, demoed live, beats seven half-built modules.

---

## 2. System Architecture

```
                         ┌─────────────────────────┐
                         │   CROWD SIMULATION       │
                         │   (PedPy / Mesa)         │
                         │  generates synthetic     │
                         │  agent positions @ 1-5s  │
                         └───────────┬──────────────┘
                                     │ synthetic "GPS/SIM pings"
                                     ▼
                         ┌─────────────────────────┐
                         │   INGESTION LAYER        │
                         │  WebSocket / REST stream │
                         │  → Redis / Kafka (or     │
                         │    simple queue for MVP) │
                         └───────────┬──────────────┘
                                     ▼
                         ┌─────────────────────────┐
                         │  PREPROCESSING SERVICE   │
                         │  - Spatial binning       │
                         │    (hex grid, H3 lib)    │
                         │  - Time aggregation      │
                         │    (5-30s windows)       │
                         │  - Density/flow/speed    │
                         │    computation            │
                         └───────────┬──────────────┘
                                     ▼
                    ┌────────────────┴────────────────┐
                    ▼                                  ▼
        ┌───────────────────────┐         ┌─────────────────────────┐
        │  RISK PREDICTION       │         │  STORAGE (time-series)  │
        │  ENGINE                │         │  Postgres/TimescaleDB   │
        │  - Rule-based risk     │◄────────┤  or Firestore for MVP   │
        │    score (v1)          │         └─────────────────────────┘
        │  - ML classifier (v2)  │
        │  - STGCN/AGCRN (v3,    │
        │    stretch goal)       │
        └───────────┬─────────────┘
                     ▼
        ┌─────────────────────────┐
        │  RECOMMENDATION ENGINE   │
        │  rule-based decision     │
        │  tree → action + reason  │
        └───────────┬─────────────┘
                     ▼
        ┌─────────────────────────┐         ┌──────────────────────┐
        │  BACKEND API             │────────►│  COMMAND DASHBOARD    │
        │  (FastAPI/Node)           │        │  React + deck.gl /    │
        │  REST + WebSocket push    │        │  Google Maps heatmap  │
        └───────────┬───────────────┘        └──────────────────────┘
                     │
                     ▼
        ┌─────────────────────────┐
        │  CITIZEN MOBILE APP (PWA) │
        │  push alerts, live map,   │
        │  incident reporting       │
        └───────────────────────────┘
```

---

## 3. Data Pipeline (detailed)

1. **Source (simulated):** PedPy or Mesa agent-based model generates (x, y, t) positions for N agents in the digital-twin venue layout. Inject controlled "surge events" (e.g., a gate opening late, a stage announcement) to create bottleneck scenarios for the model to detect.
2. **Spatial binning:** Use **H3 (Uber's hex grid library)** instead of building custom hexagon math — free, well-documented, works in Python/JS. Bin agent positions into hex cells (~5-10m resolution).
3. **Temporal aggregation:** Roll up into 5–15s windows per cell: `{density, avg_speed, flow_direction, direction_variance}`.
4. **Feature store (lightweight):** Keep last N windows per cell in memory (Redis) for the model's temporal context; persist to Postgres/TimescaleDB for dashboard history/trend analytics.
5. **Streaming to frontend:** Backend pushes cell updates over WebSocket every few seconds → dashboard heatmap updates live.

---

## 4. Model Plan (phased — don't start with STGCN)

### Phase 1 (Day 1-4): Rule-based risk score — get *something* working end-to-end
Risk score per cell = weighted function of:
- density (people/m²) vs. a safety threshold (~4-6 people/m² is crush-risk zone per crowd-safety literature)
- rate of density increase (d(density)/dt)
- flow convergence (multiple directions merging into one cell)
- speed drop (crowd slowing sharply = early crush indicator)

This alone can trigger "possible crowd crush in this zone" alerts and is enough to make the whole pipeline demoable by day 4.

### Phase 2 (Day 5-9): Small supervised classifier
Use your simulation to generate labeled sequences (crush / no-crush, based on ground-truth density in the simulator) and train a small model:
- **Option A (simplest, recommended):** Gradient-boosted tree (XGBoost/LightGBM) on the aggregated features per cell + short time window → binary/graded risk classification. Fast to train, easy to explain to judges, doesn't need GPU.
- **Option B (if time allows):** Small CNN over the hex-grid-as-image (density map) to catch spatial patterns → crowd counting/density estimation, closer to your original CNN idea.

### Phase 3 (stretch, Day 10-12): Spatio-temporal graph model
If Phase 1-2 are solid and stable, add an **STGCN** (treat hex cells or venue zones as graph nodes, edges = adjacency/walkable paths) to capture how congestion in one zone propagates to neighbors — this maps directly to "panic propagation" and "which gates should close." AGCRN is a nice-to-mention future upgrade (learns dynamic adjacency) but implementing it well in days is risky — mention it in your report as the "v2 roadmap," don't gamble the demo on it.

**Important:** train/validate against your own simulator output, and clearly label in your presentation that the model is trained on simulated data with a stated path to retrain on real deployment data (real CCTV/GPS feeds later). Judges respect this honesty far more than an overstated claim.

---

## 5. Recommendation Engine

Keep this a transparent decision table, not a black box — it's easy to build and easy to justify in a demo:

| Trigger | Recommended Action |
|---|---|
| Density > threshold & rising, single choke point | Open nearest alternate exit; redirect flow via app + announcement |
| Two flows converging into one cell | Recommend one-way pedestrian flow / barricade reconfiguration |
| Density rising near an entry gate | Temporarily close/slow that entry gate |
| Reverse flow detected against dominant direction | Flag high-risk, recommend security redeployment to that zone |
| Sustained high risk, no mitigation in effect | Escalate: broadcast multilingual announcement + notify control room operator |

This maps 1:1 to the "Intelligent Recommendations" requirement in the problem statement, and is genuinely explainable — a strength for judging.

---

## 6. Command Dashboard

- **Stack:** React + Google Maps JS API (or Mapbox) for the base map, deck.gl for the heatmap/hexagon layer, WebSocket client for live updates.
- **Screens:**
  1. Live venue map with density heatmap (color-coded hex cells)
  2. Risk zone overlay (red/amber/green) with active alerts list
  3. Trend chart (density over last 30 min per zone) — Recharts
  4. Recommendation panel — shows current AI suggestion + one-click "acknowledge/dispatch"
  5. Incident feed (from citizen app reports)

## 7. Citizen Mobile App (PWA)

- Single React PWA (no native build needed for a demo) with:
  - Live map with your current zone's risk level
  - Push-style in-app alert banner ("Zone C congestion rising — use Gate 2")
  - Simple incident report button (photo + short text + auto-location)
  - Multilingual toggle (English/Hindi minimum; use a translation API or static i18n strings)

---

## 8. Tech Stack (buildable in 2 weeks)

| Layer | Tool |
|---|---|
| Simulation | PedPy or Mesa (Python) |
| Spatial binning | H3 (Python `h3` / JS `h3-js`) |
| Backend | FastAPI (Python) — pairs naturally with your ML code |
| Realtime | WebSockets (FastAPI native) or Socket.IO |
| DB | Postgres + TimescaleDB extension (or plain Postgres if time-short); Redis for hot-path cache |
| ML | scikit-learn / XGBoost for Phase 2; PyTorch only if you attempt Phase 3 |
| Frontend dashboard | React + Vite, deck.gl, Google Maps JS API, Recharts |
| Mobile | React PWA (shared component library with dashboard where possible) |
| Hosting (demo-scale) | Render/Railway/Fly.io for backend, Vercel/Netlify for frontend — free/cheap, fast to deploy, avoids AWS setup overhead. Mention AWS Kinesis/Glue/SageMaker/Vertex AI as the **production scale-up path** in your slides, not what you actually deploy in 2 weeks |

---

## 9. Timeline (Aug 9 → Aug 23)

| Days | Milestone |
|---|---|
| Day 1-2 (Aug 9-10) | Finalize venue layout (digital twin), set up repo, pick final scope, PedPy/Mesa simulation producing (x,y,t) agent data |
| Day 3-4 (Aug 11-12) | Ingestion + H3 binning + aggregation pipeline; Phase 1 rule-based risk score; basic FastAPI backend serving live data |
| Day 5-6 (Aug 13-14) | Dashboard v1: live heatmap rendering from backend WebSocket feed |
| Day 7-8 (Aug 15-16) | Generate labeled training data from simulator; train Phase 2 XGBoost classifier; integrate into pipeline |
| Day 9-10 (Aug 17-18) | Recommendation engine + dashboard alert/recommendation panel; start mobile PWA |
| Day 11 (Aug 19) | Mobile PWA complete (map, alerts, incident reporting); multilingual strings |
| Day 12 (Aug 20) | **Buffer day** — fix integration bugs, stress-test the demo scenario end-to-end |
| Day 13 (Aug 21) | Stretch goal: attempt STGCN if everything above is stable; otherwise polish + trend analytics |
| Day 14 (Aug 22) | Freeze features. Rehearse the live demo script 3-4 times. Build the deck. |
| Aug 23 | Submission / Demo day |

**Rule:** if by Day 10 (Aug 18) the core pipeline (simulation → heatmap → risk alert → recommendation) isn't fully working, drop the stretch model entirely and spend remaining days polishing what works. A stable simple demo beats a broken sophisticated one.

---

## 10. Team Split (adjust to your team size)

1. **Simulation & Data Engineer** — PedPy/Mesa, digital twin layout, H3 binning, synthetic scenario design (this is the "ground truth" for everything else, start here first)
2. **Backend/ML Engineer** — FastAPI, WebSocket streaming, risk model (Phase 1→2→3), recommendation engine
3. **Frontend Engineer (Dashboard)** — React + deck.gl + Maps heatmap, trend charts, alert UI
4. **Frontend Engineer (Mobile/PWA)** — citizen app, multilingual, incident reporting, can also help dashboard once done
5. **(if 5th member) Presentation/Docs/Integration owner** — architecture diagrams, pitch deck, demo script, tests end-to-end integration continuously (don't leave this to the last day)

---

## 11. Addressing the Stated Constraints Directly

- **Limited infrastructure / low-cost deployment:** simulation-driven MVP on Render/Vercel free tiers; production path clearly documented as AWS/GCP managed services.
- **Network outages:** design the mobile PWA to cache the last known risk map locally and degrade gracefully (show "last updated Xs ago" rather than break).
- **Data privacy:** since real deployment would use SIM/GPS pings, note in your design that only aggregated density per hex-cell is stored — no individual device IDs persisted beyond the aggregation window. Mention this explicitly in the report; it directly answers the "Data privacy" constraint.
- **False alarm reduction:** this is why Phase 1's rule-based score matters — you can tune/explain thresholds live, and combine with the classifier's confidence to require agreement between both before triggering a high-severity alert (reduces single-signal false positives).
- **Ease of use by authorities:** dashboard's recommendation panel should say *what* to do and *why* in one line, not just raw numbers — judges will notice this UX choice.

---

## 12. What to Say for the Bonus Features (be honest, be strategic)

- **Digital Twin of venue** ✅ — you're building this anyway as your simulation layout, just present it well (2D map, or a simple 3D view if time allows).
- **AI-powered simulation of crowd movement** ✅ — PedPy/Mesa literally is this.
- **Voice-enabled command center** — likely skip unless Day 12 buffer is unused; if attempted, a simple Web Speech API "read out top alert" is a cheap win.
- **Multilingual AI assistant** — partially covered by multilingual alerts; a full assistant is a stretch, low priority.
- **Generative AI for incident summaries** — cheap, high-impact bonus: pipe the day's alert log into an LLM API call (e.g., Claude API) to auto-generate a plain-English incident summary paragraph for the dashboard. Worth doing in a spare afternoon — good ROI.

---

## 13. Immediate Next Actions

1. Freeze the venue layout (one clear map with gates/corridors/choke points) — everything downstream depends on this.
2. Set up the repo structure and pick the exact simulation tool (PedPy vs Mesa — PedPy is more crowd-dynamics-specific and less setup; recommend PedPy first).
3. Get a "dumb" version of the full pipeline running end-to-end by Day 4 (simulated dot moving on a map, even before any real modeling) — this de-risks integration early, which is historically the biggest killer of hackathon demos.
