# Person 2 implementation work log

Every numbered entry below accompanies a separate commit. Commit subjects identify
the entry; `git log --oneline person2/mobile-completion` supplies the exact hashes.
Only mobile code and documentation are changed. Backend contracts are inspected,
not modified. Tests reported as pending have not been run on a physical device.

## 01 — Pull, branch, scope, and dependency setup

1. Inspected the original two-person plan, the mobile app, and local Git changes.
2. Pulled `origin/main` with `git pull --ff-only origin main`, advancing from
   `7296f7d` to `5b8cb02`. Existing uncommitted Day 3 changes were preserved.
3. Created `person2/mobile-completion` before making any implementation commits.
4. Reviewed Person 2 Days 1–14 and the new backend wire contracts. Found that
   the backend accepts text only: `/transcribe` does not exist. The previous
   audio-upload implementation therefore requires replacement with client speech
   recognition. Reminder screens also currently save only to React state.
5. Installed SDK-compatible notifications, location, task manager, mail composer,
   linking and AsyncStorage, plus `expo-speech-recognition`. Retained the existing
   audio dependency for activation feedback. Lockfile records exact versions.

Verification: dependency installation succeeded. This setup commit deliberately
does not claim that device capabilities work yet. Subsequent entries record
implementation and validation by subsystem.

## Implementation sequence

- 02: shared API, persistent mock store, real CRUD, validated confirmation.
- 03: speech recognition and push-to-talk activation with permission/error UX.
- 04: local notifications, snooze/complete actions and cancellation.
- 05: foreground location, nearby places, saved places and context evaluation.
- 06: background geofencing and opt-in lifecycle behavior.
- 07: editable email drafts, approval and native mail composer.
- 08: privacy controls, documentation, integration checks and device checklist.

No deployment, email sending, main-branch implementation commit, or push is
performed as part of these work blocks.

## 02 — Real reminder API and persistent mock workflow (Days 1–2 repair)

1. Replaced per-screen API instances with a shared client; added request timeout,
   backend validation errors, optional API header, timestamp/timezone and pagination.
2. Replaced React-state-only writes with POST/PATCH/DELETE calls. Failed saves keep
   the user on the review screen; failed loads offer an explicit retry.
3. Added serialized AsyncStorage mock mutations so parallel actions do not overwrite
   each other. Empty history remains empty after restarting the app.
4. Made confirmation edit trigger and location type, preserve category fields,
   validate timezone-aware ISO dates, clear omitted locations, and review additional
   parser results in sequence. Each reviewed reminder gets a stable retry ID.
5. Replaced Alert-based delete/snooze menus with cross-platform controls and an
   explicit delete confirmation. Detail views read the latest reminder state.
6. Removed the obsolete `/transcribe` request. Speech recognition is restored in
   step 03 against the actual text-only backend contract.

Verification: `cd mobile && npm run typecheck` passed. Physical-device persistence
and real server round-trip checks are recorded separately in the final checklist.

## 03 — Voice input and reliable activation (Days 3, 7, 11–12)

1. Pinned `expo-speech-recognition@sdk-54` rather than the current package intended
   for newer Expo releases; added its microphone/speech permission config plugin.
2. Replaced fabricated mock transcriptions and non-existent audio uploads with
   actual client speech recognition. Both mock and real API modes receive real text.
3. Added interim transcript review, start/stop/discard, permission/service errors,
   a pulsing microphone-active indicator, elapsed time, 60-second limit and haptic
   activation feedback. Leaving the screen/backgrounding aborts the microphone.
4. Reuse the same typed-input parse/review/save flow after speech. No raw recording
   is persisted by this app. The platform speech service may use network recognition;
   the UI explains that distinction before activation.
5. Chose the plan's large push-to-talk fallback for Day 11. Always-listening wake
   word is optional and not claimed; the reliable manual activation is implemented.

Verification: TypeScript check passed. Actual microphone behavior requires a
supported browser or a native development build; Expo Go lacks this native module.
Sources: [speech module](https://github.com/jamsch/expo-speech-recognition),
[Expo location](https://docs.expo.dev/versions/v54.0.0/sdk/location/),
[Expo notifications](https://docs.expo.dev/versions/v54.0.0/sdk/notifications/).

## 04 — Time notifications and reminder actions (Days 4, 7)

1. Added native notification permission/channel/category setup, requested only when
   the user chooses Enable reminder notifications on Home.
2. Schedule future time reminders with stable IDs. Snooze replaces the date;
   completion, deletion or editing cancels/replaces the old schedule. Combined
   location/time reminders are evaluated against context rather than blindly fired.
3. Reconcile schedules after successful initial loading and subsequent mutations;
   serialize reconciliation to avoid races. A failed initial load does not erase
   existing device schedules.
4. Added Complete and Snooze 10 min notification actions, including launch response
   handling, real API updates, error reporting and subsequent schedule reconciliation.
5. Added explicit browser fallback: native notification controls explain the platform
   requirement instead of claiming to schedule notifications.

Verification: TypeScript check passed. Actual timed delivery and action callbacks
remain physical-device tests; simulator/browser compilation cannot establish them.
