# Dispatch Roster Refresh

## Overview

The dispatch roster is cached for 15 seconds to minimize load on the API and TMS database. When you need to refresh the roster manually (e.g., after driver master changes or tacho updates), you can:

### Option 1: Automatic Refresh
The dispatch board automatically refreshes the roster every 15 seconds. No action needed.

### Option 2: Manual Refresh
Click the **Refresh** button in the dispatch toolbar (reload icon at the top of the dispatch board). This forces an immediate fetch from the API and clears the local cache.

## Related Changes (October 21, 2026)

This update includes fixes for:

1. **Order Confirmation Workflow** – Orders now track their confirmation status (Awaiting Review, Confirmed, Rejected) to prevent unreviewed orders from being planned.

2. **Multi-Row Table Parsing** – NWF pallet CSV parser now handles Outlook-wrapped tables correctly, recovering 19 previously-missed Morrisons orders.

3. **Prose List Format Support** – New parser for dash-delimited order lists (e.g., Waitrose format), recovering 4 orders.

4. **French Garden Detection** – Extended Covent Garden parser to detect French Garden emails without explicit PO references.

5. **Dispatch Master Refresh** – Backend now supports on-demand roster cache clearing via the refresh button.

## Testing

1. Verify dispatch board loads normally (takes 2-5 seconds)
2. Click refresh button and confirm roster updates
3. Check that driver availability and tacho data refresh properly
4. Verify no "Preparing" state lockups (should exit within 30 seconds)

## Notes

- If dispatch is stuck in "Preparing" mode, try clicking Refresh
- If roster continues to show stale driver data after refresh, check Driver Master health
- Report any timeout errors (504, 503) to DevOps
