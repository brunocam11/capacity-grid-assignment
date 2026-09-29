# Decisions

Yours to write, not your AI's. Short is good — bullets are fine, and half a page is
plenty. We read this first.

## What did the spec not tell you?

There are things this brief doesn't specify. Which ones did you hit, what did you decide,
and why?

- how the grid should update after saving. I chose to wait for confirmation, show the saved value, then refresh the range. That avoids showing a change that might fail.
- how to handle partial weeks. I expand the selected dates to full Monday–Sunday weeks and count allocation on weekdays only, so it’s compared against a full week’s capacity.
- how much of the grid to show at once. I limited the view to 12 weeks and render only the visible rows plus a small buffer. The API still returns everyone, so server side paging is deferred.
- whether capacity changes should affect past weeks. I apply the value across all weeks because the supplied schema stores one capacity per person. Keeping historical capacity would need a different data model.



## What did you notice that looked wrong?

Anything in the output that didn't match what you expected. Whether you fixed it or left
it, we want to know you saw it.

- changing the date range while saving made the editor disappear. If the save failed, the draft was gone and the manager had to enter it again. I fixed this by keeping the editor and draft open across navigation.



## What did the AI get wrong that you caught?

One concrete example. Every real session has one.

- saving one person, then editing another, could let the first save’s response close the second person’s editor. I limited editing to one person at a time.



## What would you do differently with a week?

- I’d measure performance with a few thousand people and two years of assignments. Then I’d decide whether server-side search and paging are needed since virtual scrolling only reduces rendering.
- I’d spend more time testing keyboard and screen-reader navigation, especially focus handling when virtualized rows scroll out of view.
- I’d clarify whether capacity changes should preserve history and what should happen when two managers edit the same person. Those decisions would guide any changes to the data model and saving flow.

