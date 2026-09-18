# SLH TMS V2 Portal

This is the clean V2 portal. It is intentionally isolated from the current V1 React application so the existing production portal can remain live while V2 is rebuilt.

## V2 UI rules

- One API client for all V2 calls.
- One route/page per operational responsibility.
- No direct integration calls from React.
- No duplicated planner generations.
- No hidden recovery patches or legacy fallbacks.
- Master data is read from the V2 canonical master endpoints.
- Intake review displays unresolved master-data issues instead of guessing.
- Pages load by an explicit operational date/window rather than pulling unbounded history.
- Build components around operational workflows, not historic backend implementation details.

Initial pages:
- Overview
- Master Data
- Intake Review

Planning, live runs, tracking and reporting are added only after their V2 API contracts are stable.
