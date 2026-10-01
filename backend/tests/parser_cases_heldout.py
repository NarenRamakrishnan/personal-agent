"""Phrases written AFTER the prompt was tuned on parser_cases.py, never used to tune it.

The 30 dev phrases tell us the prompt works on what it was fixed against. These
estimate how it does on wording it has not seen. Same "now" as the dev set.
"""

HELDOUT = [
    ("remind me to text Priya back in 20 minutes", {"trigger": "time", "date": "2026-10-01", "hour": 14}),
    ("Sunday evening remind me to do laundry", {"trigger": "time", "date": "2026-10-04"}),
    ("remind me to pick up dry cleaning when I'm at the shopping mall",
     {"trigger": "location", "no_deadline": True, "loc_category": "shopping"}),
    ("remind me to call the landlord on Wednesday", {"trigger": "time", "date": "2026-10-07"}),
    ("in 3 days remind me to refill my prescription", {"trigger": "time", "date": "2026-10-04"}),
    ("remind me to buy stamps at the pharmacy",
     {"trigger": "location", "no_deadline": True, "loc_category": "pharmacy"}),
    ("tomorrow evening when I'm at the gym remind me to ask about membership",
     {"trigger": "time_and_location", "date": "2026-10-02", "loc_category": "gym"}),
    ("I wonder if it'll rain this weekend", {"n": 0}),
    ("my roommate said the dinner was great", {"n": 0}),
    ("remind me at 7 pm to call Dad and tomorrow to book flights", {"n": 2}),
    ("remind me to buy coffee beans at the coffee shop",
     {"trigger": "location", "no_deadline": True, "loc_category": "coffee_shop"}),
    ("remind me tomorrow at 9 to go to the library",
     {"trigger": "time", "date": "2026-10-02", "hour": 9}),
]
