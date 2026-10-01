"""The 30-phrase parser test set (build step 9, target 25+/30).

All cases are judged as if "now" is Thu 2026-10-01 14:00 in America/New_York.
Each `expect` only states what the phrase clearly implies, so a correct parse
is not marked wrong for a reasonable choice (e.g. what "tonight" means).
Keys: n (reminder count), trigger, date / date_in (local YYYY-MM-DD), hour (local),
no_deadline, loc_type, loc_category, loc_name, title_has.
"""

NOW_LOCAL = "2026-10-01T14:00:00"
TZ = "America/New_York"

CASES = [
    # --- relative times
    ("remind me to call Mom in 30 minutes", {"trigger": "time", "date": "2026-10-01", "hour": 14}),
    ("in 2 hours remind me to check the oven", {"trigger": "time", "date": "2026-10-01", "hour": 16}),
    ("remind me in an hour to move the car", {"trigger": "time", "date": "2026-10-01", "hour": 15}),
    ("tonight remind me to take out the trash", {"trigger": "time", "date": "2026-10-01"}),
    ("tonight at 8 remind me to call my sister", {"trigger": "time", "date": "2026-10-01", "hour": 20}),
    ("at 5 PM remind me to email the professor", {"trigger": "time", "date": "2026-10-01", "hour": 17}),
    ("tomorrow remind me to submit the form", {"trigger": "time", "date": "2026-10-02"}),
    ("tomorrow at 9 am remind me to go to the gym", {"trigger": "time", "date": "2026-10-02", "hour": 9}),
    ("tomorrow morning remind me to take my vitamins", {"trigger": "time", "date": "2026-10-02"}),
    # --- weekdays and dates
    ("remind me Friday to pay rent", {"trigger": "time", "date": "2026-10-02"}),
    ("Saturday at 3 pm I have soccer practice, remind me", {"trigger": "time", "date": "2026-10-03", "hour": 15}),
    # On a Thursday "next Monday" honestly means Oct 5 or Oct 12, so accept both.
    ("remind me to call the dentist next Monday",
     {"trigger": "time", "date_in": ["2026-10-05", "2026-10-12"]}),
    ("remind me on October 15 to register for classes", {"trigger": "time", "date": "2026-10-15"}),
    ("don't forget to turn in the lab by Friday at noon", {"trigger": "time", "date": "2026-10-02", "hour": 12}),
    # --- no deadline
    ("I need to renew my passport sometime", {"trigger": "time", "no_deadline": True}),
    ("remind me to organize my desk", {"trigger": "time", "no_deadline": True}),
    # --- location: category, saved place, named place
    ("remind me to buy eggs when I'm at the grocery store",
     {"trigger": "location", "no_deadline": True, "loc_category": "grocery_store"}),
    ("remind me to pick up my prescription at the pharmacy",
     {"trigger": "location", "no_deadline": True, "loc_category": "pharmacy"}),
    ("when I'm at the coffee shop remind me to read chapter 3",
     {"trigger": "location", "no_deadline": True, "loc_category": "coffee_shop"}),
    ("remind me at the gym to log my workout",
     {"trigger": "location", "no_deadline": True, "loc_category": "gym"}),
    ("when I get home remind me to feed the cat",
     {"trigger": "location", "no_deadline": True, "loc_type": "saved_place", "loc_name": "home"}),
    ("remind me to bring my charger when I leave home",
     {"trigger": "location", "loc_type": "saved_place", "loc_name": "home", "title_has": "charger"}),
    ("remind me to return the package at Target",
     {"trigger": "location", "loc_type": "place", "loc_name": "Target"}),
    # --- time and location together
    ("remind me to buy milk at the grocery store tomorrow",
     {"trigger": "time_and_location", "date": "2026-10-02", "loc_category": "grocery_store"}),
    ("tonight when I'm at the pharmacy remind me to ask about refills",
     {"trigger": "time_and_location", "date": "2026-10-01", "loc_category": "pharmacy"}),
    # --- ambiguous wording: only assert the part that is clear
    ("remind me to grab a charger before class", {"n": 1, "title_has": "charger"}),
    # --- several commitments in one utterance
    ("remind me to call Mom at 6 and pick up eggs at the grocery store",
     {"n": 2}),
    # --- not a commitment (always-listening must stay quiet)
    ("that movie was so good last night", {"n": 0}),
    ("what's the capital of France", {"n": 0}),
    ("the weather is really nice today", {"n": 0}),
]

assert len(CASES) == 30, len(CASES)
