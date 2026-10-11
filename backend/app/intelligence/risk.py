"""Transparent incident risk model (``risk-1``).

    Risk = 100 · Σ wᵢ · cᵢ      with every component cᵢ ∈ [0, 1]

| component    | weight | definition                                                         |
|--------------|--------|--------------------------------------------------------------------|
| severity     | 0.28   | severity/4 scaled by the category hazard weight                    |
| frequency    | 0.16   | 1 − e^(−reporters/5)     (independent citizens reporting)          |
| exposure     | 0.16   | 1 − e^(−people within 500 m / 8 000)   (≈10 000/km², dense urban)  |
| persistence  | 0.10   | days open / typical persistence of the category                    |
| sensitivity  | 0.12   | schools, hospitals, care homes within 300 m and area sensitivity    |
| trend        | 0.08   | new reports in the last 72 h (velocity)                            |
| external     | 0.10   | domain-specific external signal (AQI for air, rain for flood)      |

Every computed score is stored with its inputs, components and contributions so the
UI can explain exactly why an incident ranks where it does.
"""

import math
from dataclasses import dataclass

MODEL_VERSION = "risk-1"

WEIGHTS = {
    "severity": 0.28,
    "frequency": 0.16,
    "exposure": 0.16,
    "persistence": 0.10,
    "sensitivity": 0.12,
    "trend": 0.08,
    "external": 0.10,
}

SENSITIVE_WEIGHT = {"school": 1.0, "hospital": 1.0, "clinic": 0.6, "kindergarten": 1.0, "care_home": 0.8}


@dataclass
class RiskInputs:
    severity: int
    hazard_weight: float
    reporters: int
    population_exposed: int
    age_days: float
    persistence_days: int
    sensitive_sites: list[dict]
    area_sensitivity: float
    recent_reports_72h: int
    external_signal: float | None  # already normalised 0..1, None when unavailable
    external_note: str | None = None
    confidence: float = 1.0


def _clamp(v: float) -> float:
    return max(0.0, min(1.0, v))


def compute(inp: RiskInputs) -> tuple[float, dict]:
    sens_load = sum(SENSITIVE_WEIGHT.get(s["kind"], 0.4) * max(0.3, 1 - s["distance_m"] / 300) for s in inp.sensitive_sites)
    components = {
        "severity": _clamp(inp.severity / 4 * (0.7 + 0.3 * min(inp.hazard_weight / 1.6, 1.0))),
        "frequency": _clamp(1 - math.exp(-inp.reporters / 5)),
        "exposure": _clamp(1 - math.exp(-inp.population_exposed / 8000)),
        "persistence": _clamp(inp.age_days / max(inp.persistence_days, 1)),
        "sensitivity": _clamp(0.75 * (1 - math.exp(-0.8 * sens_load)) + 0.25 * _clamp(inp.area_sensitivity - 0.5)),
        "trend": _clamp(inp.recent_reports_72h / 5),
        "external": _clamp(inp.external_signal) if inp.external_signal is not None else 0.0,
    }
    weights = dict(WEIGHTS)
    if inp.external_signal is None:
        # Redistribute the external weight instead of silently scoring it as zero.
        spare = weights.pop("external")
        scale = 1 / (1 - spare)
        weights = {k: v * scale for k, v in weights.items()}
        weights["external"] = 0.0
    contributions = {k: round(100 * weights[k] * components[k], 1) for k in components}
    score = round(sum(contributions.values()), 1)
    explanation = {
        "model": MODEL_VERSION,
        "score": score,
        "components": {k: round(v, 3) for k, v in components.items()},
        "weights": {k: round(v, 3) for k, v in weights.items()},
        "contributions": contributions,
        "inputs": {
            "severity": inp.severity,
            "reporters": inp.reporters,
            "population_exposed": inp.population_exposed,
            "age_days": round(inp.age_days, 1),
            "sensitive_sites": len(inp.sensitive_sites),
            "recent_reports_72h": inp.recent_reports_72h,
            "external": inp.external_note,
        },
        "top_drivers": [k for k, _ in sorted(contributions.items(), key=lambda kv: -kv[1])[:3] if contributions[k] > 0],
    }
    return score, explanation
