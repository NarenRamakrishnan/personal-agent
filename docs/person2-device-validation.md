# Device acceptance record — not yet executed

Use a new copy per device/build. Do not mark a test passed without observing it.
Do not record API tokens, raw speech, coordinates or private messages in shared reports.

Device/model: ___  OS: ___  app/build SHA: ___  tester/date: ___
Backend environment: ___  network: ___  battery/power mode: ___

| Scenario | Expected | Actual / evidence | Status |
| --- | --- | --- | --- |
| Native clean build and launch | New modules load; no stale dev-client binary | — | Not run |
| First connected launch and restart | Private token restored; reminders persist | — | Not run |
| Two devices | Neither sees or deletes the other's reminders | — | Not run |
| Speech allowed, denied, silent and interrupted | Clear state/error; no mic after cancellation/background | — | Not run |
| Text/voice → review/edit → save | Correct title/date/place; no automatic email send | — | Not run |
| Complete/delete/snooze with slow refresh | No stale state or restored schedule | — | Not run |
| Android exact-alarm denied/allowed/revoked | Accurate status; approximation warning; explicit settings flow | — | Not run |
| Two-minute alert, unlocked/locked/background | Record actual delivery delay; no duplicate | — | Not run |
| Notification Complete/Snooze actions | Persist correct state and schedule | — | Not run |
| GPS denied, poor accuracy and offline provider | Useful errors; no fabricated place | — | Not run |
| Grocery/pharmacy and named UPS/Target | Correct provider name/distance; no unrelated category match | — | Not run |
| Saved home/school/work geofence entry | Relevant alert with opted-in background access | — | Not run |
| Background, force-quit and restart | Record actual OS behavior/restrictions, not assumed delivery | — | Not run |
| Quiet-hours hold without further movement | One clearly labeled held alert at quietUntil | — | Not run |
| Held reminder edited/completed/deleted/snoozed | Pending stale alert cancelled | — | Not run |
| Location opt-out and history deletion | Background/held alerts stop; saved places kept as disclosed | — | Not run |
| Native email composer open/cancel | Verified address, editable draft, explicit user send | — | Not run |
| Offline/timeout/rejected token | Actionable error; no fake success or silent identity replacement | — | Not run |

## Battery/request measurement

Run comparable 30-minute sessions with matching screen/network conditions. Record
requests with platform profiling/network tools without exporting sensitive payloads.
Repeat anomalous results; report OS throttling/low-power restrictions.

| Mode | Start % | End % | Minutes | GPS callbacks | Places requests | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Idle, location off | — | — | — | — | — | Not measured |
| Foreground movement, location on | — | — | — | — | — | Not measured |
| Opted-in background movement | — | — | — | — | — | Not measured |

## Demo acceptance

After the matrix passes, use runbook section 9. Use test data and a verified test
email; cancel the mail composer rather than sending unless explicitly authorized.

Recording link: ___  duration: ___  build SHA: ___  actual vs simulated GPS: ___
Outstanding failures / follow-up owner: ___
