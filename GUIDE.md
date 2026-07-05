# Project guide

A single top-to-bottom walkthrough of this repo: what it is, how to run every
piece of it, how it's built, and the real debugging trail that got CI to
green. `README.md` is the quick-start; this is the long version.

For a screenshot-driven visual walkthrough of all of this actually running,
open [`docs/pipeline-demo.html`](docs/pipeline-demo.html) in a browser.

---

## 1. What this is

A central **tester-repo** for [cypress-realworld-app](https://github.com/cypress-io/cypress-realworld-app)
(RWA) -- a full-stack TypeScript banking demo app (React/Vite frontend +
Express backend, session auth, real money/transaction logic) standing in for
"the FE/BE repos" a fast-moving team ships to. This repo:

- **Task 1** -- holds a small, real Playwright test suite (API + E2E) that
  gates the app's PRs, plus a CI workflow and a gating sketch (CODEOWNERS, PR
  template, required-status-check pattern).
- **Task 2** -- ships a test-writing agent that reads one real source file
  from the app and generates Playwright tests for it, gated by a mechanical
  "honesty check" that rejects hallucinated functions and vacuous assertions
  before anything is trusted.

Everything below is either code in this repo or something I ran and observed
directly -- nothing here is a hypothetical description of what *would*
happen.

## 2. Repo layout

```
tests/
  api/auth.spec.ts            3 API tests against the live backend
  e2e/login.spec.ts           2 browser tests against the live frontend
  generated/                  agent output (transactionUtils.spec.ts + report)
agent/
  generate-tests.mjs          the test-writing agent
  demo-grounding-check.mjs    proves the honesty gate rejects bad output
  output/                     per-run reports (model usage, grounding result)
  README.md                   agent-specific docs
docs/
  app-repo-gating-example.yml example CI diff for the app repo's own PRs
  pipeline-demo.html           screenshot walkthrough of the whole thing running
.github/
  workflows/ci.yml            CI: boots the app, runs the whole suite
  CODEOWNERS                   who must review tests/, agent/, workflows/
  PULL_REQUEST_TEMPLATE.md
README.md                      quick start
WRITEUP.md                     the half-page writeup (app choice, trade-offs, next steps)
GUIDE.md                       this file
```

## 3. Quick start

```bash
# Node 22+ required (see section 6 -- the app enforces this itself)
# Terminal 1: the app under test, checked out as a sibling dir named app/
cd app
yarn install
yarn start                # frontend :3000, backend :3001

# Terminal 2: this repo
cd tester-repo
npm install
npx playwright install --with-deps chromium
npm test                  # runs api + e2e + generated projects together
```

Seeded login: `Heath93` / `s3cret` (from the app's own committed
`data/database-seed.json`, loaded verbatim -- not a fixture I invented).

## 4. Task 1 — the gating suite

| File | What it actually checks |
|---|---|
| `tests/api/auth.spec.ts` | `POST /login` returns the user profile on correct creds; wrong password returns 401 *and* leaves no session (`GET /checkAuth` still 401 after); unknown username returns 401. |
| `tests/e2e/login.spec.ts` | A real browser drives `SignInForm` via the app's own `data-test` attributes; successful sign-in reaches the authenticated nav (`nav-top-new-transaction` visible); a failed sign-in shows the inline error and never leaves `/signin`. |

Both hit a **live instance** of the app -- no mocked HTTP layer, no stubbed
DOM. Run `npm run test:api` or `npm run test:e2e` to run them in isolation.

### Gating sketch

The mechanism a small team would actually run, not a wired-up webhook demo:

1. **Required status check** -- the app repo's own PR workflow checks out
   this tester-repo alongside the PR and runs `npm test` against it. See
   `docs/app-repo-gating-example.yml` for the literal YAML you'd add.
   Branch protection marks that job as required before merge.
2. **CODEOWNERS** (`.github/CODEOWNERS`) -- changes to `tests/`, `agent/`, or
   the CI workflow require the automation engineer's review, so test
   deletions/threshold changes can't hide inside an unrelated feature PR.
3. **PR template** (`.github/PULL_REQUEST_TEMPLATE.md`) -- forces the author
   to say whether a test is hand-written or agent-generated and to confirm
   they actually ran it and watched it fail against a broken version of the
   feature -- the cheapest defense against a test that asserts nothing.
4. **Failure ownership** -- a failing required check blocks the *app repo's*
   PR, not this repo. The app-repo author fixes their change or escalates to
   the automation engineer if they think the test itself is wrong.

## 5. Task 2 — the test-writing agent

Full detail in [`agent/README.md`](agent/README.md); summary here.

**How it works:** `agent/generate-tests.mjs` reads a real source file,
inlines its exact contents into a prompt, and calls `claude -p --output-format json --allowedTools none`
(the Claude Code CLI in headless mode -- no separate API key, no tool access,
so the response is a deterministic text completion grounded only in what was
actually in the prompt).

**Keeping it honest:** before anything reaches `tests/generated/`, a
mechanical `groundingCheck()` (no LLM involved) verifies:
- every imported function name is genuinely exported by the source file (no
  hallucinated APIs),
- at least 3 distinct real functions are exercised,
- at least 5 `test()` blocks and at least as many `expect()` calls,
- none of the known placeholder patterns appear (`expect(true).toBe(true)`,
  `.skip(`, `.only(`, `TODO`).

Run `node agent/demo-grounding-check.mjs` to see this gate actually reject
three deliberately bad fake outputs (hallucinated function, assert-true
boilerplate, no import at all) while passing the real generated file --
proof the gate works, not just a claim that it would.

**What it ran on:** `app/src/utils/transactionUtils.ts` -- pagination math,
`dinero.js` money arithmetic, timezone-aware date boundaries. Chosen because
it's pure and dependency-free (closing the loop means running real logic,
not mocking an HTTP layer) and because its edge cases (insufficient funds,
empty pages, missing query fields) are exactly what a generic/boilerplate
generator would plausibly fake or miss. Output:
[`tests/generated/transactionUtils.spec.ts`](tests/generated/transactionUtils.spec.ts) --
17 tests, all passing on execution.

```bash
node agent/generate-tests.mjs --file ../app/src/utils/transactionUtils.ts --out transactionUtils.spec.ts
```

## 6. CI, and the actual debugging trail to get it green

`.github/workflows/ci.yml` checks out this repo and the app side by side,
installs both, boots the app, waits for it to be reachable, then runs
`npm test`. Verified green: [run #9, 2m 25s](https://github.com/sriramworkm2p-cell/Tester-repo/actions/runs/28736030972).

It didn't work on the first push. Recording the actual failures here because
they're a more honest picture of "does this suite hold up" than a suite that
happened to work the first time:

1. **`yarn: command not found`.** The app's own scripts (`prestart`,
   `start`) shell out to `yarn` internally via `concurrently yarn:script`.
   Fix: `corepack enable` before installing anything.
2. **`yarn install --frozen-lockfile` failed.** Root cause turned out to be
   unrelated to the lockfile itself (see #4) -- switched to
   `npm install --legacy-peer-deps`, which installs the same runtime tree.
3. **Cypress's postinstall binary download** is a common source of CI
   flakiness for a repo that bundles Cypress; set `CYPRESS_INSTALL_BINARY=0`
   since we test via Playwright, not the app's own Cypress suite.
4. **The real, load-bearing bug:** the app's `package.json` pins
   `"engines": { "node": "^22.0.0 || ^24.0.0" }`, and a dependency's
   postinstall script enforces it strictly. CI was pinned to Node 20 (a
   copy-paste default) -- every install failed with an engine-mismatch error
   that had nothing to do with yarn, npm, or Cypress. This is why the two
   fixes above *looked* like progress (different symptoms) without actually
   fixing anything. Bumped to Node 22, later to 24.
5. **`start:ci` doesn't work here.** The app has two ways to serve the
   frontend: plain `start` (vite dev server) and `start:ci` (a custom
   `scripts/testServer.ts` that serves a pre-built `build/` directory and
   skips the DB-seeding prestart hook entirely). `start:ci` failed to
   compile (`TS2769`, an express/history type mismatch) under the dependency
   versions npm resolved -- and even if it had compiled, it never seeds
   `data/database.json`, so the seeded login this suite depends on wouldn't
   exist. Switched to plain `start`, which I'd already verified end-to-end
   locally.
6. **`dinero.js` failed to resolve one internal chunk** ("request for
   `./trimScale-*.js` is from a module not been linked") when the generated
   test imported `transactionUtils.ts` under Node 22, but worked under Node
   24 -- almost certainly a difference in how those two Node versions walk
   `dinero.js`'s conditional `exports` map. Since Node 24 also satisfies the
   app's own engine constraint and is exactly what I'd verified locally,
   that's what CI runs on now.

The throughline: **most of these looked like tooling flakiness but were
actually one root cause (Node 20 vs the app's pinned ^22/^24 requirement)
compounding with one real, separate bug (`start:ci`'s broken test server)**.
Reading the actual failed-step logs (`gh run view <id> --log-failed`) each
time, rather than guessing from the step name, is what turned this from
random flailing into a fix that stuck.

## 7. Honest limits (see WRITEUP.md for the full version)

- The agent's grounding check is syntactic, not semantic -- it can catch a
  hallucinated function name but not a confidently-wrong expected value.
  Human review before merge is still required (see the PR template).
- Task 1's suite covers auth only; a real team would need this pattern
  extended to transactions, bank accounts, and notifications.
- Shared, mutable seed data (one committed `database.json`) is the single
  biggest threat to this suite scaling past a handful of tests -- see
  `WRITEUP.md` for how I'd handle it.
