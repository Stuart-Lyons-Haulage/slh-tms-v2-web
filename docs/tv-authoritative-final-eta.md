# TV authoritative final ETA

The TV keeps `/api/v1/tv-display/live-runs` authoritative for row visibility, so completed runs remain removed. For active rows, the paired display also reads `/api/v1/run-timing` and replaces the fallback ETA with the cumulative RoadTech/geofence final ETA.

If run timing is unavailable, the existing live-runs ETA remains visible. An `ARRIVED` timestamp is never overwritten by a calculated ETA.
