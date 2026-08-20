"""
recommendation.py
CrowdShield Phase 3 — Recommendation Engine

A transparent decision-table engine that maps combinations of crowd risk signals
to structured, explainable action recommendations for operators.
"""

import uuid
import time
from typing import List, Dict, Optional


# ── Action Codes ─────────────────────────────────────────────────────────────
OPEN_EXIT       = "OPEN_EXIT"
ONE_WAY_FLOW    = "ONE_WAY_FLOW"
SLOW_ENTRY      = "SLOW_ENTRY"
DEPLOY_MONITORS = "DEPLOY_MONITORS"
PA_BROADCAST    = "PA_BROADCAST"
ESCALATE        = "ESCALATE"


def _make_rec(hex_id: str, action_code: str, title: str, reason: str,
              severity: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "hex": hex_id,
        "action_code": action_code,
        "title": title,
        "reason": reason,
        "severity": severity,
        "timestamp": time.time(),
        "acknowledged": False,
    }


class RecommendationEngine:
    """
    Stateful engine — tracks red_streak (consecutive red ticks per cell)
    and deduplicates active recommendations so the same cell doesn't spam.
    """

    def __init__(self):
        # hex_id -> consecutive ticks at red
        self.red_streak: Dict[str, int] = {}
        # hex_id -> set of active action_codes (cleared on acknowledge)
        self.active_codes: Dict[str, set] = {}
        # Full recommendation history (list of dicts)
        self.history: List[dict] = []

    def acknowledge(self, rec_id: str) -> bool:
        """Mark a recommendation as acknowledged. Returns True if found."""
        for rec in self.history:
            if rec["id"] == rec_id and not rec["acknowledged"]:
                rec["acknowledged"] = True
                # Allow the same action to be issued again for this cell
                hex_id = rec["hex"]
                if hex_id in self.active_codes:
                    self.active_codes[hex_id].discard(rec["action_code"])
                return True
        return False

    def _already_active(self, hex_id: str, action_code: str) -> bool:
        return action_code in self.active_codes.get(hex_id, set())

    def _register(self, rec: dict):
        hex_id = rec["hex"]
        self.active_codes.setdefault(hex_id, set()).add(rec["action_code"])
        self.history.append(rec)

    def evaluate(self, hex_data: List[dict]) -> List[dict]:
        """
        Evaluate current hex snapshot and return NEW (unacknowledged) recommendations
        generated this tick. Updates internal streak counters.

        hex_data fields expected:
            hex, count, avg_speed, risk_level, ml_confidence,
            d_density (optional), flow_variance (optional)
        """
        new_recs = []
        current_red = set()

        for cell in hex_data:
            hex_id       = cell["hex"]
            risk         = cell.get("risk_level", "green")
            count        = cell.get("count", 0)
            avg_speed    = cell.get("avg_speed", 1.5)
            ml_conf      = cell.get("ml_confidence")
            d_density    = cell.get("d_density", 0)
            flow_var     = cell.get("flow_variance", 0.0)

            conf_str = f" (ML: {ml_conf}% confidence)" if ml_conf is not None else ""

            # ── Update red streak ─────────────────────────────────────────
            if risk == "red":
                current_red.add(hex_id)
                self.red_streak[hex_id] = self.red_streak.get(hex_id, 0) + 1
            else:
                self.red_streak[hex_id] = 0

            streak = self.red_streak.get(hex_id, 0)

            # ── Rule 1: Critical density at chokepoint → open exit ────────
            if risk == "red" and d_density >= 2:
                if not self._already_active(hex_id, OPEN_EXIT):
                    rec = _make_rec(
                        hex_id, OPEN_EXIT,
                        "Open Nearest Alternate Exit",
                        f"Critical crowd density ({count} peds, +{d_density}/tick) at chokepoint. "
                        f"Speed collapsed to {avg_speed:.1f} m/s.{conf_str} "
                        f"Open the nearest alternate gate immediately to relieve pressure.",
                        "red"
                    )
                    self._register(rec)
                    new_recs.append(rec)

            # ── Rule 2: Rising density at amber → slow entry gate ─────────
            elif risk == "amber" and d_density >= 2:
                if not self._already_active(hex_id, SLOW_ENTRY):
                    rec = _make_rec(
                        hex_id, SLOW_ENTRY,
                        "Slow / Throttle Entry Gate",
                        f"Crowd density rising rapidly ({count} peds, +{d_density}/tick) near entry zone.{conf_str} "
                        f"Temporarily slow or close the entry gate to prevent further accumulation.",
                        "amber"
                    )
                    self._register(rec)
                    new_recs.append(rec)

            # ── Rule 3: High directional convergence → deploy monitors ────
            if flow_var > 0.55 and risk in ("amber", "red"):
                if not self._already_active(hex_id, DEPLOY_MONITORS):
                    rec = _make_rec(
                        hex_id, DEPLOY_MONITORS,
                        "Deploy Crowd Flow Monitors",
                        f"Multiple crowd flows converging in this zone (variance={flow_var:.2f}).{conf_str} "
                        f"Deploy ground monitors to enforce directional flow and prevent stampede buildup.",
                        "amber"
                    )
                    self._register(rec)
                    new_recs.append(rec)

            # ── Rule 4: Sustained red ≥ 3 ticks → PA broadcast ───────────
            if streak >= 3 and not self._already_active(hex_id, PA_BROADCAST):
                rec = _make_rec(
                    hex_id, PA_BROADCAST,
                    "Broadcast PA Announcement",
                    f"Zone has been critically congested for {streak} consecutive seconds.{conf_str} "
                    f"Broadcast a multilingual PA announcement directing crowd to alternate exits. "
                    f"Message: 'Please use Gate 2 / कृपया गेट 2 का उपयोग करें'",
                    "red"
                )
                self._register(rec)
                new_recs.append(rec)

            # ── Rule 5: Sustained red ≥ 6 ticks → escalate ───────────────
            if streak >= 6 and not self._already_active(hex_id, ESCALATE):
                rec = _make_rec(
                    hex_id, ESCALATE,
                    "ESCALATE — Alert Emergency Services",
                    f"Zone sustained CRITICAL risk for {streak} seconds with no resolution.{conf_str} "
                    f"Immediate escalation required: notify control room supervisor and alert emergency services. "
                    f"Consider venue-wide evacuation protocol.",
                    "red"
                )
                self._register(rec)
                new_recs.append(rec)

        # ── Reset streaks for cells no longer in red ──────────────────────
        for hex_id in list(self.red_streak.keys()):
            if hex_id not in current_red:
                self.red_streak[hex_id] = 0
                # Clear active codes so recommendations can refire if zone turns red again
                self.active_codes.pop(hex_id, None)

        return new_recs

    def get_active_recommendations(self) -> List[dict]:
        """Return all unacknowledged recommendations, newest first."""
        return sorted(
            [r for r in self.history if not r["acknowledged"]],
            key=lambda r: r["timestamp"],
            reverse=True
        )

    def get_history(self) -> List[dict]:
        """Return full recommendation history, newest first."""
        return sorted(self.history, key=lambda r: r["timestamp"], reverse=True)
