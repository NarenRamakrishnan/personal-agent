"""Location matching (Module 07): is this reminder's place where the person is now?

Input is whatever the phone knows: its own coordinates and/or a list of nearby
places (each with raw type labels from a places API). Matching is deliberately
generous about names and strict about distance.
"""

import math
import re

# Our small internal taxonomy. Each canonical category lists raw type labels we
# treat as that category. Raw labels are NOT verified against any one provider's
# documentation yet: check them against the places API the phone actually uses.
CATEGORIES: dict[str, set[str]] = {
    "grocery_store": {"grocery", "grocery_or_supermarket", "supermarket", "grocery_store",
                      "convenience_store", "food_market"},
    "pharmacy": {"pharmacy", "drugstore", "drug_store", "chemist"},
    "gym": {"gym", "fitness_center", "fitness_centre", "health_club", "sports_club"},
    "restaurant": {"restaurant", "food", "fast_food_restaurant", "meal_takeaway", "diner"},
    "coffee_shop": {"coffee_shop", "cafe", "coffee", "coffee_house"},
    "university": {"university", "college", "school", "campus", "library"},
    "shopping": {"shopping", "shopping_mall", "mall", "department_store", "clothing_store", "store"},
}

DEFAULT_RADIUS_M = 150.0

# Words people use for their saved places, folded to one name.
SAVED_PLACE_ALIASES = {"house": "home", "my_house": "home", "my_home": "home", "apartment": "home",
                       "dorm": "home", "office": "work", "my_work": "work", "campus": "school"}


def norm(term: str | None) -> str:
    return re.sub(r"[\s\-]+", "_", (term or "").strip().lower())


def canonical_category(term: str | None) -> str | None:
    t = norm(term)
    for canonical, raws in CATEGORIES.items():
        if t == canonical or t in raws:
            return canonical
    return None


def saved_place_name(term: str | None) -> str:
    t = norm(term)
    return SAVED_PLACE_ALIASES.get(t, t)


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres (haversine)."""
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def categories_match(wanted: str | None, raw_types: list[str]) -> bool:
    want_c = canonical_category(wanted)
    for t in raw_types:
        if want_c and canonical_category(t) == want_c:
            return True
        if not want_c and norm(t) == norm(wanted):  # category we don't know: exact label only
            return True
    return False


_FILLER = {"the", "a", "an", "and", "of", "at", "on", "in"}


def _name_tokens(name: str | None) -> set[str]:
    text = (name or "").lower().replace("'", "").replace("\u2019", "").replace("&", " and ")
    return set(re.findall(r"[a-z0-9]+", text)) - _FILLER


def names_match(wanted: str | None, actual: str | None) -> bool:
    """Every word of the place the person named must appear in the nearby place's
    name: "Target" matches "Target Hadley", and "Stop & Shop" matches "Stop and
    Shop", but a place called "A" or "Tar" does not match "Target"."""
    want, have = _name_tokens(wanted), _name_tokens(actual)
    return bool(want) and want <= have


def evaluate_location(reminder, ctx, saved_place_lookup, default_radius: float | None = None) -> dict:
    """Return {applicable, matched, reason, distance_meters} for one reminder.

    saved_place_lookup(name) -> (lat, lon, radius) or None.
    """
    loc = reminder.location
    if loc is None or reminder.trigger_type == "time":
        return {"applicable": False, "matched": False, "reason": "no location on this reminder"}

    have_fix = ctx.latitude is not None and ctx.longitude is not None

    def no(reason, d=None):
        return {"applicable": True, "matched": False, "reason": reason, "distance_meters": d}

    def yes(reason, d=None):
        return {"applicable": True, "matched": True, "reason": reason, "distance_meters": d}

    if loc.type == "saved_place" or (loc.type == "place" and saved_place_lookup(saved_place_name(loc.name))):
        found = saved_place_lookup(saved_place_name(loc.name))
        if found is None:
            return no(f"saved place '{loc.name}' has not been set")
        if not have_fix:
            return no("current position unknown")
        lat, lon, radius = found
        d = distance_m(ctx.latitude, ctx.longitude, lat, lon)
        return yes(f"within {radius:.0f} m of {loc.name}", d) if d <= radius else no(f"{d:.0f} m from {loc.name}", d)

    if loc.type == "coordinate":
        if loc.latitude is None or loc.longitude is None:
            return no("reminder coordinate is incomplete")
        if not have_fix:
            return no("current position unknown")
        radius = loc.radius_meters or default_radius or DEFAULT_RADIUS_M
        d = distance_m(ctx.latitude, ctx.longitude, loc.latitude, loc.longitude)
        return yes(f"within {radius:.0f} m of the target", d) if d <= radius else no(f"{d:.0f} m from the target", d)

    # category / place: look through the places the phone says are nearby.
    # A category can arrive in `name` (the phone's confirm screen rebuilds it that way).
    wanted = (loc.category or loc.name) if loc.type == "category" else (loc.name or loc.category)
    if not wanted:
        return no(f"this {loc.type} reminder has no place to look for")
    radius = loc.radius_meters or default_radius or DEFAULT_RADIUS_M
    if not ctx.nearby_places:
        return no("no nearby places provided")
    best = None
    for p in ctx.nearby_places:
        ok = (
            categories_match(wanted, p.types) if loc.type == "category" else names_match(wanted, p.name)
        )
        if not ok:
            continue
        if p.distance_meters is not None:
            d = p.distance_meters
        elif have_fix and p.latitude is not None and p.longitude is not None:
            d = distance_m(ctx.latitude, ctx.longitude, p.latitude, p.longitude)
        else:
            d = None  # no way to measure: the phone listed it as nearby
        if d is None or d <= radius:
            best = (p, d) if best is None or (d is not None and (best[1] is None or d < best[1])) else best
    if best:
        label = best[0].name or wanted
        return yes(f"near {label}", best[1])
    return no(f"no nearby {wanted.replace('_', ' ')} within {radius:.0f} m")
