# SLH TMS live system baseline

_Last reviewed: 2026-09-16_

This document defines the clean baseline for the live SLH TMS portal. Future changes should be assessed against this baseline before adding new runtime paths, compatibility layers or operational flows.

## Active repositories

The live system is intentionally split across two GitHub repositories only:

- `Stuart-Lyons-Haulage/slh-tms-web` — React/TypeScript portal and physical TV frontend assets.
- `Stuart-Lyons-Haulage/slh-tms-api` — .NET 8 API, jobs, SQL migrations, Power Automate contracts and integration services.

There are no separate legacy TMS repositories in the organisation baseline.

## Live production endpoints

- Portal: `https://slh-tms-portal-prod.gentlepond-08dba66b.uksouth.azurecontainerapps.io/`
- API: `https://slh-tms-api-prod.gentlepond-08dba66b.uksouth.azurecontainerapps.io`

The portal proxies API traffic through `/tms-api/` in `nginx.conf`.

## Active frontend runtime

The active web runtime is the Vite/React app loaded from `index.html` and the compiled `/assets/` bundle.

Active operational surfaces include:

- Order Review / staged email intake review.
- Planner / Run Planner Live.
- Live Runs / Operations Wallboard.
- Physical TV wallboard.
- Master-data lookup and verification views.
- Admin / integration sync controls.

## Order Review baseline

Order Review must consume the paged staging queue API directly and must not use browser-wide fetch interception or recovery shims.

The clean contract is:

```text
/api/v1/staging/queue?status=PendingReview&entityType=order&planningDate=<yyyy-mm-dd>&page=<n>&pageSize=100
```

The API owns planning-date filtering. The browser should not infer the selected planning date from an arbitrary first page of pending records.

Email-derived orders must remain staged until an authorised planner approves them. The portal must not auto-create live orders from inbound email intake.

## Active TV baseline

The current TV baseline is the v4 wallboard runtime:

- `public/tv-wallboard-v4.js`
- `public/tv-wallboard-v2.css`
- `public/tv.html`

These are retained because they are actively referenced by the portal bootstrap, physical TV page and parity tests.

## Retired frontend runtime assets

The following retired runtime assets were removed during the clean-baseline health reset and must not be reintroduced:

- `src/orderReviewRecovery.ts`
- `src/orderReviewRecovery.test.ts`
- `public/tv-legacy.js`
- `public/tv-legacy.css`
- `public/tv-legacy-compact.css`
- `public/tv-final-timing-patch.js`
- `public/tv-run-labels-patch.js`
- `public/tv-timezone-patch.js`
- `public/tv-brand-refresh.css`

CI includes a guard to prevent retired runtime patch debt returning.

## Compatibility retained deliberately

The following areas may mention recovery, fallback, legacy or compatibility but are not dead code by default:

- authenticated request and token handling;
- route redirects for old bookmarks;
- active TV v4 compatibility runtime;
- planner and wallboard resilience behaviour;
- API migration and schema compatibility code;
- SQL repair scripts required for historic Azure SQL shapes;
- RoadTech/DOT/TachoMaster repair and reconciliation code.

Do not delete those without proving they are unreferenced and no longer required by production data.

## Integration boundaries

- Authentication: Entra ID with SLH domain/user role policy.
- Order intake: Outlook / Power Automate posts staged order payloads to the API.
- Master data: SQL is authoritative for TMS master data.
- Tracking: RoadTech Falcon, DOT tracking and TachoMaster remain API-side integrations.
- TachoMaster driver matching: unique Tacho member number / memCode maps to driver master identity.

## Open risks and backlog

- `main` branch protection is not currently enforced in GitHub and must be enabled manually or via a GitHub administration token.
- Stale feature/agent branches should be reviewed and pruned after confirming whether their work has been merged or superseded.
- Broad planner performance scans should be monitored and optimised separately from baseline cleanup.
- Future additions must be scoped PRs with CI green before merge.
