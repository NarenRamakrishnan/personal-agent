# Heedly

Heedly listens for the things you say you'll do and turns them into reminders that
fire at the right time or the right place. Say "remind me to return this when I'm near
UPS" or "I need to email Sam by Friday" and Heedly saves it, then nudges you when you
walk past a UPS or when Friday morning comes around.

Built for the Nebius x NVIDIA Global AI Hackathon. Every model call goes to
NVIDIA Nemotron 3 Super on Nebius Token Factory.

- **Try it:** https://heedly-nine.vercel.app (voice works in Chrome; any browser can use Type instead)
- **Live backend:** https://personal-agent-backend.vercel.app
- **License:** [MIT](LICENSE)

## How it works

1. Tap **Listen** and talk normally. The phone's speech service turns each phrase into
   text (it may process audio online); only that text reaches this app's backend.
   **Type instead** does the same thing without a microphone.
2. When you tap **Stop & review**, everything you said goes to Nemotron as a whole,
   with your open reminders, so it can create new reminders ("call the dentist tomorrow
   at 9"), change one ("actually move the dentist to Friday"), finish one ("I already got
   the milk") or draft an email ("write Alex that I'm running late"). Corrections are
   read in context.
3. The review list shows everything new, updated and completed, email drafts and what
   Heedly learned. Reminders missing a time or place are flagged with a one-tap fix.
   Email is never sent for you: approving a draft only opens it in your mail app.
4. Each reminder has a time trigger, a place trigger or both, and can repeat daily,
   weekly or monthly (finishing one sets up the next). The app schedules notifications
   and geofences, so it fires when the time comes or you are near the place.
5. Heedly remembers what you tell it about your life: who someone is and their email
   ("my mom's email is ..."), and where you usually do an errand ("I get groceries at
   Trader Joe's"). Later, "email Mom" fills in her address and "buy milk" reminds you at
   your store. An address or place is kept only if you actually said it. Settings →
   What Heedly remembers shows each fact and the reminders it connects to, where you can
   correct or forget it.

This backend never receives raw audio. Apple, Google or the browser's speech service
may process audio remotely; on-device-only recognition is not enforced. Saved reminders
live in the configured database; command text is sent to Nebius for parsing in live mode.

## Repo layout

```text
backend/  FastAPI backend: Nemotron parsing, sessions, reminders, settings, spend guard
mobile/   Expo / React Native app (iOS, Android and web)
docs/     Plans, runbook, CI notes and work logs
```

## Run the backend

Needs Python 3.12+ and [uv](https://docs.astral.sh/uv/).

```bash
cd backend
cp .env.example .env    # add your NEBIUS_API_KEY
uv sync
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

The backend uses a local SQLite file by default. Set `DATABASE_URL` in `.env` to use
Postgres (we use Supabase). To try it without spending model credits, set
`PARSER_MODE=mock`.

Nebius has no spending cap, so the backend enforces its own daily call and token
limits. They are listed in `.env.example`.

Tests:

```bash
uv run pytest                 # offline, no model calls
uv run pytest -m live -s      # calls the real Nebius API and spends credits
```

## Run the app

Needs Node 22.

```bash
cd mobile
npm ci
npm run web
```

With no `.env`, the app talks to the hosted backend
(`https://personal-agent-backend.vercel.app`) with real Nemotron parsing. To use your
own backend, copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` (on a physical
phone, use your computer's LAN address instead of localhost). `EXPO_PUBLIC_USE_MOCKS=true`
runs on sample data with no backend. Restart Expo after changing `.env`.

Voice in the browser needs a browser with speech recognition, such as Chrome. Leave
`EXPO_PUBLIC_API_KEY` blank: connected mode automatically registers a private device
and sends its token. Native tokens use encrypted SecureStore; browser tokens last
only for the tab session. Closing a browser session can mean a new identity next time.
An explicitly configured legacy shared key makes its holders share data and is not
a secret when bundled in an app. Do not put a production shared secret in the app.

Speech recognition, notifications and background location on iOS and Android need a
development build (`npm run ios` or `npm run android`), not Expo Go.

Checks:

```bash
npm run typecheck
npm test
```

The full setup guide, every user flow and the demo walkthrough are in the
[mobile runbook](docs/person2-runbook.md). CI is described in [docs/ci.md](docs/ci.md).
See the [reliability handoff](docs/person2-reliability-handoff.md) for the latest fixes
and the physical-device, battery, security and demo gates that remain.

To try it without a phone, see the [phone-free testing guide](docs/person2-phone-free-testing.md):
`npm run preview:isolated` provides a disposable browser preview, while
`npm run test:browser` runs real browser acceptance tests against temporary data.

## Team

Naren Ramakrishnan (mobile platform: notifications, location, device auth) and
Mihir Kolakaluri (backend, AI and the listening and review experience).
