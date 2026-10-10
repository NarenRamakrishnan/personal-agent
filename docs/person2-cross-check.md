# Person 2 cross-check

## Scope and result

Checked the mobile implementation against the two-person plan and the existing
runbook, reviewed asynchronous lifecycle paths, added regression tests and reran
the checks below. Work remains on `person2/mobile-completion`; no changes were made
to Person 1 backend source, no push/merge was performed, and main was not committed to.

This is a code/automated-test cross-check, not proof that every phone scenario works.
The runbook's day-by-day matrix remains the authoritative hardware checklist.

## Steps and evidence

1. Reviewed speech events, navigation focus, microphone ownership, permission awaits,
   background/unmount cleanup and deadline/snooze policy. Fixed cancellation races,
   unrelated speech delivery and incorrect effective notification dates. Step 11:
   commit `a7ef271`; nine new regression cases.
2. Reviewed location freshness, evaluator waits, reminder changes, persisted cooldown,
   consent revocation and native task shutdown. Suppressed stale decisions and GPS,
   prevented permission completion from undoing opt-out, and attempted both native
   cleanup operations even if one failed. Step 12: commit `463508d`; 13 new cases.
3. Reran the mobile suite: **54 passed**, four isolated integration tests intentionally
   skipped by the default command. React component tests use mocked native services;
   they verify component logic, not real microphone hardware.
4. Reran `npm run test:backend`: **4 passed**, using the actual mobile API client and
   a local server with an isolated temporary database, no paid LLM calls and no
   developer data. Server stopped automatically afterward.
5. Reran the existing backend contract/reminder/action/places suites: **124 passed**.
   These are selected relevant backend suites, not the entire backend test collection.
6. Reran TypeScript: passed. Reran Expo exports after the final code fixes: web,
   iOS and Android passed. These check JS/Hermes bundles, not native compilation.
7. Checked whitespace and backend diff from pulled base `5b8cb02`: clean/no backend
   source changes. Confirmed the feature branch. Updated runbook results and this
   evidence document in the final documentation commit (step 13).

## Not yet verified / release caveats

- Native compilation and device tests. `xcodebuild -version` reports only Command
  Line Tools, not full Xcode. No iOS/Android hardware test was performed here.
- Actual speech permissions/service failures, two-minute notification delivery and
  actions, live nearby-place quality, geofence entry, background/force-quit behavior,
  mail composer behavior and battery measurements. Execute runbook section 8.
- Always-listening wake-word detection is not implemented; manual push-to-talk is
  the documented fallback. Demo instructions exist; the video has not been recorded.
- Browser/phone end-to-end UI smoke testing remains outstanding; automated component,
  policy and API checks are not a substitute for executing every screen flow.
- Dependency audit remains non-clean: 23 high and 17 moderate advisories, no critical
  advisories, in the pinned toolchain. Requires compatible remediation before public
  release, not a blind forced downgrade/major upgrade.

No claim is made that automated tests exhaust all races or OS behavior. Code checks
pass; full plan completion still depends on the device matrix and release caveats.
