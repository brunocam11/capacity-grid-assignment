# Worklog

Running notes on how this got built — decisions, assumptions, dead ends, and anything
left unfinished. Append as you go; a line or two per entry is right.

---

- Dates are expanded to Monday-Sunday weeks. Allocation sums every assignment row on overlapping weekdays, including both assignment endpoints. The repeated-looking seed rows are additive.
- The grid requests up to 12 weeks and shows 50 people per page. The API allows 105 weeks so older history remains reachable. Server-side paging is deferred.
- A successful edit applies the returned weekly hours immediately, cancels an older load, then refetches the active range. A failed save keeps the draft for retry.
- Docker and Go are unavailable in this local environment. Bruno will run and inspect the grid before publication. Seed arithmetic suggests Ana's first three weeks are 40, 0, 30 hours and Dee's are 0, 45, 40 hours; these are not runtime-verified.
