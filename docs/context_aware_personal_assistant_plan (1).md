# Context-Aware Personal Assistant — 2-Week MVP Plan

## 1. Idea Summary

Build a mobile personal assistant that can capture spoken intentions, turn them into structured tasks, and remind the user at the right moment based on **time, place, and context**.

Instead of being a normal reminder app where the user manually chooses a time, the assistant should understand requests such as:

- "Hey [Assistant], remind me to buy milk."
- "Remind me to submit my assignment tomorrow before class."
- "When I'm near a grocery store, remind me to buy eggs."
- "Remind me to call Mom when I get home."
- "Write an email to my professor saying I'll be late."
- "Remind me about this if I haven't done it by 6."
- "Next time I'm at Target, remind me to get toothpaste."

The assistant converts natural language into a structured action:

- intent
- task
- deadline
- relevant location/category
- trigger conditions
- action type
- completion state

It then chooses the best time to surface the reminder.

The goal is not just "voice reminders." The interesting part is a **context engine** that decides *when a reminder is useful*.

Example:

> User: "Remind me to buy groceries tonight."

Instead of only sending an 8 PM notification:

1. The system knows the reminder is due tonight.
2. It notices the user enters or approaches a grocery store at 5:30 PM.
3. It sends:
   "You're at a grocery store and still need groceries tonight."

That creates a much more useful assistant.

---

# 2. MVP Scope

Two weeks is enough for a strong prototype, but not a production-grade always-on Siri replacement.

The MVP should support four core features:

### A. Voice capture

User activates the assistant using either:

- Push-to-talk button — required fallback.
- Wake phrase such as "Hey Nova" — stretch feature / Android-first depending on platform limitations.

After activation:

1. Record a short command.
2. Speech-to-text.
3. Send transcript to an LLM.
4. Convert into structured JSON.

Example:

Input:

> "Remind me to buy milk when I'm at a grocery store today."

Output:

```json
{
  "intent": "create_reminder",
  "title": "Buy milk",
  "deadline": "2026-09-23T23:59:00",
  "location_type": "grocery_store",
  "location_name": null,
  "trigger": ["location", "deadline"],
  "status": "pending"
}
```

---

### B. Smart reminders

Support three trigger types:

1. **Time**
   - "Remind me at 5 PM."

2. **Specific place**
   - "Remind me when I get home."
   - "Remind me at Target."

3. **Place category**
   - "When I'm at a grocery store..."
   - "When I'm near a pharmacy..."

The reminder engine evaluates:

```text
Should I notify now?

= task incomplete
AND
(
    time condition relevant
    OR location condition relevant
    OR deadline is approaching
)
AND cooldown has expired
```

Example scoring:

```text
+50 currently inside relevant location
+30 deadline within 2 hours
+15 currently traveling toward relevant location
+10 reminder has not been shown recently
-50 reminder dismissed in last 30 minutes
```

For the MVP, a deterministic rule engine is better than using an LLM for every location update.

---

### C. Context/location engine

Do NOT continuously poll GPS every few seconds.

Use event-driven location whenever possible:

- geofences for known places
- significant-location-change APIs
- low-frequency background location
- request current location only when evaluating a relevant task

Possible context sources:

- GPS coordinates
- reverse geocoding
- nearby place category
- home/work saved locations
- current time
- deadline
- reminder completion history

For "grocery store", the system can:

1. Obtain location.
2. Query a places API for nearby stores.
3. See whether one is within approximately 50–150 meters.
4. Trigger the reminder.

Possible providers:

- Google Places API
- Mapbox
- Apple MapKit / local search
- Foursquare Places

For a two-week prototype, Google Places or MapKit is probably the fastest route.

---

### D. Action execution

Start with one useful action:

## Draft email

Example:

> "Write an email to Professor Smith saying I'll be 10 minutes late."

Pipeline:

```text
Voice
 -> Transcript
 -> Intent parser
 -> email_draft action
 -> LLM creates subject/body
 -> user sees draft
 -> user approves
 -> open email composer / send via connected provider
```

IMPORTANT:

For the MVP, require confirmation before sending an email.

Do not let the model silently send messages.

Later actions could include:

- calendar events
- texts
- notes
- navigation
- shopping list updates
- Slack
- todo apps

---

# 3. Recording / Privacy / Legal Design

## Do not build the first version as "record audio 24/7 and upload everything."

That introduces major:

- consent issues
- privacy risks
- app-store concerns
- battery costs
- storage costs
- security risks

### Washington example

Washington RCW 9.73.030 generally requires consent from **all participants** before recording a private conversation.

Because an ambient assistant may hear conversations involving other people, continuously storing those conversations can create legal risk.

Laws vary between U.S. states and countries, so this should not be treated as legal advice. A production release should receive actual privacy/legal review.

Source:
https://app.leg.wa.gov/rcw/default.aspx?cite=9.73.030

---

## Better architecture: Wake-word mode

The safer design is similar to mainstream voice assistants:

```text
Microphone
   |
   v
ON-DEVICE wake-word detector
   |
   | nothing recognized
   +----------------------> discard audio buffer
   |
   | "Hey Nova"
   v
play activation sound / display indicator
   |
   v
record command only
   |
   v
speech-to-text
   |
   v
intent processing
   |
   v
discard recording by default
```

The wake-word engine should ideally run entirely on-device.

The cloud should receive **nothing** until activation.

The FTC specifically describes voice assistants as listening for wake-word sound patterns and warns that unexpected activation can still happen, which is another reason to clearly indicate when recording begins.

FTC:
https://consumer.ftc.gov/articles/how-secure-your-voice-assistant-protect-your-privacy

### Product privacy rules

For the prototype:

- Never upload pre-wake-word audio.
- Show an obvious indicator while recording.
- Optionally play a short activation tone.
- Stop recording after silence or a short maximum duration.
- Delete raw recordings after transcription by default.
- Store transcript only if needed.
- Provide a delete-history control.
- Encrypt authentication tokens.
- Never store location history unnecessarily.
- Store meaningful events instead:
  - `entered_grocery_store`
  - not a minute-by-minute trail.

---

# 4. Location Privacy and Platform Constraints

Background location is possible, but permission must be explicit.

## iOS

Apple supports background Core Location access, including "Always" authorization, but emphasizes transparency and only requesting it when necessary.

Useful references:

https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background

https://developer.apple.com/documentation/corelocation/cllocationmanager/requestalwaysauthorization()

A polished product should first explain:

> "Allow background location so Nova can remind you when you arrive at places connected to your reminders."

Then request permission.

Avoid requesting it immediately on first launch with no explanation.

---

## Android

Android 10+ provides `ACCESS_BACKGROUND_LOCATION`.

Google also restricts background location through Play policy and expects it to be directly related to the app's core feature.

References:

https://developer.android.com/develop/sensors-and-location/location/permissions/background

https://developer.android.com/develop/sensors-and-location/location/permissions

---

# 5. Recommended MVP Architecture

## Client

Fastest options:

### Option 1 — React Native / Expo

Good if you want one codebase.

Recommended if you already know React/TypeScript.

Use native modules where necessary for:

- background location
- notifications
- audio recording

Potential limitation:
true always-on wake-word behavior can be more difficult.

### Option 2 — Native iOS Swift

Best if your demo will be on an iPhone and you want stronger integration with:

- Core Location
- geofencing
- notifications
- microphone
- background services

### Recommendation

For a two-week project:

**React Native + TypeScript for the main MVP.**

Treat wake-word support as a secondary feature.

Make push-to-talk flawless first.

---

## Backend

Use:

- FastAPI
- PostgreSQL / Supabase
- OpenAI API for intent extraction and drafting
- optional Redis only if needed

Architecture:

```text
Mobile App
   |
   +---- voice recording
   |
   +---- location/geofence events
   |
   v
FastAPI API
   |
   +---- Intent Parser
   |
   +---- Reminder Service
   |
   +---- Action Service
   |
   +---- Places Service
   |
   v
PostgreSQL / Supabase
```

However, location-trigger evaluation should remain mostly on-device when possible.

This improves:

- privacy
- responsiveness
- battery efficiency
- server cost

---

# 6. Suggested Data Model

## Reminder

```ts
type Reminder = {
  id: string;
  title: string;
  description?: string;

  createdAt: Date;
  deadline?: Date;

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

  lastNotifiedAt?: Date;
  snoozedUntil?: Date;
};
```

---

## Action

```ts
type Action = {
  type:
    | "reminder"
    | "email_draft"
    | "calendar"
    | "note";

  requiresConfirmation: boolean;

  payload: Record<string, unknown>;
};
```

---

# 7. LLM Interface

Don't ask the LLM to return free-form text.

Use structured output / JSON schema.

Possible intent schema:

```json
{
  "intent": "create_reminder | email_draft | complete_reminder | list_reminders",
  "title": "string",
  "deadline": "ISO timestamp or null",
  "location": {
    "name": "string or null",
    "category": "string or null"
  },
  "recipient": "string or null",
  "content": "string or null"
}
```

Example:

User:

> "Next time I'm at Safeway remind me to get oat milk."

Model:

```json
{
  "intent": "create_reminder",
  "title": "Get oat milk",
  "deadline": null,
  "location": {
    "name": "Safeway",
    "category": "grocery_store"
  },
  "recipient": null,
  "content": null
}
```

---

# 8. Core User Flow

```text
User says:
"Remind me to get eggs when I'm at a grocery store."

        |
        v

Speech-to-text

        |
        v

LLM intent extraction

        |
        v

Reminder created:
Task = get eggs
Context = grocery store

        |
        v

App registers relevant background context

        |
        v

Later:
Location event occurs

        |
        v

Places API:
"Safeway, grocery_store, 42m"

        |
        v

Reminder engine checks:
- task incomplete? YES
- grocery store nearby? YES
- cooldown? CLEAR

        |
        v

Push/local notification

"You're near Safeway — remember to get eggs."
```

---

# 9. TWO-WEEK DEVELOPMENT PLAN

## Day 1 — Architecture + repo

Goal: skeleton running end-to-end.

Build:

- GitHub repo
- React Native project
- FastAPI backend
- Supabase/Postgres
- environment configuration
- Reminder schema
- API endpoints

Endpoints:

```text
POST /parse
POST /reminders
GET  /reminders
PATCH /reminders/{id}
POST /actions/email
```

Deliverable:

User can manually type:

> "Remind me to buy milk tomorrow."

and see a parsed reminder.

---

## Day 2 — Natural-language reminder parser

Implement:

- LLM structured outputs
- dates/times
- reminder task extraction
- location extraction

Test at least 30 sentences.

Examples:

- tonight
- tomorrow morning
- Friday
- in 30 minutes
- when I get home
- when I'm at Target
- next grocery store
- before class

Deliverable:

Text -> correct reminder JSON reliably.

---

## Day 3 — Reminder UI

Build screens:

### Home

- microphone button
- upcoming reminders
- smart/context reminders

### Reminder detail

- title
- deadline
- location trigger
- complete
- snooze
- delete

### History

- completed reminders

Deliverable:

Complete reminder lifecycle works.

---

## Day 4 — Voice input

Implement:

- microphone permissions
- record command
- speech-to-text
- transcript display
- parsing

Flow:

```text
Tap mic
 -> speak
 -> transcript
 -> structured reminder
 -> confirmation
```

Deliverable:

Fully functional voice-to-reminder.

Do NOT worry about wake word yet.

---

## Day 5 — Notifications + deadlines

Implement local notifications.

Logic:

- exact reminder time
- approaching deadline
- overdue
- snooze
- completed-task cancellation

Example:

```text
deadline = 8 PM

6 PM -> optional early notification
8 PM -> deadline notification
9 PM -> optional overdue notification
```

Deliverable:

Time-based assistant works completely.

---

## Day 6 — Location permissions + current context

Implement:

- foreground location
- permission UX
- reverse geocoding
- location debugging screen

Display:

```text
Current location:
University District

Nearby:
Safeway
CVS
Starbucks
```

Deliverable:

App understands where user currently is.

---

## Day 7 — Places integration

Add nearby-place recognition.

Given coordinates:

```text
find nearby:
grocery stores
pharmacies
gyms
campus
restaurants
stores
```

Normalize provider categories into your own taxonomy.

Example:

```text
Google type: supermarket
Google type: grocery_store

-> internal category:
grocery_store
```

Deliverable:

App can answer:

> "Am I near a grocery store?"

---

# END OF WEEK 1

At this point you should already have a demoable product:

```text
voice
 -> understand reminder
 -> save
 -> time notification
 -> understand current location
```

Everything after this makes it intelligent.

---

## Day 8 — Geofencing

Implement geofence triggers for:

- home
- work/school
- specifically named stores/locations

Example:

> "Remind me when I get home."

App registers a geofence around home.

Do not continually request GPS.

Deliverable:

Entering a saved region triggers reminders.

---

## Day 9 — Context reminder engine

Create:

```ts
shouldNotify(reminder, context)
```

Inputs:

```text
current time
deadline
location
nearby places
last notification
completion status
```

Example logic:

```python
if reminder.completed:
    return False

if near_relevant_place(reminder):
    return True

if deadline_within(reminder, hours=1):
    return True

return False
```

Then improve it using scoring.

Deliverable:

Context-aware notification behavior.

---

## Day 10 — Email drafting

Add:

```text
"Write an email to Alex saying I'm running late."
```

Generate:

- recipient/name
- subject
- body

Show confirmation UI.

Best MVP:

Open native mail composer pre-filled with the draft.

This avoids building OAuth email sending immediately.

Stretch:

Connect Gmail API and create drafts.

Deliverable:

Voice -> generated email draft -> user approval.

---

## Day 11 — Wake-word experiment

ONLY NOW work on wake word.

Potential tools:

- Picovoice Porcupine
- openWakeWord
- custom small keyword model

Desired architecture:

```text
on-device audio frames
       |
       v
wake-word model
       |
       | no activation
       -> delete
       |
       v
activation detected
       |
       v
start command recorder
```

If mobile OS restrictions make reliable background wake-word detection difficult, ship:

- push-to-talk
- lock-screen shortcut/widget
- Action Button / shortcut integration
- notification quick action

Do not sacrifice the rest of the MVP for wake-word support.

---

## Day 12 — Privacy + battery optimization

Add:

- recording indicator
- location permission explanation
- delete history
- recording auto-delete
- location-event minimization
- reminder cooldowns
- location accuracy tuning

Measure:

- idle battery impact
- number of location requests
- Places API requests

Deliverable:

Assistant can run for hours without ridiculous battery use.

---

## Day 13 — Testing

Build a test suite of scenarios.

### Voice

- noisy environment
- short request
- long request

### Dates

- tomorrow
- tonight
- Friday
- 30 minutes

### Location

- home
- grocery store
- named store
- unknown place

### Combined

> "Before 7 PM, remind me to get eggs if I'm near a grocery store."

### Email

> "Write an email to my TA asking for office hours."

### Failure

- no internet
- GPS disabled
- microphone denied
- location denied
- LLM JSON malformed
- Places API unavailable

Fix the most visible failures.

---

## Day 14 — Polish + demo

Create a 60–90 second demo.

Suggested demo:

### Scene 1

Say:

> "Remind me to buy milk when I'm at a grocery store today."

Show reminder parsed automatically.

### Scene 2

Simulate/enter a grocery-store geofence.

Notification:

> "You're at Safeway — remember to buy milk."

### Scene 3

Say:

> "Write an email to John saying I'll be 10 minutes late."

Show completed email draft.

### Scene 4

Show architecture briefly:

```text
Voice + Location
      ↓
Context Engine
      ↓
Right action at the right moment
```

---

# 10. Priority Order

If time gets tight, build in this exact order:

## Must have

1. Natural-language reminder parsing
2. Voice input
3. Reminder database
4. Time notifications
5. Current location
6. Grocery-store/location detection
7. Location-triggered reminders

## Should have

8. Email drafting
9. Geofencing
10. smarter notification scoring

## Stretch

11. Wake word
12. Gmail integration
13. calendar actions
14. learned routines

The project is still compelling without a custom wake word.

The differentiator is:

**reminders triggered by real-world context.**

---

# 11. Suggested Tech Stack

## Mobile

- React Native
- Expo / development build
- TypeScript

Libraries/services depending on platform:

- Expo Location
- Expo Notifications
- Expo Audio / native audio module
- Places API

## Backend

- FastAPI
- Python
- Pydantic
- Supabase/PostgreSQL

## AI

- speech-to-text model/API
- LLM with structured output
- optional local wake-word model

## Authentication

For a prototype:

- Supabase Auth

---

# 12. Suggested Repository

```text
context-assistant/
|
|-- mobile/
|   |-- src/
|       |-- components/
|       |-- screens/
|       |-- services/
|       |   |-- audio.ts
|       |   |-- location.ts
|       |   |-- reminders.ts
|       |   |-- notifications.ts
|       |   |-- places.ts
|       |
|       |-- engine/
|           |-- contextEngine.ts
|
|-- backend/
|   |-- app/
|       |-- main.py
|       |-- routes/
|       |-- models/
|       |-- services/
|       |   |-- llm.py
|       |   |-- reminder_parser.py
|       |   |-- email.py
|
|-- docs/
|   |-- architecture.md
|
|-- README.md
```

---

# 13. What Makes This Project Interesting

Lots of products can create reminders.

The more interesting problem is:

> **When should the assistant interrupt the user?**

Traditional reminder:

```text
User chooses time
     ↓
timer expires
     ↓
notification
```

This project:

```text
User expresses intent
        ↓
AI extracts constraints
        ↓
Assistant observes context
        ↓
Context engine evaluates opportunities
        ↓
Notification occurs when useful
```

That can eventually support much richer behavior:

> "Remind me to talk to Sarah about the project next time we're both on campus."

> "If I haven't submitted my assignment by 8 PM, bother me again."

> "When I'm near a pharmacy this week, remind me to pick up medicine."

> "When I arrive at work tomorrow, remind me to email Jason."

The assistant becomes an **intent-to-action system**, rather than another chatbot.

---

# 14. Longer-Term Vision

After the MVP:

### Personal context graph

```text
User
├── Home
├── University
├── Gym
├── Grocery stores
├── frequent contacts
├── classes
└── routines
```

### Integrations

- Gmail
- Google Calendar
- Slack
- Notion
- Apple Reminders
- Google Tasks

### Learned reminder timing

Eventually learn:

```text
When does this user actually act on reminders?
```

For example:

- ignores notifications during lectures
- usually shops after class
- checks email around 9 AM
- goes to the gym around 6 PM

Then reminder timing can become personalized.

---

# 15. Important Product Principle

Do not optimize for:

> "How much can the assistant constantly observe?"

Optimize for:

> "What is the minimum context necessary to help the user at the right moment?"

That approach gives you:

- better privacy
- lower battery usage
- easier app-store approval
- lower infrastructure cost
- easier user trust
- simpler engineering

And it still supports the central idea:

**Capture intent naturally, understand context, and take or suggest the right action at the right time.**
