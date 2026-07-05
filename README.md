# tester-repo

Central test suite for [cypress-realworld-app](https://github.com/cypress-io/cypress-realworld-app)
(a full-stack TypeScript banking app: React/Vite frontend + Express backend, one repo
playing the role of "separate FE/BE repos" for this exercise). This repo lives
independently of the app and is the thing that gates its PRs.

## What's here

```
tests/
  api/          real API tests against the Express backend (session auth)
  e2e/          real browser tests against the React frontend
  generated/    output of the test-writing agent (agent/) -- see agent/README.md
agent/          the test-writing agent (Task 2)
docs/           example of the CI change an FE/BE repo would add to be gated by this repo
.github/
  workflows/ci.yml       CI that runs this whole suite against a live instance of the app
  CODEOWNERS             who must review changes to tests/ and agent/
  PULL_REQUEST_TEMPLATE.md
```

## Running locally

Requires Node 22+ (the app's own `package.json` pins `engines.node: "^22.0.0 || ^24.0.0"`
and enforces it during install) and Yarn (`npm install -g yarn` if you don't have it).

```bash
# 1. Start the app under test (in a sibling `app/` checkout of cypress-realworld-app)
cd app && yarn install && yarn start   # serves frontend :3000, backend :3001

# 2. In another terminal, install and run the suite
cd tester-repo
npm install
npx playwright install --with-deps chromium
npm test                # all projects: api, e2e, generated
npm run test:api        # just the API tests
npm run test:e2e        # just the E2E test
npm run test:generated  # just the agent's output
```

Seeded test credentials (`Heath93` / `s3cret`) come from the app's own committed
`data/database-seed.json`, loaded verbatim on `prestart` -- no fixture setup needed.

## The tests (Task 1)

- `tests/api/auth.spec.ts` -- 3 tests against `POST /login` / `GET /checkAuth`
  (`backend/auth.ts`): correct credentials return the user profile, wrong
  password returns 401 with no session established, unknown username returns 401.
- `tests/e2e/login.spec.ts` -- 2 browser tests against the real `SignInForm`
  component: successful sign-in reaches the authenticated nav chrome, a failed
  sign-in shows the inline error and stays on `/signin`.

All 5 pass against a live instance of the app (verified locally; CI runs the same suite).

## CI

`.github/workflows/ci.yml`: checks out this repo and the app repo side by side,
installs both, boots the app (`yarn start`), waits for ports 3000/3001, then
runs `npm test`. Report is uploaded as an artifact. This is the same status
check an app-repo PR would depend on (see below).

## Gating sketch (Task 1)

The team's actual workflow: FE and BE repos ship fast; this repo is the shared
gate. Concretely:

1. **Required status check.** The app repo's own PR workflow adds a job that
   checks out this tester-repo alongside the PR's code and runs `npm test`
   against it (see `docs/app-repo-gating-example.yml` for the exact YAML).
   Branch protection on the app repo's default branch marks that job
   (`tester-repo-suite`) as a **required status check** -- PRs can't merge
   until it's green.
2. **Review ownership.** `.github/CODEOWNERS` in this repo requires the
   automation engineer's sign-off on anything touching `tests/`, `agent/`, or
   the CI workflow itself, so test changes (new cases, deletions, threshold
   changes) don't slip in unreviewed inside an unrelated feature PR.
3. **PR template.** `.github/PULL_REQUEST_TEMPLATE.md` forces the author to
   say whether a test was hand-written or agent-generated, and to confirm
   they actually ran it and it fails when the underlying feature breaks --
   the cheapest defense against a merged test that asserts nothing.
4. **Failure ownership.** A failing required check blocks the app-repo PR, not
   this repo's history -- the app-repo author sees the failure on their own
   PR and either fixes their change or pings the automation engineer if they
   believe the test itself is wrong. The automation engineer, via CODEOWNERS,
   is the one who approves changing/removing a test in response.

This intentionally stops short of wiring an actual webhook/repository_dispatch
between two live GitHub orgs -- the mechanism (required check + CODEOWNERS +
PR template) is what a small team would really run, and `docs/app-repo-gating-example.yml`
shows the literal CI diff you'd land in the app repo to turn it on.

## Task 2 -- the test-writing agent

See [`agent/README.md`](agent/README.md) for how it works, how to run it, and
its generated output for `src/utils/transactionUtils.ts`.

## Writeup

See [`WRITEUP.md`](WRITEUP.md).
