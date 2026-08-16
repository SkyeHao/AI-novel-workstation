# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is recorded as a `Status:` line near the top of each issue file
- Comments append under a `## Comments` heading

## Wayfinding operations

Used by `/wayfinder`. Map is `.scratch/<effort>/map.md`, one child file per ticket.

- Child ticket: `.scratch/<effort>/issues/NN-<slug>.md`, with `Type:` and `Status:` lines
- Blocking: a `Blocked by: NN, NN` line near the top
- Frontier: open, unblocked, unclaimed; first by number wins
- Claim: set `Status: claimed` before work
- Resolve: append `## Answer`, set `Status: resolved`, append pointer to map's Decisions-so-far.
