# Heedly

Heedly listens for the things you say you'll do and turns them into reminders that
fire at the right time or the right place. Say "remind me to return this when I'm near
UPS" or "I need to email Sam by Friday" and Heedly saves it, then nudges you when you
walk past a UPS or when Friday morning comes around.

Built for the Nebius x NVIDIA Global AI Hackathon. Every model call goes to
NVIDIA Nemotron 3 Super on Nebius Token Factory.

- **Live backend:** https://personal-agent-backend.vercel.app
- **License:** [MIT](LICENSE)

## How it works

1. The phone's speech service recognizes the command; it may process audio online.
   Only the resulting text is sent to this app's backend.
2. The backend asks Nemotron to pull out commitments: what to do, when and where.
3. Each reminder is stored with a time trigger, a place trigger or both.
4. The app schedules notifications and geofences, so the reminder fires when you are
   near the place or when the time comes.

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
cp .env.example .env
npm ci
npm run web
```

`EXPO_PUBLIC_USE_MOCKS=true` runs the app on sample data. Set it to `false` and point
`EXPO_PUBLIC_API_URL` at your backend to use real parsing. On a physical phone, use
your computer's LAN address instead of localhost. Restart Expo after changing `.env`.

Hosted backend: `https://personal-agent-backend.vercel.app`. Leave
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

Naren Ramakrishnan (mobile app) and Mihir Kolakaluri (backend and AI).
