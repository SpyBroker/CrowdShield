"""Integration test - verifies all CrowdShield features work together."""
import sys, json, asyncio
sys.stdout.reconfigure(encoding="utf-8")

import requests

BASE = "http://localhost:8000"
results = []
G = "\033[92m"; R = "\033[91m"; C = "\033[96m"; Y = "\033[93m"; RST = "\033[0m"

def chk(name, passed, detail=""):
    mark = f"{G}PASS{RST}" if passed else f"{R}FAIL{RST}"
    info = f"  ({detail})" if detail else ""
    print(f"  {mark}  {name}{info}")
    results.append((name, passed))

print(f"\n{C}=== CrowdShield Feature Integration Test ==={RST}\n")

# ── 1. Backend health ──────────────────────────────────────────────────────────
print(f"{Y}[1] Backend Health{RST}")
r = requests.get(BASE + "/status")
d = r.json()
chk("GET /status", r.status_code == 200, f"agents={d['agent_count']} surge={d['surge_mode']}")

# ── 2. Static files ────────────────────────────────────────────────────────────
print(f"\n{Y}[2] Static File Serving{RST}")
r = requests.get(BASE + "/")
chk("Dashboard HTML (index.html)", r.status_code == 200 and len(r.content) > 100,
    f"{len(r.content)} bytes, has DOCTYPE={b'<!DOCTYPE' in r.content}")

r = requests.get(BASE + "/pwa/")
chk("Citizen PWA HTML (/pwa/)", r.status_code == 200 and len(r.content) > 5000,
    f"{len(r.content)} bytes")

# ── 3. Incident pipeline ───────────────────────────────────────────────────────
print(f"\n{Y}[3] Incident Report -> Log Pipeline{RST}")
body = {"description": "INTEGRATION TEST fire alarm east gate",
        "latitude": 28.6140, "longitude": 77.2091, "user_id": "integration_test"}
r = requests.post(BASE + "/report-incident", json=body)
d = r.json()
chk("POST /report-incident", r.status_code == 200 and d["status"] == "success",
    f"id={d['incident']['id']}")

r = requests.get(BASE + "/incidents")
logs = r.json()
chk("GET /incidents (log persisted)", r.status_code == 200 and len(logs) > 0,
    f"count={len(logs)}")

our_inc = [i for i in logs if i.get("user_id") == "integration_test"]
chk("Incident appears in log", len(our_inc) > 0,
    f"found={len(our_inc)} matching entries")

# ── 4. Surge toggle ────────────────────────────────────────────────────────────
print(f"\n{Y}[4] Surge Mode Toggle{RST}")
r1 = requests.post(BASE + "/toggle-surge").json()
r2 = requests.post(BASE + "/toggle-surge").json()
chk("Toggle ON then OFF (round-trip)",
    r1["surge_mode"] is True and r2["surge_mode"] is False,
    f"on={r1['surge_mode']} restored={r2['surge_mode']}")

# ── 5. Recommendation engine ───────────────────────────────────────────────────
print(f"\n{Y}[5] Recommendation Engine{RST}")
recs = requests.get(BASE + "/recommendations/active").json()
chk("GET /recommendations/active", isinstance(recs, list), f"count={len(recs)}")

if recs:
    r0 = recs[0]
    schema_ok = all(k in r0 for k in ["title", "severity", "action_code", "reason"])
    chk("Recommendation schema complete", schema_ok,
        f"[{r0.get('action_code')}] {r0.get('title','')[:45]}")
    chk("Severity is valid value", r0.get("severity") in ["red","amber","green"],
        f"severity={r0.get('severity')}")

r = requests.post(BASE + "/acknowledge-recommendation", json={"rec_id": "FAKE_XYZ_NONE"})
chk("Acknowledge 404 for unknown id", r.status_code == 404, "correctly returns 404")

# ── 6. AI Summary ─────────────────────────────────────────────────────────────
print(f"\n{Y}[6] AI Incident Summary{RST}")
r = requests.get(BASE + "/incident-summary", timeout=12)
d = r.json()
chk("GET /incident-summary returns", r.status_code == 200 and "summary" in d,
    f"source={d.get('source')} chars={len(d.get('summary',''))}")
chk("Summary has content", len(d.get("summary", "")) > 20, d.get("summary","")[:80])

# ── 7. Dynamic asset update ────────────────────────────────────────────────────
print(f"\n{Y}[7] Dynamic Assets + A* Pathfinder{RST}")
body = {"entrances": [[28.6140, 77.2085]], "exits": [[28.6142, 77.2095]], "obstacles": []}
r = requests.post(BASE + "/update-simulation-assets", json=body)
chk("POST /update-simulation-assets (pathfinder input)", r.status_code == 200,
    f"status={r.json().get('status')}")

# ── 8. Demo Drill ─────────────────────────────────────────────────────────────
print(f"\n{Y}[8] Demo Drill Endpoint{RST}")
r = requests.post(BASE + "/trigger-drill")
d = r.json()
chk("POST /trigger-drill", r.status_code == 200 and d.get("status") == "drill_started",
    f"status={d.get('status')}")

# ── 9. WebSocket live stream ───────────────────────────────────────────────────
print(f"\n{Y}[9] WebSocket Live Data Stream{RST}")

async def ws_test():
    import websockets
    async with websockets.connect("ws://localhost:8000/ws") as ws:
        frames = [json.loads(await ws.recv()) for _ in range(4)]
    return frames[-1]  # return most recent frame

frame = asyncio.run(ws_test())

agents    = frame.get("agents", [])
hexes     = frame.get("hexagons", [])
recs_ws   = frame.get("recommendations", [])
alerts_ws = frame.get("alerts", [])

chk("WebSocket /ws connects + streams", bool(frame), f"{len(agents)} agents received")
chk("Hexagon grid populated", len(hexes) > 0, f"{len(hexes)} hex cells")
chk("Every hex has H3 index", all("hex" in h for h in hexes), "hex field present on all")
chk("ML confidence on every cell",
    all(h.get("ml_confidence") is not None for h in hexes),
    f"{len(hexes)} cells, all have ml_confidence")
chk("Risk level on every cell",
    all(h.get("risk_level") in ["red","amber","green","low"] for h in hexes),
    "all labeled")
chk("Recommendations in frame", isinstance(recs_ws, list), f"{len(recs_ws)} recommendations")
chk("Alerts in frame", isinstance(alerts_ws, list), f"{len(alerts_ws)} alerts")

# ── 10. Risk distribution analysis ────────────────────────────────────────────
print(f"\n{Y}[10] Live Risk Distribution Analysis{RST}")
dist = {}
for h in hexes:
    l = h.get("risk_level", "?")
    dist[l] = dist.get(l, 0) + 1
print(f"  Risk distribution: {dist}")

confs = [h.get("ml_confidence", 0) for h in hexes if h.get("ml_confidence") is not None]
if confs:
    print(f"  ML confidence: min={min(confs):.3f}  max={max(confs):.3f}  avg={sum(confs)/len(confs):.3f}")

counts = [h.get("count", 0) for h in hexes]
if counts:
    print(f"  Cell agent counts: min={min(counts)}  max={max(counts)}  avg={sum(counts)/len(counts):.1f}")

# ── Summary ────────────────────────────────────────────────────────────────────
print(f"\n{C}{'='*45}{RST}")
passed = sum(1 for _, v in results if v)
total  = len(results)
col    = G if passed == total else R
print(f"  {col}{passed}/{total} checks passed{RST}")
if passed == total:
    print(f"  {G}All systems nominal — CrowdShield is demo-ready!{RST}")
else:
    print(f"  {R}Failed:{RST}")
    for n, v in results:
        if not v:
            print(f"    x {n}")
print()
sys.exit(0 if passed == total else 1)
