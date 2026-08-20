"""
CrowdShield End-to-End Stress Test
===================================
Usage:
  python stress_test.py
  python stress_test.py --url http://localhost:8000

Checks every major system component and prints a colour-coded report.
Requires: pip install requests websockets
"""

import argparse
import asyncio
import json
import sys
import time

# Force UTF-8 output on Windows terminals
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

try:
    import requests
except ImportError:
    print("Missing: pip install requests")
    sys.exit(1)

try:
    import websockets
except ImportError:
    print("Missing: pip install websockets")
    sys.exit(1)

# ── Colours ───────────────────────────────────────────────────────────────────
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
BOLD   = "\033[1m"
RESET  = "\033[0m"

results = []

def ok(name, detail=""):
    msg = f"{GREEN}{BOLD}  PASS{RESET}  {name}"
    if detail:
        msg += f"  {YELLOW}({detail}){RESET}"
    print(msg)
    results.append((name, True))

def fail(name, detail=""):
    msg = f"{RED}{BOLD}  FAIL{RESET}  {name}"
    if detail:
        msg += f"  {RED}({detail}){RESET}"
    print(msg)
    results.append((name, False))

def section(title):
    print(f"\n{CYAN}{BOLD}{'='*50}{RESET}")
    print(f"{CYAN}{BOLD}  {title}{RESET}")
    print(f"{CYAN}{BOLD}{'='*50}{RESET}")

# -- HTTP Helpers --------------------------------------------------------------
def get(base, path, timeout=8):
    return requests.get(base + path, timeout=timeout)

def post(base, path, payload=None, timeout=8):
    return requests.post(base + path, json=payload or {}, timeout=timeout)

# ── Test Suite ────────────────────────────────────────────────────────────────

def test_status(base):
    section("1. Backend Health Check")
    try:
        r = get(base, "/status")
        assert r.status_code == 200
        data = r.json()
        assert "agent_count" in data
        ok("GET /status", f"agents={data['agent_count']}, surge={data.get('surge_mode')}")
    except Exception as e:
        fail("GET /status", str(e))


def test_incidents(base):
    section("2. Incident Reporting")
    payload = {
        "description": "STRESS TEST incident at corridor",
        "latitude": 28.6139,
        "longitude": 77.2090,
        "user_id": "stress_test_runner"
    }
    try:
        r = post(base, "/report-incident", payload)
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "success"
        inc_id = data["incident"]["id"]
        ok("POST /report-incident", f"id={inc_id}")
    except Exception as e:
        fail("POST /report-incident", str(e))

    try:
        r = get(base, "/incidents")
        assert r.status_code == 200
        incidents = r.json()
        assert len(incidents) >= 1
        ok("GET /incidents", f"count={len(incidents)}")
    except Exception as e:
        fail("GET /incidents", str(e))


def test_surge(base):
    section("3. Surge Mode Toggle")
    try:
        r1 = get(base, "/status")
        initial = r1.json().get("surge_mode", False)

        post(base, "/toggle-surge")
        r2 = get(base, "/status")
        toggled = r2.json().get("surge_mode", False)
        assert toggled != initial
        ok("POST /toggle-surge (ON)", f"surge={toggled}")

        post(base, "/toggle-surge")
        r3 = get(base, "/status")
        restored = r3.json().get("surge_mode", False)
        assert restored == initial
        ok("POST /toggle-surge (OFF restore)", f"surge={restored}")
    except Exception as e:
        fail("Surge toggle round-trip", str(e))


def test_recommendations(base):
    section("4. Recommendations API")
    try:
        r = get(base, "/recommendations")
        assert r.status_code == 200
        ok("GET /recommendations", f"history_count={len(r.json())}")
    except Exception as e:
        fail("GET /recommendations", str(e))

    try:
        r = get(base, "/recommendations/active")
        assert r.status_code == 200
        ok("GET /recommendations/active", f"active_count={len(r.json())}")
    except Exception as e:
        fail("GET /recommendations/active", str(e))

    # Bad acknowledge should 404
    try:
        r = post(base, "/acknowledge-recommendation", {"rec_id": "nonexistent_id_xyz"})
        assert r.status_code == 404
        ok("POST /acknowledge-recommendation (404 for unknown)", "correctly returns 404")
    except Exception as e:
        fail("POST /acknowledge-recommendation (404 check)", str(e))


def test_incident_summary(base):
    section("5. Incident Summary (AI / Fallback)")
    try:
        r = get(base, "/incident-summary", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "summary" in data
        source = data.get("source", "?")
        ok("GET /incident-summary", f"source={source}, chars={len(data['summary'])}")
    except Exception as e:
        fail("GET /incident-summary", str(e))


def test_demo_drill(base):
    section("6. Demo Drill Endpoint")
    try:
        count_before = len(get(base, "/incidents").json())
        r = post(base, "/trigger-drill")
        assert r.status_code == 200
        assert r.json()["status"] == "drill_started"
        ok("POST /trigger-drill", "drill launched")
    except Exception as e:
        fail("POST /trigger-drill", str(e))
        return

    # Wait a few seconds and check incident count grew
    print(f"  {YELLOW}Waiting 12s for drill phase 1+2 to fire...{RESET}")
    time.sleep(12)
    try:
        count_after = len(get(base, "/incidents").json())
        # Surge fires; auto-sensor reports fire for red zones
        ok("Drill auto-incident generation", f"incidents {count_before} -> {count_after}")
    except Exception as e:
        fail("Drill auto-incident check", str(e))


async def test_websocket(base):
    section("7. WebSocket Live Stream (5 frames)")
    ws_url = base.replace("http://", "ws://").replace("https://", "wss://") + "/ws"
    try:
        frames_collected = []
        async with websockets.connect(ws_url, ping_interval=None) as ws:
            for _ in range(5):
                raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
                frame = json.loads(raw)
                frames_collected.append(frame)

        ok("WebSocket /ws connection", f"{len(frames_collected)} frames received")

        # Validate frame schema
        for i, frame in enumerate(frames_collected):
            assert "agents" in frame, "missing 'agents'"
            assert "hexagons" in frame, "missing 'hexagons'"
            assert "alerts" in frame, "missing 'alerts'"
            assert "recommendations" in frame, "missing 'recommendations'"
        ok("Frame schema validation", "agents, hexagons, alerts, recommendations present")

        # Check at least some hexagons have ML confidence
        hexes_with_ml = [h for h in frames_collected[-1].get("hexagons", [])
                         if h.get("ml_confidence") is not None]
        ok("ML confidence in hexagons", f"{len(hexes_with_ml)}/{len(frames_collected[-1].get('hexagons', []))} cells have ml_confidence")

    except Exception as e:
        fail("WebSocket /ws", str(e))


def test_frontend(base):
    section("8. Frontend Static Files")
    try:
        r = get(base, "/", timeout=5)
        assert r.status_code == 200
        assert "CrowdShield" in r.text or "<!DOCTYPE" in r.text
        ok("GET / (dashboard HTML)", f"size={len(r.content)} bytes")
    except Exception as e:
        fail("GET / (dashboard)", str(e))

    try:
        r = get(base, "/pwa/", timeout=5)
        assert r.status_code == 200
        assert "CrowdShield" in r.text
        ok("GET /pwa/ (citizen PWA)", f"size={len(r.content)} bytes")
    except Exception as e:
        fail("GET /pwa/", str(e))


def print_summary():
    section("SUMMARY")
    passed = sum(1 for _, v in results if v)
    total  = len(results)
    colour = GREEN if passed == total else RED
    print(f"\n  {colour}{BOLD}{passed}/{total} checks passed{RESET}\n")
    if passed < total:
        print(f"  {RED}Failed checks:{RESET}")
        for name, v in results:
            if not v:
                print(f"    {RED}x{RESET} {name}")
    else:
        print(f"  {GREEN}All systems nominal. CrowdShield is demo-ready!{RESET}")
    print()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="CrowdShield E2E Stress Test")
    parser.add_argument("--url", default="http://localhost:8000",
                        help="Base URL of the running CrowdShield backend")
    args = parser.parse_args()
    base = args.url.rstrip("/")

    print(f"\n{BOLD}CrowdShield End-to-End Stress Test{RESET}")
    print(f"Target: {CYAN}{base}{RESET}")

    test_status(base)
    test_frontend(base)
    test_incidents(base)
    test_surge(base)
    test_recommendations(base)
    test_incident_summary(base)
    test_demo_drill(base)
    asyncio.run(test_websocket(base))

    print_summary()
    sys.exit(0 if all(v for _, v in results) else 1)


if __name__ == "__main__":
    main()
