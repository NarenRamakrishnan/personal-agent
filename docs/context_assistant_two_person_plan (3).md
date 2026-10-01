# Context-Aware Personal Assistant
## 2-Person / 2-Week Build Plan

## Team Split

### Person 1 — AI, Backend, Intent & Actions
Owns:
- FastAPI backend
- Database / Supabase
- LLM structured-output parser
- Reminder/action schemas
- Speech-to-text API integration layer
- Email drafting
- Reminder decision/scoring logic
- Backend tests

### Person 2 — Mobile, Voice, Location & Notifications
Owns:
- React Native / TypeScript mobile app
- Main UI
- Audio capture
- Location permissions
- Current/background location
- Places API integration
- Geofencing
- Local notifications
- Wake-word experiment
- Mobile testing

### Shared Responsibility
Both:
- API contracts
- integration testing
- privacy UX
- demo
- README / architecture diagram
- bug fixing

The important rule is:

> Define API/data contracts first, then work independently against them.

That keeps one person from waiting on the other.

---

# Core Interface To Agree On Before Coding

## Reminder

```ts
type Reminder = {
  id: string;
  title: string;
  description?: string;

  createdAt: string;
  deadline?: string;

  triggerType:
    | "time"
    | "location"
    | "time_and_location";

  location?: {
    type: "coordinate" | "place" | "category";
    name?: string;
    category?: string;
    latitude?: number;
    longitude?: number;
    radiusMeters?: number;
  };

  completed: boolean;
  lastNotifiedAt?: string;
  snoozedUntil?: string;
};
```

## Core endpoints

```text
POST   /parse
POST   /reminders
GET    /reminders
PATCH  /reminders/{id}
POST   /evaluate-reminder
POST   /actions/email
```

Freeze these contracts on Day 1 unless there is a serious reason to change them.

---

# WEEK 1 — Build the Core Product

# DAY 1 — Foundation

## Person 1

### Goal by midday
Create backend skeleton.

- Create `/backend`
- FastAPI setup
- Supabase/Postgres connection
- Pydantic Reminder model
- Action model
- health endpoint

### Goal by end of day

Working endpoints:

```text
POST /reminders
GET /reminders
PATCH /reminders/{id}
```

Create mocked `/parse` endpoint.

Example:

```json
{
  "text": "Remind me to buy milk tomorrow"
}
```

returns a hardcoded/mock reminder object.

### End-of-day deliverable

Backend is deployed or locally reachable and API contract is documented.

---

## Person 2

### Goal by midday

Create mobile skeleton.

- React Native / Expo project
- TypeScript
- navigation
- environment setup
- API client

### Goal by end of day

Build:

- Home screen
- reminder list
- add-reminder flow
- reminder detail screen

Use mocked reminder data if backend is not ready yet.

### End-of-day deliverable

User can view/create a fake reminder in the app.

---

## Shared — Nightly Integration

By the end of Day 1:

```text
Mobile
  ↓
POST /reminders
  ↓
Backend
  ↓
Database
```

must work.

---

# DAY 2 — Natural Language Understanding

## Person 1

### Main task

Build LLM intent extraction.

Input:

```text
Remind me to buy milk when I'm at a grocery store tonight.
```

Output:

```json
{
  "intent": "create_reminder",
  "title": "Buy milk",
  "deadline": "...",
  "location": {
    "name": null,
    "category": "grocery_store"
  }
}
```

Use structured JSON/schema output.

### Tests

Test at least 30 phrases including:

- tonight
- tomorrow
- Friday
- in 30 minutes
- at 5 PM
- at home
- at Target
- grocery store
- pharmacy
- before class
- no deadline
- ambiguous wording

### Goal by end of day

`POST /parse` reliably converts text into Reminder JSON.

Target:

**25+/30 test phrases parsed correctly.**

---

## Person 2

### Main task

Finish real reminder UI.

Build:

- text input
- confirmation screen
- edit parsed reminder
- complete reminder
- delete reminder
- snooze UI

### Goal by end of day

User can:

```text
type natural-language command
      ↓
send to /parse
      ↓
see parsed reminder
      ↓
confirm
      ↓
save
```

---

## Shared — Nightly Integration

By end of Day 2:

> Type "Remind me to buy milk tomorrow at 5" into the mobile app and see a correctly parsed/saved reminder.

---

# DAY 3 — Voice Pipeline

## Person 1

### Main task

Add transcription integration.

Create abstraction:

```python
transcribe(audio_file) -> str
```

Backend should accept an uploaded audio clip if needed.

Also improve:

- parsing errors
- fallback handling
- date/time normalization

### Goal by end of day

Audio file can become:

```text
audio
 -> transcript
 -> reminder JSON
```

---

## Person 2

### Main task

Implement microphone UI.

Build:

- microphone permission
- record button
- recording animation
- stop recording
- send audio/transcript
- display recognized text

### UX

```text
Tap microphone
      ↓
Speak
      ↓
Transcript appears
      ↓
Parsed reminder appears
      ↓
Confirm
```

### Goal by end of day

Complete voice-to-reminder flow works from phone.

---

## Shared — Nightly Integration

Demo:

> "Remind me to finish my assignment tonight at 8."

The reminder should be created completely through voice.

---

# DAY 4 — Time Notifications

## Person 1

### Main task

Build reminder timing logic.

Functions:

```python
deadline_status(reminder)
should_time_notify(reminder, now)
```

Support:

- future deadline
- approaching deadline
- expired deadline
- snoozed reminder
- completed reminder

### Goal by end of day

Given a reminder + timestamp, backend correctly determines whether it is relevant.

---

## Person 2

### Main task

Implement local notifications.

Support:

- exact deadline
- scheduled notifications
- cancel notification
- snooze
- mark complete

### Goal by end of day

Creating:

> "Remind me in 2 minutes."

causes a real device notification in ~2 minutes.

---

# DAY 5 — Location Foundation

## Person 1

### Main task

Define location/context model.

Create schemas for:

```json
{
  "latitude": 47.0,
  "longitude": -122.0,
  "nearby_place_types": ["grocery_store"],
  "timestamp": "..."
}
```

Build `/evaluate-reminder`.

Input:

```text
Reminder + current context
```

Output:

```json
{
  "should_notify": true,
  "reason": "User is currently near a grocery store."
}
```

### Goal by end of day

Context-evaluation endpoint works with MOCK location data.

---

## Person 2

### Main task

Implement foreground location.

Build:

- location permission explanation
- permission request
- obtain coordinates
- location debugging page
- reverse-geocode current area if useful

### Goal by end of day

Mobile can reliably obtain current location with user permission.

---

## Shared — Nightly Integration

Feed phone coordinates into the context object and successfully call `/evaluate-reminder`.

---

# DAY 6 — Place Recognition

## Person 1

### Main task

Create internal location-category taxonomy.

Example:

```text
supermarket
grocery
food_store

=> grocery_store
```

Define mappings for:

- grocery store
- pharmacy
- gym
- restaurant
- coffee shop
- university
- shopping
- home/custom location

Help Person 2 test API results.

### Goal by end of day

Normalized place categories are stable and documented.

---

## Person 2

### Main task

Integrate Places API / MapKit / equivalent.

Given coordinates:

```text
find nearby places
```

Return:

```text
Safeway — grocery_store — 43 m
CVS — pharmacy — 120 m
Starbucks — cafe — 80 m
```

### Goal by end of day

App can correctly determine:

> "I am currently near/in a grocery store."

---

## Shared — Nightly Integration

Demo:

```text
Reminder:
"Buy eggs when near a grocery store"

Current place:
Safeway

Result:
should_notify = true
```

---

# DAY 7 — Week 1 Integration Day

## Person 1

Focus on:

- parser bugs
- date normalization
- database bugs
- context-engine bugs
- API validation
- backend tests

## Person 2

Focus on:

- UI cleanup
- microphone bugs
- location bugs
- notifications
- mobile error states

## Shared

Run complete flows:

### Test A

```text
Voice:
"Remind me to submit my assignment at 8 PM."

Result:
Time notification.
```

### Test B

```text
Voice:
"Remind me to buy eggs when I'm at a grocery store."

Result:
Location-aware notification.
```

### Week 1 completion requirement

By Sunday night / end of Day 7, the following MUST work:

- [x] Voice input
- [x] Speech-to-text
- [x] LLM reminder parsing
- [x] Reminder database
- [x] Reminder UI
- [x] Time notifications
- [x] Current location
- [x] Nearby place detection
- [x] Basic context evaluation

If these don't work, do NOT begin stretch features.

---

# WEEK 2 — Make It Smart

# DAY 8 — Geofencing

## Person 1

### Main task

Support saved places.

Database model:

```text
Home
School
Work
Target
etc.
```

Allow reminder parser to map:

> "when I get home"

to:

```json
{
  "location": {
    "type": "saved_place",
    "name": "home"
  }
}
```

### Goal by end of day

Backend supports saved-place reminders.

---

## Person 2

### Main task

Implement geofencing.

Register regions for:

- home
- school
- named locations

Handle:

- geofence entry
- geofence exit if useful
- local notification trigger

### Goal by end of day

Walking/entering a test geofence triggers a reminder.

---

# DAY 9 — Smart Context Engine

## Person 1

### Main ownership

Build reminder scoring.

Example:

```text
+50 relevant place currently nearby
+30 deadline < 2 hours
+15 relevant location + deadline today
+10 never notified before
-40 notified in last 30 min
-100 completed
```

Function:

```python
score_reminder(reminder, context)
```

Then:

```python
score >= threshold -> notify
```

### Goal by end of day

Context engine gives sensible decisions across at least 20 scenarios.

---

## Person 2

### Main task

Wire context engine into mobile lifecycle.

When meaningful context changes:

```text
location/geofence event
        ↓
retrieve pending reminders
        ↓
evaluate
        ↓
notify
```

Add cooldown logic locally where useful.

### Goal by end of day

Location-aware reminders work without manually opening the app.

---

# DAY 10 — Email Action

## Person 1

### Main ownership

Create:

```text
POST /actions/email
```

Input:

```text
"Email Alex saying I'll be 10 minutes late."
```

Output:

```json
{
  "recipient": "Alex",
  "subject": "Running Late",
  "body": "Hi Alex, ..."
}
```

Require confirmation.

### Goal by midday

Email drafting backend works.

### Goal by end of day

Support recipient/content extraction and good-quality draft generation.

---

## Person 2

### Main task

Build email draft UI.

Show:

- recipient
- subject
- body

Buttons:

```text
Edit
Cancel
Open in Mail
```

Use native email composer / mailto-style integration for MVP.

### Goal by end of day

Voice command:

> "Write an email to Alex saying I'm running late."

opens a generated editable email draft.

---

# DAY 11 — Wake Word Experiment

This is intentionally late.

## Person 1

Research/test wake-word engines:

- Picovoice Porcupine
- openWakeWord
- platform-specific alternatives

Create a quick proof of concept if needed.

### Goal by midday

Decide:

```text
GO
or
NO-GO
```

for wake word in final demo.

Don't spend the entire day fighting mobile OS limitations.

If it doesn't work quickly, stop.

---

## Person 2

Attempt mobile wake-word integration if Person 1's experiment is promising.

Desired flow:

```text
on-device microphone buffer
       ↓
wake word
       ↓
activation indicator/tone
       ↓
record command
```

### Fallback

If wake word is unreliable, build one of:

- lock-screen shortcut
- home-screen widget
- persistent quick-action
- large push-to-talk interface

### End-of-day requirement

A reliable activation mechanism exists.

Wake word is optional.

---

# DAY 12 — Privacy, Battery & Reliability

## Person 1

Build:

- delete transcript/history endpoint
- raw-audio deletion rules
- data-retention controls
- API request logging without sensitive content
- graceful LLM fallback

Test malformed inputs.

---

## Person 2

Build:

- clear microphone-active indicator
- activation sound
- location permission explanation
- location disable state
- microphone denied state
- GPS denied state
- network failure state

Measure basic battery behavior.

Do not poll GPS every few seconds.

### Goal by end of day

Product feels intentional rather than creepy.

---

# DAY 13 — Full Testing Day

Split test ownership.

## Person 1 — Backend/logic test matrix

Test:

- 30+ parser requests
- date handling
- location categories
- deadline logic
- reminder scoring
- email generation
- malformed API input
- offline/error handling

Fix anything producing incorrect actions.

---

## Person 2 — Real-device test matrix

Test:

- microphone
- denied permissions
- time notifications
- location permissions
- places
- geofences
- app foreground/background
- notification actions
- email composer
- network failure

---

## Shared Integration Tests

Test at least these scenarios:

### Scenario 1

> "Remind me in five minutes to call Mom."

Expected:

time notification.

### Scenario 2

> "Remind me to buy eggs when I'm at a grocery store."

Expected:

location-triggered notification.

### Scenario 3

> "Remind me to bring my charger when I get home."

Expected:

saved-location/geofence notification.

### Scenario 4

> "Before 8 PM, remind me to buy milk if I'm near a grocery store."

Expected:

context engine considers both time + location.

### Scenario 5

> "Write an email to John saying I'll be ten minutes late."

Expected:

editable email draft.

---

# DAY 14 — Demo + Polish

## Person 1

Own:

- demo backend stability
- seeded test data
- architecture diagram
- technical README
- explanation of context engine
- privacy architecture explanation

## Person 2

Own:

- UI polish
- demo device setup
- notification styling
- smooth activation flow
- screen recording/demo capture

## Shared

Record a 60–90 second demo.

---

# Suggested Demo

## 0–15 seconds

User says:

> "Remind me to buy milk when I'm at a grocery store today."

Show automatically generated reminder.

---

## 15–35 seconds

Simulate or enter grocery-store geofence.

Notification:

> "You're at Safeway — remember to buy milk."

---

## 35–55 seconds

Say:

> "Write an email to Alex saying I'm running 10 minutes late."

Show generated email.

---

## 55–75 seconds

Show architecture:

```text
Voice
   ↓
Intent Parser
   ↓
Structured Task
   ↓
Context Engine
  ↙       ↘
Time    Location
   \       /
    ↓     ↓
Right action
at the right time
```

---

# Daily Working Schedule

If both people can spend approximately 3–5 focused hours/day:

## First 15 minutes

Daily sync:

```text
What did I finish?
What am I doing today?
Am I blocked?
Did our API/schema change?
```

Keep this under 15 minutes.

---

## First work block

Each person independently builds their module.

Do not pair-program routine features.

---

## Last 30–45 minutes

Integration.

Every night:

```text
git pull
run backend
run app
test today's end-to-end flow
fix integration problems
merge
```

Never let branches drift apart for several days.

---

# Git Strategy

Use:

```text
main
dev
person1/*
person2/*
```

Examples:

```text
person1/intent-parser
person1/email-actions
person1/context-engine

person2/voice-input
person2/location
person2/geofencing
```

Merge into `dev` daily.

Only merge stable versions from `dev` to `main`.

---

# Ownership Matrix

| Module | Owner | Support |
|---|---|---|
| FastAPI backend | Person 1 | Person 2 |
| Database | Person 1 | Person 2 |
| Reminder schema | Person 1 | Shared |
| LLM parsing | Person 1 | Person 2 |
| Date/time extraction | Person 1 | — |
| Context scoring engine | Person 1 | Person 2 |
| Email drafting | Person 1 | Person 2 |
| React Native app | Person 2 | Person 1 |
| UI/UX | Person 2 | Person 1 |
| Voice recording | Person 2 | Person 1 |
| Location | Person 2 | Person 1 |
| Places API | Person 2 | Person 1 |
| Geofencing | Person 2 | Person 1 |
| Notifications | Person 2 | Person 1 |
| Wake word | Person 2 | Person 1 |
| Privacy UX | Person 2 | Person 1 |
| Backend privacy | Person 1 | Person 2 |
| Testing | Shared | Shared |
| Demo | Shared | Shared |

---

# Milestones

## Milestone 1 — End of Day 2

```text
Text
 -> LLM
 -> structured reminder
 -> database
 -> mobile UI
```

If this does not work, stop adding features until it does.

---

## Milestone 2 — End of Day 4

```text
Voice
 -> reminder
 -> time notification
```

You now have a basic voice assistant.

---

## Milestone 3 — End of Day 7

```text
Voice
 -> reminder
 -> understand user's location/place
 -> context evaluation
```

You now have the technical foundation for the real idea.

---

## Milestone 4 — End of Day 9

```text
Voice intention
      ↓
context-aware reminder
      ↓
background notification
```

This is the project's main differentiator.

---

## Milestone 5 — End of Day 10

```text
Voice
 -> action detection
 -> email draft
```

You now demonstrate that the system is more than a reminder app.

---

## Milestone 6 — End of Day 12

The project should be FEATURE COMPLETE.

Days 13–14 should not introduce major functionality.

They are only for:

- bugs
- reliability
- polish
- demo preparation

---

# If You Fall Behind

Cut features in this order:

### Cut first
- custom wake word

### Cut second
- Gmail OAuth / actual sending

Use native email composer instead.

### Cut third
- learned/personalized reminder scores

Use deterministic rules.

### Cut fourth
- multiple location providers

Use one Places API.

### NEVER cut

- voice input
- reminder parsing
- time reminders
- location awareness
- location-triggered reminders
- end-to-end mobile demo

Those are the core product.

---

# Best Parallelization Rule

Person 1 should always make backend features testable **without the phone**.

Example:

```bash
curl POST /evaluate-reminder
```

should work using mock context.

Person 2 should always make mobile features testable **without the backend**.

Use mock objects where necessary.

That way:

- backend delays do not block mobile
- mobile bugs do not block backend
- integration happens nightly
- both people remain productive

---

# Final Definition of Done

After two weeks, someone should be able to:

1. Open the app.
2. Speak naturally.
3. Say:
   > "Remind me to buy milk when I'm at a grocery store."
4. Have the system understand the task automatically.
5. Walk into/near a grocery store.
6. Receive a useful reminder without manually opening the app.
7. Say:
   > "Write an email to Alex saying I'm running late."
8. Receive an editable generated email draft.
9. See clear indicators whenever microphone/location capabilities are active.

If all nine work reliably, the MVP is successful.
