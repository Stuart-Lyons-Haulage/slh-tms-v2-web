# Wallboard arrival and ETA stability

This change keeps the operations wallboard and its TV mode aligned on the same live run state.

## Behaviour

- A vehicle with an active geofence visit at its final planned stop is displayed as **ARRIVED**, not as normal dwell/site delay.
- The **Final ETA / Arrival** column displays the final-stop geofence entry time as the arrival time.
- Intermediate-site dwell and delay behaviour is unchanged.
- A last known live/estimated ETA is retained for up to five minutes if a subsequent refresh is temporarily sparse or omits the ETA row, while the run is still active.
- The final ETA/arrival and status columns are wider.
- TV-mode layout reserves its scrollbar and uses a fixed viewport height to avoid the resize/shrink oscillation caused by changing scroll geometry during refreshes.

## Acceptance checks

1. Run at final geofence: status reads `ARRIVED`, final column shows the arrival time, and no `DWELL 1H+`/site-delay presentation is applied.
2. Run at an intermediate geofence: normal on-site dwell and delay rules still apply.
3. ETA appears on one refresh and the ETA endpoint is sparse on the next refresh: the last useful ETA remains visible rather than reverting to `--:--`.
4. Once a run is no longer active, cached ETA evidence is not reintroduced.
5. Wallboard refreshes do not change the viewport width because a vertical scrollbar appears/disappears.
