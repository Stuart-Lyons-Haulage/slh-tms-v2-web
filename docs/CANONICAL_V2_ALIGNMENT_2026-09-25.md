# Canonical V2 Web alignment ledger — 25 September 2026

This ledger records how the useful work on `v2/canonical-hardening-2026-09-24` is preserved while consolidating the portal onto `main`.

## Canonical rules

- `main` remains the only deployable Web line after cleanup.
- The API contract is `/api/v1`.
- Microsoft Entra remains the office-user authentication path.
- The local standalone runtime remains supported.
- Current main navigation, AdminHub, Timesheets and Samsara dispatch work must not be replaced by older hardening-branch equivalents.

## Hardening branch reconciliation

| Commit | Change | Canonical treatment |
| --- | --- | --- |
| `4189a106c0` | Show Graph mailbox health in portal | Ported to `src/lib/intelligenceApi.ts` and its freshness tests using `/api/v1/health/intake`. |
| `3301162df6` | Restore V2 admin navigation | Superseded by the newer main AdminHub/navigation implementation. |
| `bed614e27b` | Expose Graph intake and integration status | Ported: Graph health/poll methods use `/api/v1`; integration typing aligns with one visible RoadTech source. |
| `d814e938e1` | Show Order Review readiness and route details | Ported into the current main staging/order-review layout without replacing newer UI. |
| `6bad2e00e1` | Keep staging screen focused on order intake | Already represented by `/staging -> <StagingQueue ordersOnly />`; retained and enhanced. |
| `96e36b9070` | Improve review popup and approval feedback | Ported: modal review, source email/attachment drawer and explicit approval/rejection feedback. |

## Local-auth hardening branch

`v2/local-auth-hardening` is not merged wholesale because local username/password auth is retired in favour of Entra. Before that branch is deleted, its non-auth operational changes (standalone/backup/CI/E2E fixes) must be checked against main and either confirmed present or selectively ported.

## Deletion gate

Only after Web CI passes and the cleanup is merged:
1. retire `v2/canonical-hardening-2026-09-24`;
2. finish the non-auth audit of `v2/local-auth-hardening` before retiring it;
3. remove/rename old local checkouts only after verifying they contain no uncommitted work;
4. keep Docker build context pointed only at `~/Desktop/SLH TMS/Repositories/Web`.
