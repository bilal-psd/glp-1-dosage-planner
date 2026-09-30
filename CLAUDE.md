# GLP-1 Plotter

Single-page tool that plots the estimated amount of a GLP-1 medication in the body over time, for a titration plan made of steps (and, for tirzepatide, pens dialled by clicks).

Current state: everything lives in `index.html` (vanilla JS + ECharts 5.5.0 from cdnjs, no build step). It was built iteratively in a claude.ai chat and is the source of truth for behaviour.

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

- The plan is an ordered list of steps; each step has a dose and a number of weeks (default 1).
- Start weeks are derived by stacking step durations (`layout()`): steps of 7, 1, 1 weeks → weeks 1–7, 8, 9.
- Dose days for a step: from day `(from−1)·7`, every `freq` days, while `t < to·7` (end-exclusive). glapp uses `t <= to·7`, which adds an extra dose; this was a bug the user explicitly wanted fixed. A 1-week step = exactly one dose.
- A dose of 0 (or 0 clicks) is a pause step: no dose events.
- If the steps add up to more weeks than the chart length, the page extends the length; it never shrinks it.

## UI decisions (all requested by the user)

- One medication for the whole plan, plus one global "every N days" interval. Multiple medications, offset days and accumulate/compare modes were removed on purpose.
- Dose input switch: "Dose (mg)" or "Pen clicks".
- Pen clicks mode only for tirzepatide (KwikPen). One injection = 60 clicks = the pen's labelled strength, so `mg = clicks / 60 × strength`. Slider 0–60 with −/+ buttons; 0 = pause.
- In clicks mode, pens are a level above steps. Each pen has a strength (2.5–15 mg), its own steps, "+ Add step to this pen", and a footer showing clicks and mg left. A pen always keeps at least one step.
- Pen capacity: 4 doses = 240 clicks. "Count golden dose" checkbox (off by default, applies to all pens) adds one extra dose → 300 clicks.
- Changing a pen's strength keeps clicks and recomputes mg.
- Each step header shows its week range and dose count, computed from actual dose events.

## Persistence and loading

- State is saved to `localStorage` key `glp1-plotter:v1` after every change.
- Load order at page start: glapp-style query params (`medicationN`, `doseN`, `fromN`, `toN`, `frequencyN`, `start_date`, `length`) → saved state → built-in example. Gaps in a link become 0 mg pause steps. After loading, the page strips the query string.

## Working preferences

- Name the actor for every step of a process (script, CI, agent, the user), and keep build-time and run-time separate.
- Minimal boilerplate; small, testable phases.
- Before refactoring, write tests that pin the model (e.g. tirzepatide `ka ≈ 3.3122`; default example dose days: 0,7,…,42 then 49 then 56) so the maths can't drift.

## Ideas not yet built

- Per-pen golden dose toggle.
- Pen-change markers on the chart.
- Supporting two medications at the same time (would need one step sequence per medication).
