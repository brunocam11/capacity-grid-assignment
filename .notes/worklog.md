# Worklog

Running notes on how this got built — decisions, assumptions, dead ends, and anything
left unfinished. Append as you go; a line or two per entry is right.

---

- Dates are expanded to Monday-Sunday weeks. Allocation sums every assignment row on overlapping weekdays, including both assignment endpoints. The repeated-looking seed rows are additive.
- The grid requests up to 12 weeks and shows 50 people per page. The API allows 105 weeks so older history remains reachable. Server-side paging is deferred.
- A successful edit applies the returned weekly hours immediately, cancels an older load, then refetches the active range. A failed save keeps the draft for retry.
- Docker and Go are unavailable in this local environment. Bruno will run and inspect the grid before publication. Seed arithmetic suggests Ana's first three weeks are 40, 0, 30 hours and Dee's are 0, 45, 40 hours; these are not runtime-verified.
- Added three focused grid tests for failed saves, an edit while refresh is pending, and a late response from an old range. The starter's React Testing Library needed its missing `@testing-library/dom` peer dependency. `npm test` and `npm run tsc` pass locally; the Compose run is still pending.
- The edit form now stays above the grid for one person at a time, so range, search, paging, and load failures cannot drop a pending draft; other edits wait for Save or Cancel. Save feedback remains visible after a refresh, and refresh errors stay separate from save errors.
- After reviewing the editor change with Bruno, the five grid tests and TypeScript check passed locally. These tests mock the API; the actual SQL totals and browser behavior still need verification with the seeded app.
- During the live outage check, generic 500 responses repeated the UI's load/save label. The grid now gives a short retry message for server errors, a connection hint for network failures, and keeps specific 4xx details; failed edits still keep their draft.
- Live API allocations matched independent seed calculations for all 500 people across 3-week, 12-week, and partial-date requests: 8,000 cells, no mismatches. Missing, invalid, reversed, and excessive ranges returned 400.
- Checked the running grid's initial numbers, save persistence, draft preservation, date limits, paging, and recovery after stopping and restarting only the API. A separate browser pass checked desktop layout, keyboard focus, invalid inputs, and the corrected errors. Original capacity values were restored and the API is running. All six grid tests and TypeScript pass.
- A follow-up review found that more than two decimal places could make an over-allocated cell read "Over by 0 h." Edits now use hundredths in the UI and API. The grid shows the applied range with years, restores focus when an edited row disappears, and keeps status messages outside the busy table. Added focused tests for late same-range responses, failed refreshes after saving, and precision. These changes still need review and verification.
- Replaced 50-person paging with measured row virtualization and five-row overscan, keeping the 12-week window and full-roster API. The edit form stays outside virtual rows. A browser pass mounted 15–21 people across the 500-person roster, reached the end without gaps, and checked sticky cells, search reset, keyboard scrolling, draft preservation, 12-week horizontal scrolling, and narrow viewports. No stored values changed.
- The 10 component tests and TypeScript passed after the review fixes and virtualization. The frontend production build and API image build passed too. The rebuilt API rejected excess precision; valid boundaries reached the missing-person path using a nonexistent ID, without changing data. Full production-scale profiling and screen-reader testing remain deferred.
- Correcting the hours input now clears stale save feedback; all 10 component tests and TypeScript passed again. During Bruno’s live review, the implementer also checked a 40-to-39.99-to-40 save, including the 0.01-hour over-allocation label, and restored the original value.
