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

## 05 — Foreground location, places and scoring (Days 5–7, 9)

1. Added optional foreground permission with explanation, balanced GPS accuracy,
   visible coordinates/accuracy and low-accuracy rejection.
2. Added Overpass nearby lookup with 500 m query radius, timeout, 2-minute local
   cache, recalculated distances and OpenStreetMap attribution. Mapped provider
   tags to the actual backend taxonomy (grocery_store, pharmacy, gym, restaurant,
   coffee_shop, university, shopping). Public provider failures are surfaced.
3. Added saved-place list/save/delete UI using `/saved-places`. Names are normalized,
   radius is validated, and the backend remains the saved-place authority in real mode.
4. Added `/evaluate-reminder` requests with current timestamp/timezone, coordinates
   and real nearby places. Display decision reasons and notify only on backend
   approval. Mock evaluation explicitly holds rather than inventing a real decision.
5. Serialize evaluation, check completed/snoozed/recently-notified state, and persist
   a local cooldown ledger before PATCHing lastNotifiedAt. API failure after delivery
   therefore does not immediately duplicate an already displayed notification.

Verification: TypeScript check passed. Live GPS and provider queries require user
permission and runtime testing. Query syntax source:
[Overpass QL](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL).

## 06 — Foreground lifecycle and background geofencing (Days 8–9, 12)

1. Defined geofence and background-location tasks at module scope, imported from
   App before navigation. Native task execution reuses the same context evaluator.
2. Registered saved places and coordinate reminders as entry-only geofences;
   limit to 20 regions for cross-platform compatibility and report overflow.
   Adding/deleting places or changing reminders refreshes regions.
3. Require foreground opt-in before requesting background permission. Explicit
   background consent starts movement-driven balanced-accuracy updates (200 m,
   minimum/deferred 2-minute interval), OS background indicator and Android service.
4. Added foreground movement watcher, removed on background/unmount; serialized
   processing with no fixed GPS polling loop. Provider failure still permits
   coordinate and saved-place evaluation. OS event timing is not guaranteed.
5. Added stop-background and disable-all-location actions. Disabling persists the
   preference before stopping tasks, so in-flight events cannot deliver notifications.
   Background setup failure rolls back the opt-in and stops tasks.
6. Background errors store only a generic timestamped retry message, not precise
   coordinates or transcripts. Added native location plugin configuration.

Verification: TypeScript check passed. Physical-device foreground/background,
geofence entry, permission revocation, force-quit behavior and battery measurements
are pending and must be completed before claiming the real-device milestone.

## 07 — Email draft review and composer (Day 10)

1. Added typed and spoken email-command input, `/actions/email` drafting, and
   editable recipient address, subject and body. Reminder entry routes email
   commands into this flow as well.
2. Display recipient names separately from addresses. A name such as Alex is never
   treated as an address; the user must verify/provide a valid email before proceeding.
3. Explicit Approve & open Mail first PATCHes exactly the edited fields and POSTs
   approval, then opens the native composer (mailto fallback). The backend sends
   nothing; the user makes the separate send decision inside their mail app.
4. Added cancellation API action and errors that leave the draft available for retry.
   Mock drafts are labeled by the application's demo-mode setting.

Verification: TypeScript check passed. Launching a real mail composer and sending
or cancelling in it are user/device actions, not executed during this implementation.

## 08 — Privacy controls and activation feedback (Days 11–12)

1. Added a Privacy screen explaining local storage, platform speech services,
   backend transcript retention and optional third-party coordinate lookup.
2. Read the backend's actual privacy/settings endpoints; added transcript storage
   disable/erase, enable (when server allows) and 1/7/30-day retention controls.
3. Added location stop controls, link to device settings, and explicit confirmation
   for permanent history deletion. Deletion stops background tasks and cancels this
   app's schedules before deleting server/demo history; saved places remain.
4. Added a generated local activation tone plus visual/haptic feedback. The cached
   WAV is synthesized, not a microphone recording. Audio feedback failure does not
   block speech input.
5. Expanded `.env.example` with LAN URL advice, place provider endpoint and optional
   development API key caveat: EXPO_PUBLIC values are bundled and not secrets.
6. Added the test runner and test script for the final verification block.

Verification: TypeScript check passed. Device sound, privacy UI round trips and
permission-setting navigation are covered by the pending manual checklist.

## 09 — Automated verification and compatibility fixes (Days 7, 13)

1. Added 32 mobile tests covering restart persistence, concurrent writes, empty
   history, real request methods, timezone/context wire shape, parser error handling,
   pagination, mock date parsing, exact scheduling, snooze/cancel/permissions,
   category mappings and provider distances. All 32 passed.
2. Added `npm run test:backend`: starts the unchanged backend in mock-parser mode
   with a uniquely allocated localhost port and temporary SQLite database. Overrides
   credentials/database environment so developer data and paid LLM calls are never
   used. Stops the server afterward; retains the temporary DB for inspection.
3. Four integration tests passed through the actual mobile API client: parse/save/
   snooze/complete/delete; saved places and grocery matching; draft/edit/approve/cancel;
   privacy/preferences/isolated history deletion. Normal `npm test` skips these four
   unless the isolated harness explicitly enables them.
4. Ran unchanged backend tests: contract, reminders, actions and places — 124 passed.
5. Exporting all platforms initially found react-native-screens 4.28 installed from
   the original broad range, incompatible with SDK 54's code generator. Used Expo's
   bundled versions: react-native 0.81.5, screens ~4.16.0, safe-area ~5.6.0. Subsequent
   `npx expo export --platform all` succeeded for web, iOS and Android.
6. Added post-await opt-in rechecks around background task registration so a disable
   racing with registration cleans up any newly created task.
7. Ran dependency audit. Upgraded the newly added Vitest to 4.1.11, eliminating its
   two critical advisories. Final audit: 0 critical, 23 high, 14 moderate. Remaining
   advisories are in the existing pinned Expo/React Native toolchain; reported fixes
   require incompatible major changes/downgrades and were not forced here.
8. Final TypeScript and Expo public configuration checks passed; diff whitespace
   check passed. Native exports validate JS bundling, not native compilation or
   physical-device delivery. No LLM credits, live location or email sends were used.

## 10 — Native setup, runbook and final handoff (Days 13–14)

1. Added Expo development client and changed native scripts to development builds;
   Expo Go cannot run the speech module or the required background tasks. Generated
   native directories are ignored; native build itself remains a manual/toolchain test.
2. Added a detailed runbook: setup, env, every screen flow, API reference, architecture,
   commands/results, all-days task mapping, device test matrix, battery protocol and
   a timed demo walkthrough. Replaced the outdated Day-1-only root README with links.
3. Explicitly labeled sample email drafts in demo mode and preserved the user's
   original Day 3 changes through the subsequent mobile implementation commits.
4. Verified backend source has no diff from pulled `5b8cb02`; implementation commits
   were made only on `person2/mobile-completion`. No push or merge was performed.
5. Installing the native development client changed the final audit to 0 critical,
   23 high and 17 moderate (40 total). The earlier step 09 result reflects its own
   dependency state. The runbook records the final state.
6. Reran unit tests (32 passed), TypeScript and all-platform exports after the final
   native-client/setup changes. Introspected Expo plugin output and confirmed iOS
   microphone/speech/location descriptions and background modes, plus Android
   background location/foreground-service permissions. Whitespace checks passed.

Final handoff distinguishes code/test completion from remaining hardware work:
live permissions/GPS, timed delivery, geofences, background/force-quit, native mail,
battery behavior and demo recording have not been verified on a physical phone.
Follow the runbook before calling the plan's full real-device milestone complete.

## 11 — Cross-check: speech ownership and notification dates

1. Reviewed navigation-stack lifecycle and asynchronous permission flows. Found that
   mounted hidden screens could receive global speech results, and cancellation while
   awaiting permission could still start a recording. Added focus/ownership guards
   and cancellation generations, including background and unmount cleanup.
2. Added React component regression tests for unrelated speech events, duplicate taps,
   cancellation, navigation blur, backgrounding and unmount during permission prompts.
3. Corrected pure-time scheduling to use the later deadline/snooze rather than allowing
   an expired or earlier snooze to override a future deadline; suppress already-notified dates.
4. Added three date-policy regressions. `npm test`: 41 passed, four isolated integration
   tests intentionally skipped. `npm run typecheck`: passed. No native-device claim.
5. Added matching React 19.1 component-test dependencies. Dependency audit remains
   40 advisories (23 high, 17 moderate, zero critical); no forced toolchain upgrade.
6. Commit scope: speech component, notification date policy, regression tests,
   test dependency lockfile and this step-by-step record; feature branch only.

## 12 — Cross-check: context freshness and background consent

1. Rechecked reminders after delayed context evaluation and before notification:
   deleted, completed, snoozed or edited records now suppress the stale decision.
   Rechecked foreground consent immediately before dispatch as well.
2. Reject GPS fixes older than two minutes, future-dated fixes beyond a ten-second
   tolerance, invalid coordinates and poor accuracy before any places-provider call.
3. Found background permission completion could restore opt-in after a user disabled
   tracking. Added a cancellation generation and foreground-consent recheck.
4. Background disable now attempts to stop both geofences and updates even when one
   native stop fails, while retaining the error and persisted opt-out.
5. Added 13 regressions covering stale decisions, cooldown, consent, GPS validation,
   permission cancellation and partial native cleanup failure. Full mobile suite:
   54 passed, four isolated integration tests skipped in the default run; TypeScript passed.
6. Separately reran the isolated HTTP integration suite: all four passed against a
   temporary database; its server shut down automatically. Unchanged backend contract,
   reminder, action and places suites: 124 passed. No developer data or paid API calls.
7. Commit scope: context/location/background guards, regression tests and this record.
   The final export and handoff audit are recorded separately in step 13.

## 13 — Cross-check evidence and honest completion boundary

1. Re-read the Person 2 day-by-day requirements and compared them with the runbook's
   implementation/device-test matrix. Preserved the explicit manual activation fallback
   and outstanding hardware, battery, UI smoke and demo-recording work.
2. Final all-platform Expo export passed after the step 12 fixes: web, iOS, Android.
   Confirmed Xcode is not installed (only Command Line Tools), so no native iOS build
   or physical-device success is claimed.
3. Verified backend source unchanged versus pulled main base `5b8cb02`, feature branch
   active and whitespace checks passing. No push or merge.
4. Updated runbook counts to 54 mobile tests, four isolated integrations and 124
   selected backend tests. Added `person2-cross-check.md` with review steps, fix commit
   references, test evidence and remaining verification/release caveats.
5. This commit records documentation only; implementation changes were committed
   separately in steps 11 and 12, each with its own test and work-log evidence.

## 14 — GitHub Actions CI implementation

1. Confirmed no existing GitHub workflows and inspected both lockfiles, backend test
   isolation and the smoke harness. No backend source or Person 1 implementation changes.
2. Added parallel mobile and integration jobs for pushes, pull requests and manual
   dispatch. Mobile checks TypeScript, regressions and all-platform exports; integration
   runs the same selected backend tests and isolated real HTTP tests used in the audit.
3. Added locked dependency installs, Node 22/Python 3.12, cached dependencies, pinned uv,
   read-only permissions, disabled persisted checkout credentials, concurrency and timeouts.
4. Added seven-day JUnit/export artifacts and ignored generated local test reports.
   CI has blank paid parser credentials and does not deploy, sign builds or use real data.
5. Documented triggers, check names, artifacts, activation, optional administrator-owned
   merge protection and hardware/security limitations in `docs/ci.md`; linked from README.
6. Checked action inputs against official action documentation. Commit records the
   workflow and documentation together; validation evidence follows in step 15.
