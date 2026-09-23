# SLH TMS API contract observed on `main`

Inspected from the production planning and tracking implementation of `danwilliams201302-max/slh-tms-api`. All controller routes are beneath `/api/v1`.

## Authentication and authorisation

The API is single-tenant Microsoft Entra JWT bearer authentication. Set the correct API audience (`api://<API-CLIENT-ID>`) and issuer (`https://login.microsoftonline.com/<TENANT-ID>/v2.0`; the tenant v1 issuer is also accepted). All routes use the fallback authenticated policy except the two health endpoints.

Operational access requires a valid single-tenant Microsoft Entra bearer token for the configured API audience and a trusted sign-in address claim (`preferred_username`, `upn`, or verified email claim) whose domain is authorised by the API. The current company domain is `lyonshaulage.com`, matched case-insensitively as an exact email/UPN domain. `TmsWrite` and `TmsApprove` currently enforce that same authenticated company-domain policy.

## Endpoints

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | Anonymous | Lightweight liveness endpoint. |
| GET | `/health/ready` | Anonymous | Azure SQL readiness check. |
| GET | `/customers?q=` | Authenticated | Active customers, 100 maximum. |
| GET | `/vehicles?q=` | Authenticated | Active vehicles, 100 maximum. |
| GET | `/drivers?q=` | Authenticated | Active drivers, 100 maximum. |
| GET | `/trailers?q=` | Authenticated | Active trailers, 100 maximum. |
| GET | `/sites?q=` | Authenticated | Active collection/delivery sites, 100 maximum. |
| GET | `/market-contacts?q=` | Authenticated | Active market contacts, 100 maximum. |
| GET | `/staging?status=&entityType=&take=` | Authenticated | List staged imports; `take` is 1–500. |
| POST | `/staging` | `Tms.Access` | Create an idempotent staged import; returns 202 or existing result. |
| GET | `/staging/{id}` | Authenticated | Read a staged import. |
| POST | `/staging/{id}/approve` | `Tms.Access` | Approve and promote supported imports. |
| POST | `/staging/{id}/reject` | `Tms.Access` | Reject a staged import. |
| GET | `/orders?from=&to=` | Authenticated | Operational transport orders for planning. |
| GET | `/loads?date=` | Authenticated | Saved loads including stops and allocation IDs. |
| POST | `/loads` | `Tms.Access` | Create a saved planning load. |
| PUT | `/loads/{id}/allocation` | `Tms.Access` | Allocate driver, vehicle and trailer. |
| PUT | `/loads/{id}/stops` | `Tms.Access` | Save ordered route stops and coordinates. |
| GET | `/loads/{id}/route` | Authenticated | Azure Maps directions for saved coordinates. |
| GET | `/loads/{id}/dispatch` | Authenticated | Driver, fleet and market-aware dispatch brief data. |
| GET | `/maps/geocode?address=` | Authenticated | Azure Maps address lookup. |
| GET | `/tracking/dot/telemetry` | `Tms.Access` | Current RoadTech Falcon telemetry. |
| GET | `/tracking/dot/history?date=&vehicle=&take=` | `Tms.Access` | Persisted tracking history for a day. |
| GET | `/integrations/status` | Authenticated | Integration readiness for RoadTech, Azure Maps, SMS, Sage HR and intake. |
| GET | `/integrations/sage-hr/status` | Authenticated | Sage HR connectivity, employee count, driver-candidate count and missing runtime settings. |
| POST | `/integrations/sage-hr/sync-drivers` | `Tms.Access` | Pull Sage HR driver candidates into master driver data. |

The backend README’s health URL omits `/api/v1`; the program maps the actual routes above.

## Models and integrations

- **Customer**: ID, code, name, active.
- **Vehicle**: registration, fleet number, abbreviation, transmission, DVS compliance, fuel-provider metadata, active. Fuel PIN secret name is never rendered by this portal.
- **Driver**: employee number, display/tacho name, driver type/group, skills, active.
- **Trailer**: number, type, standard/Euro capacity, active.
- **Site**: external code, name, driver-facing name, collection address/instructions, map link, active.
- **Market contact**: market, name, stand/location, active.
- **Staging**: entity type, idempotency key, raw source payload, lifecycle status, source and audit/review metadata. Order, customer, driver, vehicle, trailer, site and market-contact imports pass through the same control gate.
- **Planning**: approved orders can be grouped into loads, allocated, edited with route coordinates and rendered through Azure Maps.
- **DOT / RoadTech**: configuration and credentials stay server-side. A scheduled ingestion service normalises valid coordinates into current vehicle status and historic tracking events.
- **Sage HR**: server-side authenticated endpoints expose status and driver sync. Runtime configuration must be supplied in Azure, never in the browser.

## External integration boundaries

- **Power Automate email intake** posts normalised, idempotent rows to `/staging`; it needs a configured mailbox connection and Entra-authorised HTTP action.
- **Outbound SMS / WhatsApp** supports MightyText copy now and Azure Communication Services when configured server-side.
- **Route optimisation** currently uses grouping rules and Azure Maps directions. An optimisation provider can be introduced server-side without exposing credentials to the browser.

## Sage HR runtime settings

Set these on the API Container App, preferably from Key Vault secret references:

```text
Integrations__SageHr__Enabled=true
Integrations__SageHr__BaseUrl=https://api.sage.hr/v1/
Integrations__SageHr__ApiKey=secretref:<sage-hr-api-key-secret>
Integrations__SageHr__DriverTeamName=Drivers
Integrations__SageHr__DriverPositionKeyword=Driver
```

The Admin screen shows any missing setting returned by `/integrations/sage-hr/status`.
