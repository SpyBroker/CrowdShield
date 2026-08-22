import asyncio
import math
import json
import logging
import os
import pickle
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional
import h3
from simulation import VenueCrowdModel
from recommendation import RecommendationEngine

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("crowdshield-backend")

app = FastAPI(title="CrowdShield Backend", version="1.0.0")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Reference location (New Delhi, India)
LAT_ANCHOR = 28.6139
LON_ANCHOR = 77.2090

# H3 Resolution for spatial binning
H3_RESOLUTION = 14  # Average area ~60m2, edge length ~4.8m

# Initialize simulator (100x100m grid, dt=1.0)
sim_model = VenueCrowdModel(width=100, height=100, dt=1.0)

# ── Phase 2: ML Classifier ───────────────────────────────────────────────────
_BASE_DIR = os.path.dirname(__file__)
_MODEL_PATH = os.path.join(_BASE_DIR, "models", "risk_model.pkl")
if not os.path.exists(_MODEL_PATH):
    _MODEL_PATH = os.path.join(_BASE_DIR, "risk_model.pkl")

_SCALER_PATH = os.path.join(_BASE_DIR, "models", "model_scaler.pkl")
if not os.path.exists(_SCALER_PATH):
    _SCALER_PATH = os.path.join(_BASE_DIR, "model_scaler.pkl")

risk_model = None
risk_scaler = None

if os.path.exists(_MODEL_PATH) and os.path.exists(_SCALER_PATH):
    with open(_MODEL_PATH, "rb") as f:
        risk_model = pickle.load(f)
    with open(_SCALER_PATH, "rb") as f:
        risk_scaler = pickle.load(f)
    logger.info("Phase 2 ML risk classifier loaded successfully.")
else:
    logger.warning(
        "risk_model.pkl / model_scaler.pkl not found. "
        "Running in rule-based-only mode. "
        "Run: python backend/generate_training_data.py && python backend/train_classifier.py"
    )

FEATURE_COLS = [
    "density", "avg_speed",
    "d_density", "d_speed",
    "neighbor_density", "neighbor_speed",
    "flow_variance",
]
# ─────────────────────────────────────────────────────────────────────────────

# ── Phase 3: Recommendation Engine ───────────────────────────────────────────
rec_engine = RecommendationEngine()
logger.info("Phase 3 Recommendation Engine initialised.")
# ─────────────────────────────────────────────────────────────────────────────

# Active WebSocket connections
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"New client connected. Total clients: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
        logger.info(f"Client disconnected. Total clients: {len(self.active_connections)}")

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception:
                # Handle broken connections gracefully
                pass

manager = ConnectionManager()

# Incidents reported by citizens
incidents = []

class IncidentReport(BaseModel):
    description: str
    latitude: float
    longitude: float
    user_id: str

class ObstacleAsset(BaseModel):
    latitude: float
    longitude: float
    radius: float

class SimulationAssetsPayload(BaseModel):
    entrances: List[List[float]]
    exits: List[List[float]]
    obstacles: List[ObstacleAsset]

class AcknowledgePayload(BaseModel):
    rec_id: str

@app.post("/update-simulation-assets")
def update_simulation_assets(payload: SimulationAssetsPayload):
    local_entrances = []
    for ent in payload.entrances:
        lat, lon = ent[0], ent[1]
        y = (lat - LAT_ANCHOR) / 0.000009 + 50
        x = (lon - LON_ANCHOR) / 0.000010 + 50
        local_entrances.append((x, y))

    local_exits = []
    for ex in payload.exits:
        lat, lon = ex[0], ex[1]
        y = (lat - LAT_ANCHOR) / 0.000009 + 50
        x = (lon - LON_ANCHOR) / 0.000010 + 50
        local_exits.append((x, y))

    local_obstacles = []
    for obs in payload.obstacles:
        y = (obs.latitude - LAT_ANCHOR) / 0.000009 + 50
        x = (obs.longitude - LON_ANCHOR) / 0.000010 + 50
        local_obstacles.append({"x": x, "y": y, "radius": obs.radius})

    sim_model.entrances = [(5.0, 50.0), (5.0, 20.0), (5.0, 80.0)] + local_entrances
    sim_model.exits = [(95.0, 50.0)] + local_exits
    sim_model.obstacles = local_obstacles
    sim_model.assets_updated = True

    logger.info(f"Dynamic assets updated. Entrances={len(sim_model.entrances)}, Exits={len(sim_model.exits)}, Obstacles={len(sim_model.obstacles)}")
    return {"status": "success"}

@app.get("/status")
def get_status():
    return {
        "surge_mode": sim_model.surge_mode,
        "agent_count": len(sim_model.schedule.agents),
        "active_incidents": len(incidents)
    }

@app.post("/toggle-surge")
def toggle_surge():
    current_state = sim_model.toggle_surge()
    return {"surge_mode": current_state}

@app.post("/report-incident")
def report_incident(report: IncidentReport):
    import time
    incident_data = report.dict()
    incident_data["id"] = len(incidents) + 1
    if not incident_data.get("timestamp"):
        incident_data["timestamp"] = time.time()
    incidents.append(incident_data)
    logger.info(f"Incident reported: {incident_data}")
    return {"status": "success", "incident": incident_data}

@app.get("/incidents")
def get_incidents():
    return incidents

@app.get("/recommendations")
def get_recommendations():
    return rec_engine.get_history()

@app.get("/recommendations/active")
def get_active_recommendations():
    return rec_engine.get_active_recommendations()

@app.post("/acknowledge-recommendation")
def acknowledge_recommendation(payload: AcknowledgePayload):
    found = rec_engine.acknowledge(payload.rec_id)
    if found:
        logger.info(f"Recommendation {payload.rec_id} acknowledged.")
        return {"status": "acknowledged"}
    return JSONResponse(status_code=404, content={"error": "Recommendation not found or already acknowledged"})

@app.get("/incident-summary")
async def get_incident_summary():
    """Generate a plain-English AI summary of recent incidents and alerts using Gemini API."""
    gemini_key = os.environ.get("GEMINI_API_KEY", "")
    
    # Build context from recent data
    recent_incidents = incidents[-20:]
    active_recs = rec_engine.get_active_recommendations()[:10]
    
    if not recent_incidents and not active_recs:
        return {"summary": "No incidents or active recommendations to summarize at this time.", "source": "static"}
    
    incident_text = "\n".join(
        [f"- Incident #{i['id']}: {i['description']} at ({i['latitude']:.4f}, {i['longitude']:.4f})" 
         for i in recent_incidents]
    ) or "None"
    
    rec_text = "\n".join(
        [f"- [{r['action_code']}] {r['title']}: {r['reason'][:120]}..." 
         for r in active_recs]
    ) or "None"
    
    if gemini_key:
        try:
            import urllib.request
            prompt = (
                f"You are a crowd safety AI assistant. Summarize this incident log for a command center operator "
                f"in 3 concise bullet points. Be actionable and specific.\n\n"
                f"INCIDENTS:\n{incident_text}\n\nACTIVE RECOMMENDATIONS:\n{rec_text}"
            )
            api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={gemini_key}"
            body = json.dumps({"contents": [{"parts": [{"text": prompt}]}]}).encode()
            req = urllib.request.Request(api_url, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read())
            summary = result["candidates"][0]["content"]["parts"][0]["text"]
            return {"summary": summary, "source": "gemini"}
        except Exception as e:
            logger.warning(f"Gemini API call failed: {e}. Falling back to static summary.")
    
    # Fallback static summary
    red_count = len([r for r in active_recs if r["severity"] == "red"])
    summary = (
        f"**CrowdShield Session Summary**\n\n"
        f"- {len(recent_incidents)} incident(s) reported this session, including "
        f"{len([i for i in recent_incidents if 'AUTOMATIC' in i.get('description', '')])} "
        f"auto-generated sensor alerts.\n"
        f"- {len(active_recs)} active recommendation(s) pending acknowledgement "
        f"({red_count} critical severity).\n"
        f"- Immediate action required: review RED-level recommendations and dispatch "
        f"crowd monitors to congested zones."
    )
    return {"summary": summary, "source": "static"}

@app.post("/trigger-drill")
async def trigger_drill():
    """
    Runs a scripted 50-second crisis demo scenario automatically:
      T=0s:  Normal crowd flow (no surge).
      T=8s:  Surge mode ON — crowd spawning accelerates, amber cells emerge.
      T=20s: Bottleneck obstacle auto-placed at the chokepoint corridor.
      T=35s: Obstacle removed — crowd disperses, system recovers.
      T=45s: Surge mode OFF — all cells return to green, drill ends.
    """
    logger.info("Demo Drill started.")
    asyncio.create_task(_run_drill_sequence())
    return {"status": "drill_started"}

async def _run_drill_sequence():
    """Async background task that auto-advances the demo crisis scenario."""
    import time

    # Phase 1: Start clean (surge off)
    if sim_model.surge_mode:
        sim_model.toggle_surge()
    sim_model.obstacles = []
    sim_model.assets_updated = True
    logger.info("Drill Phase 1: Normal flow")
    await asyncio.sleep(8)

    # Phase 2: Activate surge
    if not sim_model.surge_mode:
        sim_model.toggle_surge()
    logger.info("Drill Phase 2: Surge mode activated")
    await asyncio.sleep(12)

    # Phase 3: Place chokepoint obstacle (center corridor)
    sim_model.obstacles = [{"x": 50, "y": 50, "radius": 12}]
    sim_model.assets_updated = True
    logger.info("Drill Phase 3: Bottleneck obstacle placed")

    # Add auto citizen report for the bottleneck
    drill_lat, drill_lon = map_to_gps(50, 50)
    incidents.append({
        "id": len(incidents) + 1,
        "description": "DEMO DRILL: Crowd crush detected at central corridor — bottleneck forming",
        "latitude": round(drill_lat, 6),
        "longitude": round(drill_lon, 6),
        "user_id": "demo_drill_sensor",
        "timestamp": time.time()
    })
    await asyncio.sleep(15)

    # Phase 4: Remove obstacle — recovery begins
    sim_model.obstacles = []
    sim_model.assets_updated = True
    logger.info("Drill Phase 4: Obstacle removed — recovery")
    await asyncio.sleep(10)

    # Phase 5: Deactivate surge — full recovery
    if sim_model.surge_mode:
        sim_model.toggle_surge()
    logger.info("Drill Phase 5: Surge off — drill complete")

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection open by listening for any client pings
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

def map_to_gps(x, y):
    """Map local simulation (x, y) coordinates to real-world GPS coordinates."""
    # Approx: 1 meter = 0.000009 degrees of latitude
    # Approx: 1 meter = 0.000010 degrees of longitude (near the equator/Delhi)
    lat = LAT_ANCHOR + (y - 50) * 0.000009
    lon = LON_ANCHOR + (x - 50) * 0.000010
    return lat, lon

async def run_simulation_loop():
    """Background task to advance the simulation and broadcast updates."""
    while True:
        sim_model.step()
        agents = sim_model.get_agent_positions()
        
        # Bin agents by H3 hexagon
        hex_bins = {}
        for agent in agents:
            lat, lon = map_to_gps(agent["x"], agent["y"])
            h3_index = h3.geo_to_h3(lat, lon, H3_RESOLUTION)
            
            if h3_index not in hex_bins:
                hex_bins[h3_index] = {
                    "hex": h3_index,
                    "agents": [],
                    "speeds": [],
                    "boundary": h3.h3_to_geo_boundary(h3_index)
                }
            
            hex_bins[h3_index]["agents"].append(agent)
            hex_bins[h3_index]["speeds"].append(agent["speed"])

        # Pre-compute per-cell stats for neighbour lookups
        cell_stats = {}
        for h3_index, data in hex_bins.items():
            count = len(data["agents"])
            avg_spd = sum(data["speeds"]) / count if count else 0.0
            cell_stats[h3_index] = {"density": count, "avg_speed": avg_spd}

        # Track previous tick values for delta features
        if not hasattr(run_simulation_loop, "_prev_stats"):
            run_simulation_loop._prev_stats = {}
        prev_stats = run_simulation_loop._prev_stats

        # Compute metrics & risk score per hexagon
        hex_data = []
        alerts = []
        
        for h3_index, data in hex_bins.items():
            agent_count = len(data["agents"])
            avg_speed = sum(data["speeds"]) / agent_count if agent_count > 0 else 0

            # ── Temporal delta features ──────────────────────────────────
            prev = prev_stats.get(h3_index, {"density": 0, "avg_speed": avg_speed})
            d_density = agent_count - prev["density"]
            d_speed = avg_speed - prev["avg_speed"]

            # ── Neighbour features ───────────────────────────────────────
            neighbours = h3.k_ring(h3_index, 1) - {h3_index}
            nb_dens = [cell_stats[n]["density"] for n in neighbours if n in cell_stats]
            nb_spd  = [cell_stats[n]["avg_speed"] for n in neighbours if n in cell_stats]
            neighbor_density = max(nb_dens) if nb_dens else 0
            neighbor_speed   = min(nb_spd)  if nb_spd  else avg_speed

            # ── Flow variance ────────────────────────────────────────────
            agents_in_cell = data["agents"]
            if len(agents_in_cell) >= 2:
                headings = [math.atan2(a["heading"][1], a["heading"][0]) for a in agents_in_cell]
                sin_m = sum(math.sin(h) for h in headings) / len(headings)
                cos_m = sum(math.cos(h) for h in headings) / len(headings)
                flow_variance = round(1.0 - math.hypot(sin_m, cos_m), 4)
            else:
                flow_variance = 0.0

            # ── Rule-based risk (Phase 1) ────────────────────────────────
            if agent_count >= 8 and avg_speed < 0.6:
                rule_risk = "red"
            elif agent_count >= 4 and avg_speed < 0.9:
                rule_risk = "amber"
            else:
                rule_risk = "green"

            # ── ML classifier (Phase 2) ──────────────────────────────────
            ml_confidence = None
            ml_risk = rule_risk  # fallback

            if risk_model is not None and risk_scaler is not None:
                feature_vec = np.array([[  
                    agent_count, avg_speed,
                    d_density, d_speed,
                    neighbor_density, neighbor_speed,
                    flow_variance
                ]])
                feature_scaled = risk_scaler.transform(feature_vec)
                proba = risk_model.predict_proba(feature_scaled)[0]
                pred_class = int(np.argmax(proba))
                confidence = float(proba[pred_class])

                if pred_class == 2:
                    ml_risk = "red"
                elif pred_class == 1:
                    ml_risk = "amber"
                else:
                    ml_risk = "green"

                ml_confidence = round(confidence * 100, 1)

            # ── Dual-gate fusion: require agreement for RED ──────────────
            if risk_model is not None:
                if rule_risk == "red" and ml_risk == "red":
                    risk_level = "red"
                elif rule_risk in ("red", "amber") or ml_risk in ("red", "amber"):
                    risk_level = "amber"
                else:
                    risk_level = "green"
            else:
                risk_level = rule_risk  # rule-only mode

            # ── Build alert if needed ────────────────────────────────────
            conf_str = f" (ML: {ml_confidence}% confident)" if ml_confidence else ""
            if risk_level == "red":
                alert_msg = (
                    f"CRITICAL CONGESTION: Bottleneck detected in cell {h3_index}."
                    f" Speed dropped below 0.6m/s.{conf_str}"
                )
                alerts.append({
                    "hex": h3_index,
                    "level": "red",
                    "message": alert_msg,
                    "recommendation": "Open nearest alternative gates and reroute inbound flow immediately.",
                    "ml_confidence": ml_confidence
                })
            elif risk_level == "amber":
                alerts.append({
                    "hex": h3_index,
                    "level": "amber",
                    "message": f"WARNING: Crowd density rising in cell {h3_index}.{conf_str}",
                    "recommendation": "Monitor cell and consider deploying crowd flow monitors.",
                    "ml_confidence": ml_confidence
                })

            hex_data.append({
                "hex": h3_index,
                "count": agent_count,
                "avg_speed": round(avg_speed, 2),
                "risk_level": risk_level,
                "ml_confidence": ml_confidence,
                "d_density": d_density,
                "flow_variance": flow_variance,
                "boundary": [[p[0], p[1]] for p in data["boundary"]]
            })

        # Update simulator congested cells list for dynamic agent routing
        congested_cells = []
        for hex_item in hex_data:
            if hex_item["risk_level"] in ("red", "amber"):
                boundary = hex_item["boundary"]
                lat_c = sum(p[0] for p in boundary) / len(boundary)
                lon_c = sum(p[1] for p in boundary) / len(boundary)
                y_c = (lat_c - LAT_ANCHOR) / 0.000009 + 50
                x_c = (lon_c - LON_ANCHOR) / 0.000010 + 50
                congested_cells.append({
                    "x": x_c,
                    "y": y_c,
                    "risk_level": hex_item["risk_level"]
                })
        sim_model.congested_cells = congested_cells

        # ── Phase 3: Evaluate recommendations ────────────────────────────
        new_recs = rec_engine.evaluate(hex_data)
        if new_recs:
            logger.info(f"Recommendation engine fired {len(new_recs)} new recommendation(s).")

        # Compile full payload
        payload = {
            "agents": [{"id": a["id"], "lat": map_to_gps(a["x"], a["y"])[0], "lon": map_to_gps(a["x"], a["y"])[1], "speed": a["speed"]} for a in agents],
            "hexagons": hex_data,
            "alerts": alerts,
            "surge_mode": sim_model.surge_mode,
            "recommendations": rec_engine.get_active_recommendations(),
            "incidents": manager.incidents
        }
        
        # Update previous-tick snapshot for delta features on next iteration
        run_simulation_loop._prev_stats = {
            h3_idx: {"density": cell_stats[h3_idx]["density"], "avg_speed": cell_stats[h3_idx]["avg_speed"]}
            for h3_idx in cell_stats
        }

        # Broadcast to all websocket clients
        await manager.broadcast(json.dumps(payload))
        await asyncio.sleep(1.0)

@app.on_event("startup")
async def startup_event():
    # Start the simulation background loop
    asyncio.create_task(run_simulation_loop())

# Mount citizen PWA static files at /pwa
pwa_dir = os.path.join(os.path.dirname(__file__), "../pwa-dist")
if os.path.exists(pwa_dir):
    app.mount("/pwa", StaticFiles(directory=pwa_dir, html=True), name="pwa")

# Mount frontend static files to serve the React dashboard at root (must be last)
frontend_dir = os.path.join(os.path.dirname(__file__), "../frontend")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
else:
    logger.warning("frontend directory not found. Run: cd dashboard && npm run build")

