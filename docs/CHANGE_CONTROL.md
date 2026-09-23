# SLH TMS change control

_Last reviewed: 2026-09-16_

This repository now has a clean live-system baseline. All future amendments should be made against that baseline rather than layering new fixes over retired compatibility code.

## Change principles

1. Keep `main` as the live production baseline.
2. Use scoped branches and pull requests for new features, fixes and cleanup.
3. Do not merge unless CI is green.
4. Do not add browser-wide runtime patches or recovery shims unless a production incident has no safer alternative and a removal issue is created at the same time.
5. Do not auto-promote email-derived orders. Staged order review and authorised planner approval remain mandatory.
6. Do not move authoritative master data away from SQL unless there is a signed-off migration plan.
7. Do not remove compatibility, migration or repair code merely because it contains words such as `legacy`, `fallback` or `recovery`.

## Required checks before merge

- Portal lint.
- Portal typecheck.
- Portal unit tests.
- Portal build.
- Portal E2E workflow test.
- CodeQL.
- No retired runtime patch debt guard.

## Recommended branch protection

GitHub branch protection should be enabled for `main` with:

- require pull request before merging;
- require status checks to pass before merging;
- require branches to be up to date before merging;
- require CodeQL where available;
- block force pushes;
- block branch deletion;
- restrict direct pushes to `main`.

The current connector can read the branch protection state but does not expose a safe administration write for enabling it. Until this is enabled manually, users with write access can bypass the intended PR workflow.

## Baseline reset rule

When planning new work, first identify whether the change affects:

- order intake;
- staged approval;
- planner/runs;
- live tracking/ETA;
- TV wallboard;
- master data;
- authentication;
- deployment.

Then make the smallest scoped change that preserves the live baseline and add regression coverage for the affected route or screen.
