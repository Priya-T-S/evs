"""Report classification providers.

``classify_report`` picks the best available provider:

1. ``ClaudeVisionClassifier`` — used when an Anthropic API key is configured. Sends the
   (EXIF-stripped) image and description and receives schema-constrained JSON.
2. ``HeuristicClassifier`` — always available, fully local. Combines a keyword lexicon
   over the description with simple image colour statistics. It is explicitly labelled
   as a heuristic and its confidence is capped, so it never masquerades as a vision model.

Classification never overrides the citizen's chosen category; it is stored alongside it
and used to flag mismatches for moderators and to estimate severity.
"""

import base64
import io
import json
import logging
from dataclasses import asdict, dataclass, field

import numpy as np
from PIL import Image

from app.ai import text as textlib
from app.core.catalog import CATEGORIES, CATEGORY_BY_SLUG, category_label
from app.core.config import settings

log = logging.getLogger("ecopulse.ai")

CATEGORY_SLUGS = [c[0] for c in CATEGORIES]


@dataclass
class Classification:
    category: str
    label: str
    confidence: float
    severity: int
    provider: str
    subtype: str | None = None
    rationale: str | None = None
    signals: dict = field(default_factory=dict)
    agrees_with_user: bool = True

    def as_dict(self) -> dict:
        return asdict(self)


# --------------------------------------------------------------------------- image features


def image_features(jpeg: bytes) -> dict[str, float]:
    """Coarse colour statistics on a 96px thumbnail. Cheap and deterministic."""
    img = Image.open(io.BytesIO(jpeg)).convert("HSV")
    img.thumbnail((96, 96))
    hsv = np.asarray(img, dtype=np.float32) / 255.0
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    n = h.size
    green = ((h > 0.17) & (h < 0.45) & (s > 0.25) & (v > 0.2)).sum() / n
    brown = ((h > 0.03) & (h < 0.14) & (s > 0.25) & (v > 0.15) & (v < 0.7)).sum() / n
    grey_haze = ((s < 0.12) & (v > 0.45) & (v < 0.9)).sum() / n
    water_blue = ((h > 0.47) & (h < 0.65) & (s > 0.2)).sum() / n
    dark = (v < 0.18).sum() / n
    # Local colour variance as a proxy for visual clutter (mixed waste piles are cluttered).
    rgb = np.asarray(Image.open(io.BytesIO(jpeg)).convert("RGB").resize((48, 48)), dtype=np.float32)
    clutter = float(np.mean(np.abs(np.diff(rgb, axis=0))) + np.mean(np.abs(np.diff(rgb, axis=1)))) / 255.0
    return {
        "green": round(float(green), 3),
        "brown": round(float(brown), 3),
        "grey_haze": round(float(grey_haze), 3),
        "water_blue": round(float(water_blue), 3),
        "dark": round(float(dark), 3),
        "clutter": round(clutter, 3),
    }


# Which image features weakly support which categories.
IMAGE_PRIORS: dict[str, dict[str, float]] = {
    "garbage": {"clutter": 1.5, "brown": 0.4},
    "illegal_dumping": {"clutter": 1.4, "brown": 0.6},
    "plastic_waste": {"clutter": 1.3},
    "air_pollution": {"grey_haze": 1.4},
    "open_burning": {"grey_haze": 1.0, "dark": 0.6},
    "construction_dust": {"grey_haze": 1.0, "brown": 0.6},
    "water_pollution": {"water_blue": 0.8, "brown": 0.8},
    "sewage": {"brown": 1.2, "dark": 0.5},
    "tree_loss": {"green": 0.8, "brown": 0.6},
    "illegal_tree_cutting": {"green": 0.7, "brown": 0.8},
    "flooding": {"water_blue": 0.6, "brown": 1.0},
    "waterlogging": {"brown": 0.9, "water_blue": 0.5},
    "drainage": {"dark": 0.6, "brown": 0.6},
}


FEATURE_WORDS = {
    "green": "vegetation",
    "brown": "earthy brown tones (soil, debris or murky water)",
    "grey_haze": "grey, hazy tones",
    "water_blue": "water-like blue tones",
    "dark": "dark areas",
    "clutter": "visually cluttered, mixed material",
}


class HeuristicClassifier:
    name = "heuristic-v1"
    MAX_CONFIDENCE = 0.72

    def classify(self, user_category: str, description: str | None, jpeg: bytes | None) -> Classification:
        scores: dict[str, float] = {c: 0.0 for c in CATEGORY_SLUGS}
        signals: dict = {}

        text_rank = textlib.classify_text(description)
        if text_rank:
            signals["text_top"] = text_rank[:3]
            for cat, s in text_rank:
                scores[cat] += 0.55 * s

        feats = image_features(jpeg) if jpeg else None
        if feats:
            signals["image"] = feats
            img_scores = {c: sum(w * feats.get(k, 0) for k, w in pri.items()) for c, pri in IMAGE_PRIORS.items()}
            total = sum(img_scores.values()) or 1
            for c, s in img_scores.items():
                scores[c] += 0.25 * (s / total)

        # Evidence-only ranking (text + image). The citizen chose a category on purpose, so it
        # stays unless the evidence clearly points elsewhere — then we suggest a switch.
        evidence_best = max(scores, key=scores.get)
        e_best, e_user = scores[evidence_best], scores.get(user_category, 0.0)
        strong_mismatch = evidence_best != user_category and e_best >= 0.2 and e_user < 0.5 * e_best
        signals["evidence_best"] = evidence_best
        scores[user_category] = e_user + (0.0 if strong_mismatch else 0.35)
        best = evidence_best if strong_mismatch else max(scores, key=scores.get)
        ranked = sorted(scores.values(), reverse=True)
        margin = ranked[0] - (ranked[1] if len(ranked) > 1 else 0)
        evidence = (0.4 if text_rank else 0.0) + (0.2 if feats else 0.0)
        confidence = min(self.MAX_CONFIDENCE, 0.35 + 0.6 * margin + evidence * 0.5)

        severity = CATEGORY_BY_SLUG[best][3]
        boost = textlib.intensity(description)
        if feats and feats["clutter"] > 0.22 and CATEGORY_BY_SLUG[best][2] == "waste":
            boost += 0.6
        if boost >= 1.0:
            severity = min(4, severity + 1)
        if boost >= 2.5:
            severity = min(4, severity + 1)

        reasons = []
        if text_rank:
            reasons.append(f"description keywords suggest {category_label(text_rank[0][0]).lower()}")
        if feats:
            dominant = max(feats, key=feats.get)
            reasons.append(f"the photo is mostly {FEATURE_WORDS.get(dominant, dominant)}")
        if not reasons:
            reasons.append("no description or image signal; using the reporter's category")
        return Classification(
            category=best,
            label=category_label(best),
            confidence=round(confidence, 2),
            severity=severity,
            provider=self.name,
            rationale="; ".join(reasons),
            signals=signals,
            agrees_with_user=best == user_category,
        )


# --------------------------------------------------------------------------- Claude vision


CLASSIFICATION_SCHEMA = {
    "type": "object",
    "properties": {
        "category": {"type": "string", "enum": CATEGORY_SLUGS},
        "label": {"type": "string", "description": "Short human label, e.g. 'Garbage accumulation'"},
        "subtype": {"type": "string", "description": "e.g. 'Mixed waste', 'Construction debris'"},
        "confidence": {"type": "number", "description": "0..1 confidence in the category"},
        "severity": {"type": "integer", "enum": [1, 2, 3, 4], "description": "1 low, 2 moderate, 3 high, 4 critical"},
        "rationale": {"type": "string", "description": "One sentence citing what is visible"},
        "is_environmental_issue": {"type": "boolean"},
    },
    "required": ["category", "label", "subtype", "confidence", "severity", "rationale", "is_environmental_issue"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """You classify citizen-submitted photos of urban environmental problems for a municipal \
environmental platform. Judge only what is visible in the image and stated in the description. \
Severity: 1 = minor/cosmetic, 2 = noticeable nuisance, 3 = health or ecological hazard needing action \
within days, 4 = acute danger (active fire, flooding of homes, sewage in drinking water, toxic dumping). \
If the photo shows no environmental problem, set is_environmental_issue to false and give low confidence. \
Never guess beyond the evidence; lower confidence when the image is ambiguous."""


class ClaudeVisionClassifier:
    name = "claude-vision"

    def __init__(self) -> None:
        import anthropic

        self._anthropic = anthropic
        self.client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key, timeout=30.0, max_retries=1)

    async def classify(self, user_category: str, description: str | None, jpeg: bytes | None) -> Classification | None:
        content: list[dict] = []
        if jpeg:
            content.append(
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.standard_b64encode(jpeg).decode()},
                }
            )
        content.append(
            {
                "type": "text",
                "text": f"Reporter-selected category: {user_category}\nDescription: {description or '(none)'}",
            }
        )
        anthropic = self._anthropic
        try:
            response = await self.client.beta.messages.create(
                model=settings.ai_model,
                max_tokens=2000,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": content}],
                output_config={"effort": "low", "format": {"type": "json_schema", "schema": CLASSIFICATION_SCHEMA}},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.RateLimitError:
            log.warning("claude classifier rate limited; falling back to heuristic")
            return None
        except anthropic.APIStatusError as exc:
            log.warning("claude classifier error %s; falling back", exc.status_code)
            return None
        except anthropic.APIConnectionError:
            log.warning("claude classifier unreachable; falling back")
            return None

        if response.stop_reason == "refusal":
            return None
        text = next((b.text for b in response.content if b.type == "text"), None)
        if not text:
            return None
        data = json.loads(text)
        confidence = max(0.0, min(1.0, float(data["confidence"])))
        if not data["is_environmental_issue"]:
            confidence = min(confidence, 0.2)
        return Classification(
            category=data["category"],
            label=data["label"],
            subtype=data["subtype"],
            confidence=round(confidence, 2),
            severity=int(data["severity"]),
            provider=f"{self.name}:{settings.ai_model}",
            rationale=data["rationale"],
            signals={"is_environmental_issue": data["is_environmental_issue"]},
            agrees_with_user=data["category"] == user_category,
        )


_heuristic = HeuristicClassifier()
_claude: ClaudeVisionClassifier | None = None


async def classify_report(user_category: str, description: str | None, jpeg: bytes | None) -> Classification:
    global _claude
    if settings.anthropic_api_key:
        if _claude is None:
            _claude = ClaudeVisionClassifier()
        result = await _claude.classify(user_category, description, jpeg)
        if result is not None:
            return result
    return _heuristic.classify(user_category, description, jpeg)
