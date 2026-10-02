# GLP-1 Plotter

Single-page tool that plots the estimated amount of a GLP-1 medication in the body over time, for a titration plan made of steps (and, for tirzepatide, pens dialled by clicks).

Current state: the main page is built from shadcn/ui (React + Vite + Tailwind + Recharts) in `shadcn-src/`. `cd shadcn-src && npm run build` (run by whoever changes `shadcn-src/`) writes `index.html` and `assets/` into the repo root; commit them, since GitHub Pages serves the root of `main` with no CI build. Never hand-edit the root `index.html` or `assets/`. `model.js` holds the maths and scheduling rules (pure ES module) and is bundled into the page at build time. `test/model.test.mjs` pins the model — run `node --test` before and after any change. `classic/` is the earlier hand-styled vanilla JS + ECharts page, frozen (it imports `../model.js?v=N`; bump N if model.js exports change). `shadcn/` only redirects old /shadcn/ links (with their `#plan=` / query) to the root. `options/` holds earlier redesign prototypes. Dev: `npm --prefix shadcn-src run dev` (port 5174). To check a build, serve the root over HTTP (`python3 -m http.server 5173`); ES modules don't load from `file://`. Hosted on GitHub Pages from `main` (repo root).

Look: dark mode only, Geist (one family), type sizes 13/16/24, spacing 8/12/16/24. Colour tokens are on `.dark` in `shadcn-src/src/index.css`: `--data` (teal) is only for medication data (curve, pen meters, dose sliders); interactive chrome stays neutral (`--primary`, and shadcn's `--accent`, which is a grey hover fill here). The classic page names these `--accent` and `--action`. See PRODUCT.md for audience and goals.

## Pharmacokinetic model (must stay identical)

Ported from glapp.io's plotter bundle. Do not "improve" it without being asked.

Per-drug constants (`DRUGS`): half-life (days), bioavailability F, volume of distribution Vd (L), Tmax (days).

| drug | t½ | F | Vd | Tmax |
|---|---|---|---|---|
| tirzepatide-injection | 5 | 0.8 | 10.3 | 1 |
| semaglutide-injection | 7 | 0.89 | 12.5 | 1.5 |
| semaglutide-oral | 7 | 0.01 | 12.5 | 0.042 |
| retatrutide-injection | 6 | 0.8 | 10 | 1.5 |

Computation (all done in the browser at run time):
1. `ke = ln2 / t½`.
2. `ka` is solved from Tmax with Newton's method on `Tmax = ln(ka/ke)/(ka−ke)`, starting guess `2.5/Tmax` (`solveKa`).
3. Each dose contributes a Bateman curve: `F·D·ka / (Vd·(ka−ke)) · (e^(−ke·t) − e^(−ka·t))`; degenerate branch when `ka ≈ ke`.
4. Contributions of all past doses are summed (superposition), sampled every 6 h (4 points/day) over `weeks × 7` days.
5. Plotted value = concentration × Vd, i.e. mg in the body. Vd therefore cancels out of the chart.

## Scheduling rules (deliberate difference from glapp)

- The plan is an ordered list of steps; each step has a dose and a number of doses (default 1). Steps used to be measured in weeks; the user changed this to doses because "Dose every" can be any interval, not just 7 days.
- Steps run back to back in dose slots (`layout(steps, freq)`): dose k of the whole plan falls on day `k·freq`. A step's `start`/`end` are days (end-exclusive) and `from`/`to` the calendar weeks it covers, for labels. 7, 1, 1 doses every 7 days → days 0–48, 49–55, 56–62 → weeks 1–7, 8, 9. Changing the interval keeps each step's dose count and moves the dates.
- Dose days for a step: `start + i·freq` for i < doses, none past the chart end.
- Old plans (saved state, share links) have `weeks` per step; `upgradePlan()` converts them to the dose count the old rule produced, `⌈weeks·7 / freq⌉` (`weeksToDoses`). glapp links (`fromN`/`toN` weeks) convert the same way. The old rule was end-exclusive (`t < to·7`; glapp's `t <= to·7` added an extra dose, a bug the user wanted fixed), so at freq 7 a 1-week step is still one dose.
- A dose of 0 (or 0 clicks) is a pause step: it takes its dose slots without dosing.
- If the steps run past the chart length (`layout()` returns the weeks needed), the page extends the length; it never shrinks it.

## UI decisions (all requested by the user)

- One medication for the whole plan, plus one global "every N days" interval. Multiple medications, offset days and accumulate/compare modes were removed on purpose.
- Dose input switch ("Enter doses as"): "mg" or "KwikPen clicks" ("Pen clicks" on the classic page).
- Pen clicks mode only for tirzepatide (KwikPen). One injection = 60 clicks = the pen's labelled strength, so `mg = clicks / 60 × strength`. Each step has a 0–60 slider for big moves and, beside it, a `CountField` showing the clicks ("30 cl") with − and + next to the number for fine-tuning (user's pick "B"; the old −/+ at both ends of the slider were a row apart). 0 = pause. The Dose column shows only the mg.
- In clicks mode, pens are a level above steps. Each pen has a strength (2.5–15 mg), its own steps, "+ Add step", and a meter plus footer showing clicks used and clicks/mg left (red when over capacity). A pen always keeps at least one step.
- Pen capacity: 4 doses = 240 clicks. Each pen has its own "Golden dose" switch in its header, next to the strength select (user's pick "B" from a comparison; on a narrow card the pen's settings move to a row under the title). Off by default and for new pens; on adds one extra dose → 300 clicks. It used to be one setting for all pens (`plan.gold`); `upgradePlan()` copies that to pens with no setting of their own, and `plan.gold` stays for the classic page.
- Changing a pen's strength keeps clicks and recomputes mg.
- Chart colouring (user picked "B1" from a comparison): the area under the curve is coloured by dose level, not by step. Consecutive steps with the same mg form one level, even across a pen change. Each distinct dose gets a colour by its position from lowest to highest, cycling through six steps of the data teal (deep → light). Neighbouring levels never share a colour: the later one moves to the next free colour and keeps it everywhere, so a dose always has one colour. Pauses and the time after the last dose are neutral; the line stays teal; no divider lines between colours. Labels above the chart show each level's mg (never clicks), with no separate legend (the user removed it as redundant), and pen changes are dashed lines labelled "Pen N (strength mg)".
- Number fields never show the browser's up/down arrows (Chrome draws them on hover, inside the field, which shifts the number). A step's dose count uses `CountField`: − and + at its edges, the number centred between them, digits only (user's pick "C" from a comparison). Dose every / Chart length use `Stepper`.
- Each step shows the dates of its first and last dose (a pause shows the dates it covers); its dose count is the step's own input.

## Persistence and loading

- State is saved to `localStorage` key `glp1-plotter:v1` after every change.
- Load order at page start: glapp-style query params (`medicationN`, `doseN`, `fromN`, `toN`, `frequencyN`, `start_date`, `length`) → share link (`#plan=` base64url JSON of the full state, made by "Copy share link") → saved state → built-in example. Gaps in a glapp link become 0 mg pause steps. After loading, the page strips the query string and hash.

## Working preferences

- Name the actor for every step of a process (script, CI, agent, the user), and keep build-time and run-time separate.
- Minimal boilerplate; small, testable phases.
- Before refactoring, write tests that pin the model (e.g. tirzepatide `ka ≈ 3.3122`; default example dose days: 0,7,…,42 then 49 then 56) so the maths can't drift.

## Ideas not yet built

- Supporting two medications at the same time (would need one step sequence per medication).
