# Test-writing agent (Task 2)

## What it does

`generate-tests.mjs` reads one real source file from the app under test,
sends its exact contents to Claude via the `claude` CLI in headless mode
(`claude -p --output-format json`), and asks it to generate Playwright tests
for that file's real exported functions. Model/tooling used: whatever your
`claude` CLI resolves to by default in your environment (no separate API key
needed) -- in this run that was **Claude Sonnet 5** for the generation call
(a small Haiku 4.5 call also appears in the usage report; that's Claude
Code's own internal routing, not something this script asked for).

The model never gets tool access (`--allowedTools none`) -- the full source
is already inlined in the prompt, so there's no legitimate reason for it to
go read files, and disabling tools keeps the call a deterministic, auditable
text completion instead of an open-ended agentic session.

## Keeping it honest: the grounding check

The prompt *tells* the model to only test real functions and to never write
placeholder assertions. Prompts get ignored under pressure, so
`groundingCheck()` in `generate-tests.mjs` re-verifies this mechanically,
with no LLM involved, before anything is written to `tests/generated/`:

1. **No hallucinated imports.** Every name the generated file imports from
   the source module must actually be exported by that file (checked via a
   regex over the real source, not trusted from the model's claim).
2. **Real breadth.** At least 3 distinct real functions must be exercised --
   rules out a "test" that only touches one trivial getter.
3. **Enough tests, enough assertions.** At least 5 `test()` blocks, and at
   least as many `expect()` calls as test blocks -- rules out tests that run
   but assert nothing.
4. **No known placeholder patterns.** Rejects `expect(true).toBe(true)`,
   `expect(1).toBe(1)`, `.skip(`, `.only(`, `TODO`.

If any check fails, the raw output is saved to `agent/output/*.REJECTED.ts`
for inspection (not deleted -- so a human can see exactly what the model
produced and why it was rejected) and the script exits non-zero. Nothing
bad reaches `tests/generated/`.

Run `node agent/demo-grounding-check.mjs` to see this gate actually catch
three deliberately bad fake outputs (a hallucinated function name, an
`assert(true)`-style boilerplate test, and a test with no import from the
source at all) while passing the real generated file -- this is a
verification of the gate itself, not of the agent's output.

## Running it

```bash
# from tester-repo/, with app/ checked out as a sibling directory
node agent/generate-tests.mjs --file ../app/src/utils/transactionUtils.ts --out transactionUtils.spec.ts
```

This reads the file, calls Claude, runs the grounding check, writes
`tests/generated/transactionUtils.spec.ts` plus a report to
`agent/output/transactionUtils.spec.report.json`, then (by default) runs the
generated test immediately via `npx playwright test tests/generated/transactionUtils.spec.ts --project=generated`
to close the loop. Pass `--no-run` to skip the auto-run.

## What we ran it on, and why

Target: [`app/src/utils/transactionUtils.ts`](../../app/src/utils/transactionUtils.ts) --
a pure-function utility module with real business logic (money math via
`dinero.js`, pagination, timezone-aware date boundaries, notification/query
shape discrimination). Chosen over a route handler because:

- It's pure and dependency-injectable, so "close the loop" means actually
  running real logic, not mocking an HTTP layer.
- It has genuine edge cases (insufficient funds, empty pages, missing query
  fields, midnight boundaries) that a generic/boilerplate test generator
  would very plausibly miss or fake.
- Grounding is easy to verify mechanically (see above) because it's a
  small, self-contained set of named exports.

The actual generated output for this run is committed at
[`tests/generated/transactionUtils.spec.ts`](../tests/generated/transactionUtils.spec.ts)
and passed all 17 of its own tests on first execution (see
`agent/output/transactionUtils.spec.report.json`).

## Honest limits

- The grounding check is syntactic, not semantic -- it can't tell you the
  *expected value* in a test is mathematically correct, only that the test
  calls a real function and asserts something non-trivial. A model could
  still compute a wrong expected value confidently. Human review before
  merge (see the root README's PR template) is still required.
- It only targets pure, importable functions well. Testing a React component
  or an Express route this way would need a different generation strategy
  (component harness / supertest-style request), which this script doesn't
  attempt.
- Every run costs real tokens (see `costUSD` in the report JSON) -- fine for
  one file on demand, not something you'd want firing on every commit
  unsupervised.
