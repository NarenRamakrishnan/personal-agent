# Person 2 reliability handoff — October 18, 2026

**Phone-free follow-up:** the later [browser/emulator guide](person2-phone-free-testing.md)
supersedes the earlier browser/native-build blockers below for Android only. Actual
Chromium UI tests, Android native compilation/startup and background timed delivery
have now been exercised, including a native runtime crash fix. Physical-phone, iOS,
battery/live-model/security gates remain open. Work-log steps 24–26 contain evidence.

## Scope

Base: latest main `63ccae6`. Feature branch: `person2/reliability-integration`.
No backend implementation edits, hosted-data writes, paid model calls, push or merge
were performed for this follow-up. The hosted backend URL is
`https://personal-agent-backend.vercel.app`; health was HTTP 200 during the audit.

## Fixes, in commit order

| Work-log step | Commit | Result |
| --- | --- | --- |
| 16 | `da57ab7` | Automatic private-device registration, native encrypted token storage, browser session tokens, Bearer auth, rejected identities preserved |
| 17 | `d3797a3` | Backend-aligned school taxonomy; named/brand destinations retained outside canonical categories; bounded query/cache |
| 18 | `584af45` | Android exact-alarm declaration, runtime access check and explicit settings action; denial clearly warns about approximate delivery |
| 19 | `4a29372` | Revision-guarded reads, serialized writes, authoritative reload after writes and app-resume refresh |
| 20 | `6967bd5` | Persisted quiet-hours alerts, cooldown reservation, stable scheduling, cancellation after changes or opt-out |
| 21 | `f523938` | Full offline backend CI; authenticated smoke isolation; critical audit gate; corrected speech privacy and legacy-key disclosures |
| 22 | `0cfb965` | SDK-compatible React types, unforced dependency refresh, credential tests and generated native-config CI gate |
| 23 | This documentation commit | Final verification, operational instructions and explicit manual acceptance gates |

Every step is documented in [the work log](person2-work-log.md).

## Final verification

Ran a clean `npm ci` under Node **22.23.3**, then:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run check:native-config` | Passed: generated microphone/speech/location/exact-alarm declarations and SecureStore plugin |
| Mobile regression suite | **87 passed**, five HTTP cases intentionally skipped here |
| `npm run test:backend` | **5 passed**, authenticated real HTTP requests to isolated SQLite server |
| `expo export --platform all` via installed CLI | Web, iOS and Android passed |
| Full offline backend suite | **693 passed, 2 live tests deselected**; Python 3.12.13 |
| `uv sync --locked --dev` | Passed |
| Online Expo dependency compatibility check | Passed |
| CI's `npm audit --audit-level=critical` | Passed critical gate; **23 high + 17 moderate** still present |

The smoke harness enables server authentication, registers private devices and verifies
unauthenticated refusal plus cross-device read/delete isolation. It uses temporary data,
mock parsing and blank model credentials, and shuts down its server afterward. Tests
for encrypted native storage mock the native vault; they do not prove actual phone storage.

The original hosted CI run for `63ccae6` passed. This follow-up workflow has only been
validated locally until the branch is pushed; no new hosted success is claimed.

## Connected-mode setup

1. Set `EXPO_PUBLIC_USE_MOCKS=false`, the desired HTTPS backend URL and a **blank**
   `EXPO_PUBLIC_API_KEY`. Restart Expo after environment changes.
2. Rebuild the native development client because SecureStore/native permissions were
   added. Confirm app identifiers before distribution. Do not reuse an old client binary.
3. The first real request registers `/devices`; later requests restore the token.
   Native credentials use device-only encrypted storage accessible after first unlock
   so opted-in background tasks can authenticate. Browser tokens are session-scoped,
   not an encrypted vault or cross-browser account. A new session can create a new owner.
4. A 401 preserves credentials and explains the failure. Do not clear storage to
   "fix" it: a new identity cannot recover old reminders. Contact the backend operator.
5. The explicit legacy shared-key option is for controlled compatibility/testing only:
   all key holders share data and deletion access, and bundled values are not secret.

## Delivery semantics and limits

- Android exact alarms require explicit user approval on relevant OS versions. The
  app checks actual access; denied access retains best-effort scheduling with a warning.
  Check timing/reconcile again after returning from settings. Native OS restrictions
  can still affect presentation/delivery even with permission.
- Quiet-hours alerts deliver an already evaluated reminder at `quietUntil`, using
  wording that does not assert the user is still nearby. Completion, deletion, edits,
  snooze and opt-out cancel pending schedules once processed locally. The reserved
  cooldown prevents a second immediate alert around scheduled delivery.
- Places discovery depends on OpenStreetMap data and bounded 500 m queries, 1000
  provider elements and nearest-100 output. Supporting named UPS-style destinations
  does not guarantee every real business is in the provider's database.
- Speech-service audio may be processed remotely; the backend receives text only.
  Raw recordings are not persisted by the app. Native push-to-talk is the optional
  wake-word fallback allowed by the plan; continuous-listening sessions are not a
  newly implemented mobile feature in this follow-up.

## Remaining acceptance/release gates

1. **Native builds and device matrix:** full Xcode/Android SDK and phones were not
   available here. Execute [the validation record](person2-device-validation.md),
   including app restart, permissions, exact/approximate delivery, geofences, locked
   device/background/force-quit, quiet-hours cancellation, real email composer and errors.
2. **Battery and request counts:** measure real baseline/foreground/background use;
   do not infer battery performance from configured update intervals.
3. **Browser end-to-end UI smoke:** component/policy/API checks and a web export are
   not an actual browser click-through. Execute the runbook flows.
4. **Live model quality:** paid tests were excluded; validate representative parser
   and email commands intentionally before a live demo. No accuracy percentage is claimed.
5. **Security:** unforced updates did not clear the 40 findings. A compatible Expo/RN
   remediation or SDK migration with native retesting remains release work; audit's
   forced Expo 44 downgrade was not applied. No clean production-security claim.
6. **Demo:** configure real test places and mail address; record the runbook's 60–90 s
   walkthrough only after device acceptance. No demo recording was created here.

These are real remaining gates, not completed checkboxes. Code/automated checks pass;
the full plan's real-world definition of done is not yet proven.
