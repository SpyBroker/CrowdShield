"""
generate_training_data.py
CrowdShield Phase 2 — Training Data Generator

Runs the Mesa simulation through multiple scenario phases to collect
labeled (feature, label) samples for the ML risk classifier.

Usage:
    python backend/generate_training_data.py

Output:
    backend/training_data.csv
"""

import sys
import os
import math
import random
import csv

# Ensure the backend directory is in the path when run from project root
sys.path.insert(0, os.path.dirname(__file__))

import h3
from simulation import VenueCrowdModel

# ── Constants ────────────────────────────────────────────────────────────────
LAT_ANCHOR = 28.6139
LON_ANCHOR = 77.2090
H3_RESOLUTION = 14
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "training_data.csv")

TOTAL_STEPS = 300        # Total simulation ticks
SURGE_START = 80         # Step at which surge begins
SURGE_END = 180          # Step at which surge ends (recovery)
BOTTLENECK_START = 100   # Add extra obstacles to create bottleneck
BOTTLENECK_END = 200

# Label thresholds (must match main.py rule-based logic exactly)
CRUSH_DENSITY = 8
CRUSH_SPEED = 0.6
WARN_DENSITY = 4
WARN_SPEED = 0.9


def map_to_gps(x: float, y: float) -> tuple:
    lat = LAT_ANCHOR + (y - 50) * 0.000009
    lon = LON_ANCHOR + (x - 50) * 0.000010
    return lat, lon


def assign_label(density: int, avg_speed: float) -> int:
    """Ground-truth label based on simulator thresholds.
    2 = crush, 1 = warning, 0 = safe
    """
    if density >= CRUSH_DENSITY and avg_speed < CRUSH_SPEED:
        return 2
    if density >= WARN_DENSITY and avg_speed < WARN_SPEED:
        return 1
    return 0


def compute_flow_variance(agents: list) -> float:
    """Direction variance — heading convergence indicator.
    High variance = multiple directions merging → dangerous.
    """
    if len(agents) < 2:
        return 0.0
    headings = [math.atan2(a["heading"][1], a["heading"][0]) for a in agents]
    sin_mean = sum(math.sin(h) for h in headings) / len(headings)
    cos_mean = sum(math.cos(h) for h in headings) / len(headings)
    # Circular variance in [0, 1]; 0 = all same direction, 1 = maximum spread
    r = math.hypot(sin_mean, cos_mean)
    return round(1.0 - r, 4)


def run_generation():
    print("=" * 60)
    print("CrowdShield — Phase 2 Training Data Generator")
    print("=" * 60)

    model = VenueCrowdModel(width=100, height=100, dt=1.0)

    # Previous tick snapshot for temporal delta features
    prev_hex_stats = {}
    rows_written = 0

    fieldnames = [
        "density", "avg_speed",
        "d_density", "d_speed",
        "neighbor_density", "neighbor_speed",
        "flow_variance",
        "label"
    ]

    with open(OUTPUT_PATH, "w", newline="") as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()

        for step in range(TOTAL_STEPS):
            # ── Scenario controls ───────────────────────────────────────
            if step == SURGE_START:
                model.surge_mode = True
                print(f"  [Step {step:>3}] Surge mode ON")

            if step == SURGE_END:
                model.surge_mode = False
                print(f"  [Step {step:>3}] Surge mode OFF (recovery)")

            if step == BOTTLENECK_START:
                # Narrow the central corridor to create a chokepoint
                model.obstacles = [
                    {"x": 50, "y": 65, "radius": 12},
                    {"x": 50, "y": 35, "radius": 12},
                ]
                model.assets_updated = True
                print(f"  [Step {step:>3}] Bottleneck obstacles added")

            if step == BOTTLENECK_END:
                model.obstacles = []
                model.assets_updated = True
                print(f"  [Step {step:>3}] Bottleneck obstacles removed")

            # ── Advance simulation ──────────────────────────────────────
            model.step()
            agents = model.get_agent_positions()

            # ── H3 spatial binning ──────────────────────────────────────
            hex_bins = {}
            for agent in agents:
                lat, lon = map_to_gps(agent["x"], agent["y"])
                h3_idx = h3.geo_to_h3(lat, lon, H3_RESOLUTION)

                if h3_idx not in hex_bins:
                    hex_bins[h3_idx] = {"agents": [], "speeds": []}

                hex_bins[h3_idx]["agents"].append(agent)
                hex_bins[h3_idx]["speeds"].append(agent["speed"])

            # Pre-compute current stats for neighbour lookups
            current_stats = {}
            for h3_idx, data in hex_bins.items():
                count = len(data["agents"])
                avg_speed = sum(data["speeds"]) / count if count else 0.0
                current_stats[h3_idx] = {
                    "density": count,
                    "avg_speed": avg_speed
                }

            # ── Feature extraction & writing ────────────────────────────
            for h3_idx, data in hex_bins.items():
                density = len(data["agents"])
                avg_speed = sum(data["speeds"]) / density if density else 0.0

                # Temporal deltas vs. previous tick
                prev = prev_hex_stats.get(h3_idx, {"density": 0, "avg_speed": avg_speed})
                d_density = density - prev["density"]
                d_speed = avg_speed - prev["avg_speed"]

                # Neighbour ring statistics (H3 k-ring 1 = 6 immediate neighbours)
                neighbours = h3.k_ring(h3_idx, 1) - {h3_idx}
                neighbour_densities = [current_stats[n]["density"] for n in neighbours if n in current_stats]
                neighbour_speeds = [current_stats[n]["avg_speed"] for n in neighbours if n in current_stats]

                neighbor_density = max(neighbour_densities) if neighbour_densities else 0
                neighbor_speed = min(neighbour_speeds) if neighbour_speeds else avg_speed

                # Directional convergence variance
                flow_variance = compute_flow_variance(data["agents"])

                label = assign_label(density, avg_speed)

                writer.writerow({
                    "density": density,
                    "avg_speed": round(avg_speed, 4),
                    "d_density": d_density,
                    "d_speed": round(d_speed, 4),
                    "neighbor_density": neighbor_density,
                    "neighbor_speed": round(neighbor_speed, 4),
                    "flow_variance": flow_variance,
                    "label": label
                })
                rows_written += 1

            # Update previous tick snapshot
            prev_hex_stats = {
                h3_idx: {
                    "density": len(data["agents"]),
                    "avg_speed": sum(data["speeds"]) / len(data["agents"]) if data["speeds"] else 0.0
                }
                for h3_idx, data in hex_bins.items()
            }

            if step % 50 == 0:
                agent_count = len(agents)
                print(f"  [Step {step:>3}] Agents: {agent_count:>3} | Cells: {len(hex_bins):>3} | Rows so far: {rows_written:>5}")

    print()
    print(f"Done! {rows_written} training samples written to:")
    print(f"   {OUTPUT_PATH}")


if __name__ == "__main__":
    run_generation()
