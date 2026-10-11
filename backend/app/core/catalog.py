"""Static domain catalogue: categories, lifecycle and severity vocabulary."""

# slug, label, domain, default severity (1-4), hazard weight, persistence days (how long an
# unattended issue typically remains a problem)
CATEGORIES: list[tuple[str, str, str, int, float, int]] = [
    ("garbage", "Garbage", "waste", 2, 1.0, 10),
    ("illegal_dumping", "Illegal Dumping", "waste", 3, 1.3, 21),
    ("plastic_waste", "Plastic Waste", "waste", 2, 1.0, 21),
    ("e_waste", "E-Waste", "waste", 3, 1.4, 45),
    ("dead_animals", "Dead Animals", "waste", 3, 1.2, 5),
    ("air_pollution", "Air Pollution", "air", 3, 1.4, 3),
    ("open_burning", "Open Burning", "air", 3, 1.5, 2),
    ("construction_dust", "Construction Dust", "air", 2, 1.1, 30),
    ("water_pollution", "Water Pollution", "water", 3, 1.6, 30),
    ("sewage", "Sewage", "water", 3, 1.5, 14),
    ("noise_pollution", "Noise Pollution", "noise", 2, 0.8, 7),
    ("tree_loss", "Tree Loss", "green", 2, 1.0, 365),
    ("illegal_tree_cutting", "Illegal Tree Cutting", "green", 3, 1.3, 365),
    ("flooding", "Flooding", "flood", 4, 1.8, 3),
    ("waterlogging", "Waterlogging", "flood", 2, 1.1, 4),
    ("drainage", "Drainage Problems", "flood", 2, 1.0, 30),
    ("other", "Other", "other", 1, 0.6, 14),
]

CATEGORY_BY_SLUG = {c[0]: c for c in CATEGORIES}
DOMAINS = ("waste", "air", "water", "noise", "green", "flood", "other")


def category_domain(slug: str) -> str:
    return CATEGORY_BY_SLUG.get(slug, CATEGORY_BY_SLUG["other"])[2]


def category_label(slug: str) -> str:
    return CATEGORY_BY_SLUG.get(slug, CATEGORY_BY_SLUG["other"])[1]


SEVERITY_LABELS = {1: "low", 2: "moderate", 3: "high", 4: "critical"}

# Incident lifecycle. Order matters: transitions may only move forward, except for
# "reopened" (resolved -> verified when citizens report the issue still exists).
STATUSES = (
    "reported",
    "ai_classified",
    "verified",
    "prioritized",
    "assigned",
    "action_started",
    "resolved",
    "citizen_verified",
)
TERMINAL = {"resolved", "citizen_verified", "dismissed"}
OPEN_STATUSES = tuple(s for s in STATUSES if s not in TERMINAL)

PRIORITY_THRESHOLDS = [(80, "P1"), (60, "P2"), (35, "P3"), (0, "P4")]


def priority_for(risk: float) -> str:
    for threshold, label in PRIORITY_THRESHOLDS:
        if risk >= threshold:
            return label
    return "P4"
