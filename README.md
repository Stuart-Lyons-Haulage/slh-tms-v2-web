# SLH TMS Web

Production React and TypeScript operations portal for the [SLH TMS API](https://github.com/Stuart-Lyons-Haulage/slh-tms-api). The API and Azure SQL database remain the system of record. This repository owns the user-facing portal, planner, operations wallboard, TV wallboard, live runs, staging review, imports, reporting and operational screens.

The production portal runs in Azure Container Apps and publishes automatically when `main` changes.

## Production

| Item | Value |
| --- | --- |
| Portal | `https://slh-tms-portal-prod.gentlepond-08dba66b.uksouth.azurecontainerapps.io/` |
| API proxy | `/tms-api` |
| API backing service | `https://slh-tms-api-prod.gentlepond-08dba66b.uksouth.azurecontainerapps.io` |
| Runtime | Azure Container Apps with Nginx |
| Authentication | Microsoft Entra SPA sign-in |
| API scope | `api://497f6ea5-9753-43ee-8ccf-afaa0a3869c2/Tms.Access` |

Browser code never receives RoadTech, TachoMaster, Fleetio, Sage HR, SQL or SMS credentials. All provider calls go through the API.

## Main Screens

| Screen | Purpose |
| --- | --- |
| Dashboard | Operational summary and navigation into live workflows |
| Staging / Review orders | Review staged manual, spreadsheet and email-derived orders before promotion |
| Planner / Allocation | Build and adjust loads, stops, routes, allocations and capacity |
| Planner import | Import planner source-line JSON and reset/re-import a planning day safely |
| Runs / Loads | Manage saved runs, allocation, dispatch readiness and driver messages |
| Operations wallboard | Live operational control board for today's runs |
| TV wallboard / Live runs TV | Office display using the same live run-progress evidence as the main wallboard |
| Tracking | Live RoadTech/Falcon fleet view |
| Drivers & TachoMaster | Driver master data, TachoMaster linkage and availability imports |
| Daily compliance | Fleetio walkround, TachoMaster, DOT/Falcon and TMS reconciliation |
| Pallet control / Reporting / Management | Operational reporting and support workflows |

## Operational Workflow

1. Enter a single order, upload a spreadsheet, or ingest email-derived work into staging.
2. Review staged rows, required fields, dates, pallets, duplicates and evidence before promotion.
3. Approve reviewed work into operational orders.
4. Import or create planner runs, then allocate driver, vehicle and trailer.
5. Save stops with usable site/postcode coordinates so routing and geofence matching can work.
6. Dispatch only after the API has checked allocation, live sign-on/card evidence, legal-hours data where available, route feasibility and acknowledged warnings.
7. Operations control the day through the wallboard, live runs, tracking, run screens and exception panels.
8. Completed geofence departures flow back into progress/completion states.

`docs/POWER_AUTOMATE_EMAIL_INTAKE.md` defines the safe Power Automate email-to-staging handoff. Email automation must never bypass staging approval.

## Operations Wallboard

The operations wallboard and TV wallboard are evidence-driven. They do not show a run as live simply because it is planned.

The wallboard displays:

- allocated driver, vehicle and trailer;
- signed-on/card-confirmed status and time where known;
- whether legal-hours metrics are available;
- live tracking state from RoadTech/Falcon;
- current stop or next stop;
- actual geofence arrival/departure where known;
- completed stop count and progress percentage;
- predicted ETA to the next stop where live tracking supports it;
- completed/finished state after the final linked stop has departed; and
- clear exception text where live evidence is missing or mismatched.

The tacho/card labels are intentionally specific:

| Label | Meaning |
| --- | --- |
| `Tacho signed on` | TachoMaster duty/profile evidence matched the planned driver/vehicle |
| `Card confirmed` | Falcon live card/driver evidence matched, but this is not by itself a full legal-hours calculation |
| `Card confirmed, hours missing` | Driver/card presence is live, but TachoMaster did not provide usable drive/work metrics |
| `Not signed on` | No live TachoMaster duty or Falcon card/driver evidence matched the allocation |
| `Tacho mismatch` | Live identity exists but does not match the planned driver/vehicle |
| `TachoMaster unavailable` | Provider/config/runtime failure, not a driver status |

Planned start time is schedule context only. It must not be shown as live ETA. ETA text should come from live vehicle location, route calculation and next-stop evidence, or it should say that ETA is still calculating/missing.

## TV Wallboard

Supported TV paths:

- `/tv`
- `/operations-wallboard/tv`
- `/live-runs/tv`

The TV uses the same API-backed run progress as the main wallboard. It can be opened by an authenticated Lyons account or by the configured TV access key/pairing flow. TV keys are passed to the API proxy by Nginx and must remain server-side.

The TV wallboard refreshes automatically and is designed to survive staggered API/web deployments with fallback loading behaviour.

## Tracking and TachoMaster Display Rules

RoadTech/Falcon and TachoMaster are separate evidence types even when they use the same RoadTech API host:

- RoadTech/Falcon supplies live vehicle movement, position and sometimes live card/driver identity.
- TachoMaster supplies driver profile, card, duty history and legal-hours metrics.
- Falcon card confirmation can prove that a card/driver is present in a moving vehicle.
- TachoMaster legal-hours metrics are needed before the UI can claim enough drive time or break-aware ETA confidence.

The UI must not collapse these into a vague `Pending` state where stronger evidence exists. It should show exactly what is known and what is missing.

## Staging and Planner Import

Staging means review-before-live, not RoadTech API staging.

Planner source-line imports post to the resilient backend endpoint:

`POST /api/v1/planning/import-plan`

The Planner Import screen supports:

- source-line preview;
- held/excluded run visibility;
- capacity warnings;
- manual actual/ETA source lines;
- clean planning-day reset through the protected backend reset endpoint; and
- idempotent re-imports without deleting audit history.

## Local Development

1. Copy `.env.example` to `.env.local` if present, or create `.env.local`.
2. Enter the API, Entra and Azure Maps values.
3. Install dependencies with `pnpm install`.
4. Run the local portal with `pnpm run dev`.

The API requires a bearer token issued by the configured tenant for the `Tms.Access` delegated scope. Configure API CORS for the local and production portal origins; do not weaken API authentication.

## Build Configuration

All `VITE_` values are public build-time configuration. Never put client secrets, connection strings or RoadTech credentials in this repository.

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | API origin or proxy, without `/api/v1`. Production uses `/tms-api`. |
| `VITE_ENTRA_TENANT_ID` | Microsoft Entra tenant ID. |
| `VITE_ENTRA_CLIENT_ID` | Portal SPA application/client ID. |
| `VITE_ENTRA_API_SCOPE` | Normally `api://<API-CLIENT-ID>/Tms.Access`. |
| `VITE_AZURE_MAPS_CLIENT_ID` | Azure Maps account client ID / unique ID for map rendering. |
| `VITE_GRAPH_SITES_SCOPE` | Delegated Graph scope for mailbox intake SharePoint List work, normally `Sites.ReadWrite.All`. |
| `VITE_GRAPH_MAIL_SCOPE` | Delegated Graph scope for reading the shared mailbox source message, normally `Mail.Read.Shared`. |
| `VITE_MAILBOX_INTAKE_LIST_ID` | SharePoint List ID for the TMS mailbox queue. Defaults to the live SLH intake list where configured. |
| `VITE_MAILBOX_INTAKE_ADDRESS` | Shared mailbox to read source messages from. Defaults to `info@lyonshaulage.com` where configured. |

Production defaults are supplied by the GitHub Actions workflow where safe. Provider secrets remain in the API Container App and Key Vault.

## Azure Container Apps Deployment

The production workflow is `.github/workflows/slh-tms-portal-prod-AutoDeployTrigger-9ef45802-17f2-425d-9502-8db65f35c937.yml`.

Deployment flow:

1. Push to `main`.
2. GitHub Actions signs in to Azure with OIDC.
3. The workflow builds the Nginx portal image.
4. The image is pushed to Azure Container Registry.
5. The workflow waits for any existing Container App operation to settle.
6. The exact image for the Git SHA is deployed to `slh-tms-portal-prod`.
7. The workflow verifies the production portal root URL.
8. The workflow verifies the same-origin `/tms-api/api/v1/health` proxy returns healthy API output.

Azure Container Apps updates are asynchronous. A CLI timeout does not always mean the deployment failed. The workflow deliberately retries and confirms the image before marking the release finished.

## CI

Every branch and pull request runs:

- `pnpm install --frozen-lockfile`;
- `pnpm run lint`;
- `pnpm run test`; and
- `pnpm run build`.

The production build supplies test-safe `VITE_` values in CI. Production deployment supplies the real public build values through the deploy workflow.

## Manual Production Verification

After a wallboard or integration-facing release, verify:

1. Web GitHub checks are green.
2. API GitHub checks are green if the backend changed.
3. Production API `/api/v1/health` reports the intended API revision.
4. Production portal deploy workflow has verified `/` and `/tms-api/api/v1/health`.
5. Operations wallboard opens after sign-in.
6. TV wallboard opens by authenticated account or TV access flow.
7. Live runs show signed-on/card-confirmed/not-signed-on explicitly.
8. ETA fields do not use planned start as live ETA.
9. Completed geofence departures count as completed stops and final completion.
10. Exceptions are clear where evidence is missing.

## Security

- Do not commit credentials, customer files, provider payloads or operational exports.
- Do not put secrets into `VITE_` variables.
- Keep Entra authentication and API bearer-token validation intact.
- Keep RoadTech, TachoMaster, Fleetio, Sage HR, SQL and SMS credentials server-side.
- Do not bypass staging review with browser-side shortcuts.
- Do not hide missing live evidence behind planned times or generic healthy-looking states.

## Reference

- `docs/BACKEND_CONTRACT.md` - inspected versioned API routes and authentication.
- `docs/POWER_AUTOMATE_EMAIL_INTAKE.md` - Power Automate email order intake contract.
- `docs/DRIVER_SMS_DELIVERY.md` - secure Azure Communication Services driver-message setup.
- `docs/CUSTOMER_ETA_UPDATES.md` - customer ETA update behaviour.
- `docs/portal-deployment-resilience.md` - Container Apps release recovery rules.
