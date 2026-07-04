# Writeup

## What I chose and why

[cypress-realworld-app](https://github.com/cypress-io/cypress-realworld-app) --
a full-stack TypeScript banking app (React/Vite frontend + Express backend,
session auth, real business logic around money and pagination). It runs
entirely locally with `yarn`/`npm`, no Docker or cloud account needed, and its
size meant I could actually read and reason about a target file end-to-end
rather than treat it as a black box -- important for a 1-day exercise where
Medusa/Saleor/ERPNext-scale apps would have burned most of the day on setup
alone. One caveat worth naming: it was built by the Cypress team as a testing
reference app, so it's slightly meta -- but its features (auth, transactions,
bank accounts) are realistic, and it's widely used by Playwright engineers
for exactly this kind of exercise.

## Biggest trade-off

For the agent (Task 2), I pointed it at a pure-function utility module
(`transactionUtils.ts`: money math, pagination, timezone-aware date
boundaries) instead of a live API route or React component. That made
"close the loop" fast and deterministic -- no server, no mocking, just real
logic in, real assertions out -- and let me build a mechanical, syntactic
grounding check (real exports only, no hallucinated names, no vacuous
assertions) that I could actually prove catches bad output. The cost is that
it doesn't demonstrate the harder, arguably more valuable case: generating
tests against stateful HTTP/UI behavior, which is where most real bugs in a
fast-moving app actually live.

## Biggest threat to this suite's reliability

Shared, mutable seed data. Every test in this suite (and the agent's future
targets) reads from one committed `database-seed.json`. As soon as a second
test suite mutates that same user's balance or transaction list, tests that
assume a clean starting state become order-dependent and flaky -- the
classic way a growing suite quietly stops being trustworthy. I'd handle it
by giving each test its own seeded fixture (via the app's `testdata-routes.ts`
seeding endpoints) instead of sharing one global user, and by treating any
newly-flaky test as a required-fix blocker, not a quarantine-and-ignore.

## What I'd build next with more time

Point the agent at a stateful target (a route handler, using supertest-style
request mocking) to prove the grounding-check approach generalizes beyond
pure functions; wire the gating sketch into a real second repo via
`repository_dispatch` instead of documenting the CI diff; and add a
semantic check on top of the syntactic grounding check -- e.g. mutating the
source function slightly and confirming the generated test actually fails,
which would catch a confidently-wrong expected value that today's check
can't see.
