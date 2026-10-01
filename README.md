# Context Assistant

This repository is organized by responsibility:

```text
docs/    Project plans and architecture notes
mobile/  Expo + React Native mobile application
```

## Day 1 status

The Day 1 mobile foundation is in `mobile/`:

```text
mobile/
├── App.tsx
├── app.json
├── package.json
├── tsconfig.json
└── src/
    ├── api/          Backend-ready API client with mock mode
    ├── components/   Reusable reminder UI
    ├── data/         Mock reminders
    ├── navigation/   Navigation parameter types
    ├── screens/      Home, add reminder, and detail screens
    └── types/        Shared Reminder contract
```

Run mobile commands from the app directory:

```bash
cd mobile
npm install
npm start
```

Day 1 is local-only and supports viewing, creating, completing, and deleting reminders. Natural-language parsing, voice, location, notifications, and backend integration are intentionally deferred to later days.
