# Management KPI pilot definitions

This document records the evidence rules used by the Management dashboard during the live planner pilot.

- On-time delivery: Samsara-reported stop arrival is within the order delivery booking window when both are available.
- Run completion: the run is marked Completed or every planned stop has a Samsara-reported arrival and departure.
- Stop completion: distinct planned stops with a Samsara-reported departure.
- Site dwell: elapsed time between Samsara-reported stop arrival and departure.
- Site delay: dwell exceeds the site/category configured wait limit or the live visit is in SiteDelay state.
- Pass-through: vehicle enters and leaves before the minimum confirmation dwell.
- Allocation: run has both a driver and a vehicle.
- Fleet utilisation (pilot): distinct active vehicles used in the selected reporting period divided by active vehicle master count.
- Driver utilisation (pilot): distinct active drivers used in the selected reporting period divided by active driver master count.
- Load utilisation: used pallet spaces divided by available pallet spaces for loads with capacity data.
- Empty mileage: recorded empty miles divided by recorded total estimated miles when both are available.
- Attention rate: runs with an allocation, site-address/coordinate gap, dwell or non-routine operational status signal divided by runs in the period.
- ETA precision: most recent captured Samsara ETA before reported stop arrival compared with that arrival; reported within ±10, ±15 and ±30 minutes and mean absolute error.

These definitions are intentionally evidence-led. Missing source evidence does not count as success or failure; it is excluded from the measured denominator and should be surfaced separately as a data-quality issue.
