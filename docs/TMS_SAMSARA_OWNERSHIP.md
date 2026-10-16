# TMS scope and Samsara ownership (decision: 16 October 2026)

## Authoritative boundary
TMS V2 is the order intake, order review, master-data, capacity planning, run allocation, dispatch handover and auditable-history system. It is **not** a journey management or live telematics platform.

After dispatch, **Samsara** owns mapping, route estimates, route optimisation, ETAs, geofencing, current location, live vehicle/driver status and trip execution. Samsara returns dispatch, assignment, completion and proof-of-service updates to TMS over an authenticated, idempotent API for invoice and audit evidence.

## Keep in TMS
- Orders, customer/site identities, collection and delivery dates/windows, handling units and trailer capacity; manual operational stop sequence and full physical addresses.
- Run plan and allocation ledger, unallocated balances, warnings and safe concurrency.
- Send to Samsara with stable external IDs and exportable route without requiring a locally allocated driver or vehicle.
- Samsara event reception, correlation, reconciliation status, completed timestamps, proof of service and durable audit trail.
- Preserve historical database evidence during decommissioning; no destructive migrations without review.

## Remove, do not replace
- All TMS-generated maps, geofence creation/linkage/evidence, coordinates-as-planning-blockers, truck routing/matrix requests, ETA/ETO calculators, route/mileage estimates, route optimiser UI and automated live tracking dashboards.
- Azure Maps client, server services, configuration, secrets, telemetry and paid Azure Maps resources **after runtime verification**.
- Do not substitute Haversine travel estimates or alternative map vendors; Samsara owns live routing.

## Release gate
This web PR removes the client-side Azure Maps dependency and map/mileage suggestions. **The API removal remains outstanding** and must be coordinated with the API repository; no production release should claim the overall removal is complete before verified API endpoints, jobs, tests and Azure resources are retired.
