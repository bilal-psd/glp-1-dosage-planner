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

## In progress: phone layout of steps inside a pen card (paused)

The problem the user raised: on a phone, it isn't immediately clear what the two numbers are or what the two control boxes do (Doses vs clicks per dose). The current layout is described in AGENTS.md under UI decisions.

Three rounds of options were rejected; the user called each round worse than the one before. Don't repeat any of these:

- Round 1: labelled lines ("Each dose" / "Number of doses"); a sentence ("Dial 15 cl … for 2 doses"); a one-line summary you tap to edit; two tiles ("Per dose" / "Doses").
- Round 2 (all dropped the slider on phones; the user said removing the slider "defeats the purpose"): a table with column headers; "dose × doses = total"; a bar of the pen's injections above the table.
- Round 3 (slider kept): headers with the slider under its column; a slider with a 15/30/45/60 scale and "2 doses" inside the field; an outlined "dial" box plus "Take it [2 doses]".

What we know the user wants: keep the slider (it's how you dial a pen); keep the − / + field beside it; the two fields aligned with each other; no new controls placed "wherever". All the comparison pages were deleted at the user's request.

**Next step:** don't generate options straight away. Ask the user what specifically is wrong with the current phone step layout (the labels, the order, the density, something else), or ask for a sketch or reference app they like. Then propose at most two options.

## Next (not started; confirm with the user first)

- Narrow charts can hide a dose's mg label (the band is too thin), and there's no legend any more. A proposed fix, not yet answered: show the dose in the chart's hover tooltip ("19 Sept · 3.67 mg dose").
- Two medications at once (from AGENTS.md "Ideas not yet built").
- Decide whether to delete `/classic/` (frozen; it still says "Pen clicks" and uses the plan-wide golden dose).

## Open decisions

- Phone pen-step layout (above).
- When the plotter ships to real users, stop auto-pushing (see AGENTS.md "How the user works with you").
