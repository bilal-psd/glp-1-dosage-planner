# Work plan

Live at https://bilal-psd.github.io/glp-1-dosage-planner/ (the shadcn page, built from `shadcn-src/`). Rules, conventions and gotchas are in AGENTS.md; this file tracks the work.

## Done (all pushed to `main`, newest last)

- Polish and layout pass on the shadcn page (better-ui / better-layout reviews), then resizing fixes at every width, 320 to 1700px.
- Settings: container-query layout; "Dose every" / "Chart length" steppers; shadcn date picker; "KwikPen clicks" rename.
- Summary: Now / Next dose / Highest as one strip at body size.
- Model: steps counted in **doses**, not weeks (`layout(steps, freq)`, `upgradePlan`, `weeksToDoses`); old saved plans, share links and glapp links convert. Tests: 12 passing.
- The shadcn page became the main page at `/`. The old page is frozen at `/classic/`, and `/shadcn/` redirects to `/`, keeping `#plan=` and the query string.
- Brought over from the classic page: a note when a share link can't be read, "Pen N" labels, the over-capacity hint, and an empty doses table state.
- Chart: dose-level labels in mg (never clicks); pen changes as labelled dashed lines; area under the curve coloured by dose (pick "B1": six teal steps by dose position, cycling, neighbours never the same); no legend; bands fixed below the curve (Recharts zIndex).
- Controls: browser number arrows hidden everywhere. Doses use `CountField` (− n +, pick "C"). Clicks are a slider plus a `CountField` with a "cl" unit (pick "B").
- Pens: golden dose is per pen, as a "Golden dose" switch in the pen header next to strength (pick "B"); the old plan-wide setting carries over. On narrow cards the pen settings move to their own row.
- Phone step rows: the clicks field lines up under the Doses field; same-month dates are shortened; "+ Add step" is centred.
- Pen step rows redesigned (picks "B" then "B2"): mg heads each step above its slider; Doses and clicks fields stacked on the right, aligned with the strength menu; remove-step × replaced by a bin on the Doses field at 1 dose; remove-pen × moved to the title row above the strength menu.
- Header has only "Reset" (clears the saved plan, opens a blank plan). Share / export / import moved to a quiet footer (pick "B"): PDF (chart + steps + every dose), chart PNG, plan JSON export and import, share link.

## Next (not started; confirm with the user first)

- Narrow charts can hide a dose's mg label (the band is too thin), and there's no legend any more. A proposed fix, not yet answered: show the dose in the chart's hover tooltip ("19 Sept · 3.67 mg dose").
- Two medications at once (from AGENTS.md "Ideas not yet built").
- Decide whether to delete `/classic/` (frozen; it still says "Pen clicks" and uses the plan-wide golden dose).

## Open decisions

- When the plotter ships to real users, stop auto-pushing (see AGENTS.md "How the user works with you").
