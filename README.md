# Context Assistant

```text
backend/  Person 1's FastAPI backend (unchanged by this mobile implementation)
mobile/   Person 2's Expo/TypeScript app, platform services and tests
docs/     Original plans, step-by-step implementation log and mobile runbook
```

Start with the [Person 2 runbook](docs/person2-runbook.md). It covers browser/native
setup, mock versus real backend mode, permissions, test commands, architecture,
demo steps and the outstanding physical-device checklist.

Every implementation commit includes an entry in the
[Person 2 work log](docs/person2-work-log.md). Work is on
`person2/mobile-completion`, based on `main` at `5b8cb02`.

[GitHub Actions CI](docs/ci.md) runs mobile checks/platform exports and isolated
API integration/backend contract tests on pushes and pull requests.

```bash
cd mobile
npm ci
npm run web
```

Speech recognition and background location on iOS/Android require a development
build, not Expo Go. Native notifications/geofences are unavailable in the browser.

```bash
npm run typecheck
npm test
# After cd ../backend && uv sync:
npm run test:backend
```

The mobile implementation is covered by automated tests and bundles on all three
platforms. Actual device delivery, geofences, composer behavior, battery measurement
and demo recording still need the runbook's manual verification.
