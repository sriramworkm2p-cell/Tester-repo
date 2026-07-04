## What changed and why

<!-- Which app feature/PR is this test change for? Link it. -->

## Test provenance

- [ ] Hand-written
- [ ] Agent-generated (`agent/generate-tests.mjs`) and reviewed by a human before merge
- [ ] Agent-generated and modified after review

## Checklist

- [ ] I ran the affected test(s) locally against a running instance of the app and confirmed they pass for the right reason (not a vacuous assertion).
- [ ] If this test is new, it fails when the feature it covers is reverted/broken (checked manually or via a throwaway local change).
- [ ] No test in this PR depends on execution order or leftover state from another test.
- [ ] CI is green on this PR.

## Reviewer note (automation engineer)

This PR is gated by CODEOWNERS review (see `.github/CODEOWNERS`) before merge.
