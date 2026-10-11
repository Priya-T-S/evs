"""Lightweight text analytics: tokenisation, similarity and keyword classification."""

import math
import re
from collections import Counter

STOPWORDS = set(
    """a an the and or but of to in on at for with by from is are was were be been it this that
    there here near very lot lots so too also has have had not no yes i we you they he she them our
    my your its as just than then into over under around since days day week weeks today please""".split()
)

_token_re = re.compile(r"[a-z0-9]+")


def tokens(text: str | None) -> list[str]:
    if not text:
        return []
    return [t for t in _token_re.findall(text.lower()) if t not in STOPWORDS and len(t) > 1]


def _trigrams(text: str) -> Counter:
    s = f"  {text.lower()}  "
    return Counter(s[i : i + 3] for i in range(len(s) - 2))


def similarity(a: str | None, b: str | None) -> float | None:
    """Blend of token Jaccard and character-trigram cosine. None when either text is empty."""
    ta, tb = set(tokens(a)), set(tokens(b))
    if not ta or not tb:
        return None
    jaccard = len(ta & tb) / len(ta | tb)
    ga, gb = _trigrams(" ".join(sorted(ta))), _trigrams(" ".join(sorted(tb)))
    dot = sum(ga[k] * gb[k] for k in ga.keys() & gb.keys())
    cos = dot / (math.sqrt(sum(v * v for v in ga.values())) * math.sqrt(sum(v * v for v in gb.values())) or 1)
    return round(0.5 * jaccard + 0.5 * cos, 3)


# Keyword lexicon per category. Weights reflect how specific a term is.
LEXICON: dict[str, dict[str, float]] = {
    "garbage": {"garbage": 2, "trash": 2, "rubbish": 2, "waste": 1, "bin": 1.2, "overflowing": 1.5, "litter": 1.5, "kachra": 2, "smell": 0.5},
    "illegal_dumping": {"dumping": 2.5, "dumped": 2.5, "debris": 1.5, "rubble": 1.5, "truck": 0.8, "illegal": 1, "vacant": 0.8, "pile": 1},
    "plastic_waste": {"plastic": 2.5, "bottles": 1.5, "bags": 1.5, "wrappers": 1.5, "polythene": 2},
    "e_waste": {"electronic": 2, "ewaste": 3, "batteries": 2, "battery": 2, "monitor": 1.5, "computer": 1.5, "wires": 1, "tv": 1},
    "dead_animals": {"dead": 2, "carcass": 3, "animal": 1.5, "dog": 1, "cow": 1, "rotting": 1.2},
    "air_pollution": {"smoke": 1.5, "smog": 2.5, "fumes": 2, "pollution": 1, "haze": 1.5, "exhaust": 1.5, "breathing": 1, "air": 1},
    "open_burning": {"burning": 2.5, "fire": 2, "burnt": 2, "burn": 2, "flames": 2, "smoke": 1},
    "construction_dust": {"construction": 2, "dust": 2.5, "cement": 1.5, "sand": 1, "demolition": 2},
    "water_pollution": {"lake": 1.5, "foam": 2.5, "froth": 2.5, "contaminated": 2, "oil": 1.2, "polluted": 1.5, "river": 1.2, "fish": 1, "discoloured": 1.5, "water": 0.8},
    "sewage": {"sewage": 3, "sewer": 2.5, "manhole": 2, "overflow": 1.2, "stench": 1.2, "drain": 0.8, "excreta": 2},
    "noise_pollution": {"noise": 2.5, "loud": 2, "honking": 2, "speaker": 1.5, "music": 1, "night": 0.5, "drilling": 1.5, "db": 1},
    "tree_loss": {"tree": 1.5, "trees": 1.5, "fallen": 1.5, "uprooted": 2, "dying": 1},
    "illegal_tree_cutting": {"cutting": 2, "felled": 2.5, "chopped": 2, "axe": 2, "logging": 2, "cut": 1.2},
    "flooding": {"flood": 3, "flooded": 3, "flooding": 3, "submerged": 2.5, "knee": 1, "deep": 0.8},
    "waterlogging": {"waterlogging": 3, "waterlogged": 3, "puddle": 1.5, "stagnant": 2, "standing": 1, "rain": 0.8},
    "drainage": {"drainage": 2.5, "blocked": 1.5, "clogged": 2, "drain": 1.5, "gutter": 1.5, "nala": 2},
}

INTENSIFIERS = {
    "huge": 1, "massive": 1, "overflowing": 1, "everywhere": 1, "weeks": 0.6, "months": 1, "children": 0.8,
    "school": 1, "hospital": 1, "fire": 1, "toxic": 1.2, "stench": 0.5, "unbearable": 0.8, "dangerous": 1,
    "spreading": 0.6, "knee": 0.6, "waist": 1.2, "chemical": 1.2, "dead": 0.5, "sick": 1, "mosquito": 0.5,
}


def classify_text(text: str | None) -> list[tuple[str, float]]:
    """Returns (category, normalised score) ranked; empty when no signal."""
    toks = tokens(text)
    if not toks:
        return []
    scores: dict[str, float] = {}
    for cat, lex in LEXICON.items():
        s = sum(lex.get(t, 0.0) for t in toks)
        if s > 0:
            scores[cat] = s
    total = sum(scores.values())
    return sorted(((c, s / total) for c, s in scores.items()), key=lambda x: -x[1]) if total else []


def intensity(text: str | None) -> float:
    return sum(INTENSIFIERS.get(t, 0.0) for t in tokens(text))
