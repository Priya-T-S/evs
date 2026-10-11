"""Unit tests for EcoPulse's transparent models. No database required."""

import io
import math

from PIL import Image

from app.ai.classifier import HeuristicClassifier
from app.ai.text import classify_text, similarity
from app.core.catalog import priority_for
from app.core.geo import haversine_m, snap_public
from app.core.storage import dhash, hash_distance, process_image
from app.intelligence import risk
from app.modules.reports.pipeline import MERGE_THRESHOLD, duplicate_score
from app.realtime.hub import Client


def _inputs(**kw) -> risk.RiskInputs:
    base = dict(
        severity=2, hazard_weight=1.0, reporters=1, population_exposed=2000, age_days=1, persistence_days=14,
        sensitive_sites=[], area_sensitivity=1.0, recent_reports_72h=1, external_signal=None,
    )
    base.update(kw)
    return risk.RiskInputs(**base)


# ------------------------------------------------------------------ risk model


def test_risk_is_bounded_and_explained():
    score, exp = risk.compute(_inputs())
    assert 0 <= score <= 100
    assert math.isclose(sum(exp["contributions"].values()), score, abs_tol=0.5)
    assert set(exp["components"]) == set(risk.WEIGHTS)


def test_risk_weights_redistribute_when_external_missing():
    _, exp = risk.compute(_inputs(external_signal=None))
    assert math.isclose(sum(exp["weights"].values()), 1.0, abs_tol=1e-6)
    assert exp["weights"]["external"] == 0


def test_risk_monotonic_in_severity_reporters_and_sensitivity():
    low, _ = risk.compute(_inputs(severity=1))
    high, _ = risk.compute(_inputs(severity=4))
    assert high > low
    few, _ = risk.compute(_inputs(reporters=1))
    many, _ = risk.compute(_inputs(reporters=20))
    assert many > few
    plain, _ = risk.compute(_inputs())
    school, _ = risk.compute(_inputs(sensitive_sites=[{"kind": "school", "distance_m": 50}]))
    assert school > plain


def test_priority_thresholds():
    assert priority_for(95) == "P1"
    assert priority_for(80) == "P1"
    assert priority_for(65) == "P2"
    assert priority_for(40) == "P3"
    assert priority_for(5) == "P4"


# ------------------------------------------------------------------ duplicate detection


def test_duplicate_score_same_spot_merges():
    score, sig = duplicate_score(
        distance_m=10, radius_m=120, same_category=True, same_domain=True, dt_hours=2, window_hours=240,
        image_distance=3, text_sim=0.8,
    )
    assert score >= MERGE_THRESHOLD
    assert set(sig) == {"spatial", "category", "temporal", "image", "text"}


def test_duplicate_score_far_or_different_does_not_merge():
    far, _ = duplicate_score(
        distance_m=119, radius_m=120, same_category=False, same_domain=True, dt_hours=200, window_hours=240,
        image_distance=30, text_sim=0.05,
    )
    assert far < MERGE_THRESHOLD


def test_duplicate_score_renormalises_missing_signals():
    # Without image/text the score must still reach 1.0 for a perfect spatial+temporal+category match.
    score, sig = duplicate_score(
        distance_m=0, radius_m=100, same_category=True, same_domain=True, dt_hours=0, window_hours=48,
        image_distance=None, text_sim=None,
    )
    assert math.isclose(score, 1.0, abs_tol=1e-3)
    assert "image" not in sig and "text" not in sig


# ------------------------------------------------------------------ text + heuristic AI


def test_text_similarity():
    assert similarity("Garbage piled near the bus stop", "garbage pile at bus stop") > 0.4
    assert similarity("loud music at night", "sewage overflowing drain") < 0.25
    assert similarity("", "anything") is None


def test_keyword_classification():
    ranked = classify_text("White toxic foam floating on the lake")
    assert ranked and ranked[0][0] == "water_pollution"


def test_heuristic_classifier_is_honest_about_confidence():
    c = HeuristicClassifier().classify("garbage", "Huge overflowing garbage heap, terrible smell", None)
    assert c.category == "garbage"
    assert c.provider == "heuristic-v1"
    assert c.confidence <= HeuristicClassifier.MAX_CONFIDENCE
    assert c.severity >= 3  # "huge" + "overflowing" intensifiers


def test_heuristic_classifier_flags_disagreement():
    c = HeuristicClassifier().classify("noise_pollution", "Thick black smoke, they are burning plastic and wires", None)
    assert c.category in ("open_burning", "air_pollution")
    assert c.agrees_with_user is False


# ------------------------------------------------------------------ privacy + media


def _jpeg_with_exif() -> bytes:
    img = Image.new("RGB", (640, 480), (90, 120, 80))
    exif = Image.Exif()
    exif[0x010F] = "SecretCam"
    exif[0x8825] = {2: (12, 56, 0)}
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    return buf.getvalue()


def test_images_are_reencoded_without_metadata():
    full, thumb, w, h, ih = process_image(_jpeg_with_exif())
    assert not Image.open(io.BytesIO(full)).getexif()
    assert (w, h) == (640, 480)
    assert len(ih) == 16
    assert max(Image.open(io.BytesIO(thumb)).size) <= 360


def test_dhash_identical_and_different():
    a = Image.new("RGB", (200, 200), (10, 10, 10))
    for x in range(100):
        for y in range(200):
            a.putpixel((x, y), (240, 240, 240))
    b = a.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    assert hash_distance(dhash(a), dhash(a)) == 0
    assert hash_distance(dhash(a), dhash(b)) > 20


def test_public_location_snapping_is_deterministic_and_bounded():
    lat, lon = 12.93521, 77.62457
    p1 = snap_public(lat, lon, 120)
    assert snap_public(lat, lon, 120) == p1  # deterministic: repeated queries can't be averaged
    assert haversine_m(lat, lon, *p1) <= 120 * math.sqrt(2) / 2 + 1  # never more than half a cell diagonal away
    # Every point within the same cell maps to the same public point.
    centre = snap_public(*p1, 120)
    assert centre == p1
    assert snap_public(p1[0] + 0.0002, p1[1] - 0.0002, 120) == p1


# ------------------------------------------------------------------ realtime filtering


def _client(**kw) -> Client:
    c = Client(ws=None, user_id=kw.pop("user_id", None), role=kw.pop("role", "citizen"))  # type: ignore[arg-type]
    for k, v in kw.items():
        setattr(c, k, v)
    return c


def test_hub_geographic_filtering():
    c = _client(topics={"incidents"}, bbox=(77.60, 12.92, 77.64, 12.96))
    inside = {"topic": "incidents", "geo": {"lon": 77.62, "lat": 12.94}}
    outside = {"topic": "incidents", "geo": {"lon": 77.75, "lat": 13.05}}
    assert c.wants(inside)
    assert not c.wants(outside)


def test_hub_pulse_topic_is_city_wide_and_user_events_are_private():
    c = _client(topics={"pulse"}, bbox=(77.60, 12.92, 77.64, 12.96), user_id="u1")
    assert c.wants({"topic": "incidents", "geo": {"lon": 77.75, "lat": 13.05}})
    assert c.wants({"topic": "user", "user_ids": ["u1"]})
    assert not c.wants({"topic": "user", "user_ids": ["u2"]})
