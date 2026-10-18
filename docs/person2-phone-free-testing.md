# Try Heedly without installing it on your phone

All commands below use local test data. Do not point destructive test flows at the
hosted backend. The phone-free work was developed on `person2/reliability-integration`
and is being integrated into `main` at the owner's request; backend implementation
and hosted data were not modified.

Cleanup update: the owner requested that test windows be closed and downloads removed.
The preview/API/Metro servers and emulator are stopped. The newly installed Android
command-line tools, SDK, virtual device, Chromium revision 1248/FFmpeg revision 1013,
test Node 22 download, new Gradle 8.14.3/JDK/build caches, generated Android project
and disposable browser databases/exports were deleted. Older Chromium 1243, FFmpeg
1011, Gradle 9.3.0, system Java and application dependencies were preserved.
The results below remain historical evidence; repeating the tests requires reinstalling
their tools. These generated/downloaded files can be recreated, not restored from Git.

## Browser: easiest interactive preview

```bash
cd mobile
npm ci
npm run preview:isolated
```

Open the `Isolated browser preview:` URL printed by the command. It starts its own
temporary authenticated backend/database and static web export. Leave that terminal
running; Ctrl+C stops the servers. The database/export remain in the printed temporary
directory for inspection, not in your normal backend database.

This uses **mock model parsing**, not the paid live model. The backend's mock parser
can return a fixed one-hour deadline; review/edit dates before saving. Browser UI
can test text reminders and email drafts, but cannot deliver native notifications.
Browser tokens are tab-session scoped: a new browser session can have a new identity.

## Repeatable browser acceptance

```bash
node node_modules/@playwright/test/cli.js install chromium
npm run test:browser
```

Five actual Chromium tests cover review/edit/save/reload/snooze/complete/delete,
private identities in separate contexts, editable/cancellable email, network failure
and retry, and explicit unsupported native-notification behavior. Tests block external
browser traffic, create no hosted devices and make no paid model calls.

The harness exports with `--clear` and asserts a registered device identity. A reused
Expo transform cache initially served demo mode; it must not produce a fake pass.
When changing public environment values for your own sessions, restart Expo with
`--clear` as well. HTML reports are in `mobile/playwright-report`; failed traces and
screenshots are in `mobile/test-results/browser`. Both are ignored by Git.

## Android emulator setup used for validation (now removed)

The local setup used:

- Android command-line tools installed through Homebrew.
- SDK at `/Users/naren/Library/Android/sdk`: API 36, build tools 36/35, NDK 27.1,
  CMake 3.22.1, platform tools, emulator and API 35 Google APIs ARM64 image.
- A dedicated Pixel 7 AVD named `heedly_test_api35`; existing devices were not overwritten.
- Test-only package `com.contextassistant.emulatortest`, enabled by
  `PERSON2_EMULATOR_TEST=true` in `app.config.ts`. Distribution IDs remain an owner choice.
- About 8 GB SDK plus 2 GB virtual-device data at setup time, outside the repository.
  These are persistent local tools, not files copied to your phone.

Homebrew's AVD manager used its own SDK root despite standard SDK variables.
Links expose the standard SDK's system image/emulator under
`/opt/homebrew/share/android-commandlinetools`; command-line tools are also linked
under the standard SDK. No second image download was needed.

The first native APK compiled but failed at runtime: an SDK 57 `expo-asset` peer was
autolinked into SDK 54 (`AnyTypeCache` class missing). Pinning root `expo-asset` to
SDK 54's `~12.0.13` fixed it. The native-config gate now checks this resolved module,
not just permission configuration. Keep this pin when refreshing the lockfile.

## Repeat the native test safely

1. Start `npm run preview:isolated`. Note the printed emulator API address
   (`http://10.0.2.2:<port>`), which reaches the Mac's disposable backend.
2. Boot `heedly_test_api35` using the installed emulator. To interact visually, omit
   `-no-window`; headless testing uses `-no-window -no-audio`. No host mic is needed.
3. Generate Android files with `PERSON2_EMULATOR_TEST=true EXPO_NO_DOTENV=1` and
   `expo prebuild --platform android --no-install`. Keep those flags for the build
   and bundler; do not silently change your production app's identifiers.
4. Build `:app:assembleDebug -PreactNativeArchitectures=arm64-v8a` from `mobile/android`
   with `ANDROID_HOME` set to the SDK path. Set `NODE_ENV=development` and
   `EXPO_NO_DOTENV=1`. Generated native files and APKs are ignored by Git.
5. Install `mobile/android/app/build/outputs/apk/debug/app-debug.apk` with
   `adb -s emulator-5554 install -r ...`; never omit the explicit emulator serial.
6. Start Expo with mock **mobile mode off**, the printed emulator API address,
   blank shared key and the test-only package flag:

   ```bash
   PERSON2_EMULATOR_TEST=true EXPO_NO_DOTENV=1 EXPO_PUBLIC_USE_MOCKS=false \
   EXPO_PUBLIC_API_URL=http://10.0.2.2:REPLACE_WITH_PRINTED_PORT EXPO_PUBLIC_API_KEY= \
   npm start -- --localhost --clear --port 8081
   ```

7. Forward Metro with `adb -s emulator-5554 reverse tcp:8081 tcp:8081`, then open the
   development-client link printed by Expo. Dismiss its first-run welcome overlay.
8. Run `npm run test:emulator`. It refuses physical-device serials and verifies
   `ro.kernel.qemu=1`. It only grants special alarm access to the disposable test
   package. It checks native startup, notification permission/timing status,
   text-to-confirm/save, actual timed background delivery and restart persistence.

For a faster repeat after a full timing check, use
`PERSON2_TIMER_SECONDS=30 npm run test:emulator`; the accepted range is 30–180 seconds
and the default remains 120. `--check-restart` on the underlying script diagnoses
restart persistence using an existing test reminder. Development-menu onboarding
is dismissed by the harness, and Metro port forwarding is restored at each launch.

The script explicitly edits the confirmation deadline (two minutes by default) because mock
parsing is not a language-quality test. It does not claim that live natural-language
date parsing was verified. Screenshots are in `mobile/test-results/emulator`.

## Recorded results — October 18, 2026

- Five connected Chromium scenarios passed, including a final run under Node 22.23.3.
- The real Android debug APK built successfully and launched after the SDK-matched
  asset fix. Native text/parse/review/save and permission/timing checks passed.
- A reviewed 120-second notification posted while the app was backgrounded, 112 seconds
  after backgrounding. Native identity/reminder persistence passed after force-stop/restart.
- A final complete short retest used a reviewed 30-second deadline: notification posted
  23 seconds after backgrounding, and the same run passed restart persistence (exit 0).
- The test harness now handles developer onboarding, restores Metro forwarding after
  bridge reconnects and tolerates Android's partial notification dumps (exit 255) only
  for that specific diagnostic. Other ADB errors remain failures.
- Screenshot evidence is in `mobile/test-results/emulator/native-reminder.png`,
  `delivered-notification.png` and `restart-persistence.png`; browser HTML report is
  in `mobile/playwright-report`. All contain disposable test data, not hosted records.
- 87 unit tests, TypeScript and the generated native/asset compatibility guard passed.
- Added the connected Chromium suite as a third CI job. No branch push or new hosted
  workflow run was performed, so this is local evidence for the new revision.

## Still needs physical/device-specific verification

Android emulation is not iPhone testing. Real speech-service behavior, actual GPS
travel/geofence entry, force-quit/vendor power restrictions, mail-app integration,
quiet-hours delivery on hardware and battery measurements remain open. Live model
quality and the existing dependency advisories also remain release gates.

See the [device validation record](person2-device-validation.md). Emulator results
must not be copied into its physical-device "passed" column.
