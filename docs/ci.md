# Continuous integration

`.github/workflows/ci.yml` runs on branch pushes, pull requests and manual dispatch.
No deployments, paid API calls or native signing credentials are needed. The two
jobs run in parallel on Ubuntu, with read-only repository permission, checkout
credentials disabled, dependency caches, timeouts and cancellation of older runs.

## Checks

| GitHub check | Commands and coverage |
| --- | --- |
| Mobile checks and platform exports | `npm ci`, TypeScript, mobile regression tests, Expo web/iOS/Android JS/Hermes exports |
| API integration and backend contracts | `uv sync --locked --dev`, full offline backend suite including device/security tests, authenticated isolated real HTTP mobile-client integration |

Node 22 and Python 3.12 are used; uv is pinned to 0.11.7. Both package lockfiles
are enforced. The backend smoke harness creates its own temporary SQLite database
and shuts down its server afterward. Paid parser credentials are blank, parsing is
mocked and backend pytest excludes live tests. The default mobile suite intentionally
skips five HTTP integration cases; the integration job runs those separately, including
device registration, unauthenticated refusal and cross-device data isolation. SQLite
has authentication enabled in the harness, rather than relying on local open access.

JUnit reports are uploaded even when tests fail. Successful platform exports are
uploaded separately. Artifacts expire after seven days. No temporary database,
credentials or `.env` files are uploaded.

## Activation and merge protection

Push this feature branch to GitHub to trigger the first run. This local change alone
does not create a hosted run. Manual dispatch is available after the workflow exists
on the default branch. GitHub may require approval for first-time/fork contributions.

Once checks have run, a repository administrator can require both check names in
the main-branch ruleset/branch protection. Adding the workflow does not itself enable
merge protection, and this task does not change repository settings or merge to main.

## Limits

Platform exports are not native builds or device tests. CI does not verify actual
microphone permissions, notification delivery, geofence entry, background/force-quit
behavior, mail composer or battery usage. Follow the Person 2 runbook's device matrix.
Dependency audit gates critical advisories and saves JSON in the mobile test artifact.
High/moderate advisories still require review before public release; this is not a
claim of a clean audit. No new Person 1 implementation was added.

## Original local validation (step 15; superseded by reliability handoff)

Before handoff, the workflow YAML parsed without errors and its triggers, jobs and
read-only permission were checked. `npm ci`, TypeScript, all 54 mobile tests, Expo
web/iOS/Android exports and all four isolated HTTP tests passed under Node 22.23.3.
The export step invokes the installed Expo CLI directly, avoiding nested npm/npx
configuration in the local Node-version harness. Both JUnit reports were generated
and confirmed ignored by Git. Locked uv sync and the 124 selected backend tests
passed in the existing local Python environment (3.12.13), matching the hosted CI
Python 3.12 target.

The original workflow's hosted run at main `63ccae6` passed on October 17, 2026.
The expanded workflow on `person2/reliability-integration` requires a new branch push
to run on GitHub. See the [current handoff](person2-reliability-handoff.md) for local
verification of this revision. Branch protection was not modified.

## Action references

Action configuration was checked against the primary documentation for
[checkout](https://github.com/actions/checkout),
[setup-node](https://github.com/actions/setup-node),
[setup-uv](https://github.com/astral-sh/setup-uv) and
[upload-artifact](https://github.com/actions/upload-artifact).
