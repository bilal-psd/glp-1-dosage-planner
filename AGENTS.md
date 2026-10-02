# GLP-1 Plotter

Single-page tool that plots the estimated amount of a GLP-1 medication in the body over time, for a titration plan made of steps (and, for tirzepatide, pens dialled by clicks).

Current state: the main page is built from shadcn/ui (React + Vite + Tailwind + Recharts) in `shadcn-src/`. `cd shadcn-src && npm run build` (run by whoever changes `shadcn-src/`) writes `index.html` and `assets/` into the repo root; commit them, since GitHub Pages serves the root of `main` with no CI build. Never hand-edit the root `index.html` or `assets/`. `shadcn-src/src/lib/export.ts` makes the PNG / PDF exports (jsPDF is an npm dependency, loaded on demand). `model.js` holds the maths and scheduling rules (pure ES module) and is bundled into the page at build time. `test/model.test.mjs` pins the model — run `node --test` before and after any change. `classic/` is the earlier hand-styled vanilla JS + ECharts page, frozen (it imports `../model.js?v=N`; bump N if model.js exports change). `shadcn/` only redirects old /shadcn/ links (with their `#plan=` / query) to the root. `options/` holds earlier redesign prototypes. Dev: `npm --prefix shadcn-src run dev` (port 5174). To check a build, serve the root over HTTP (`python3 -m http.server 5173`); ES modules don't load from `file://`. Hosted on GitHub Pages from `main` (repo root).

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
- Switching to KwikPen clicks with no pens puts every step on one pen (smallest strength ≥ the highest dose) without a note: the user removed "All steps are on one N mg pen…" because the pen card already shows its strength and the over-capacity hint. Notes for doses that can't be dialled exactly stay.
- Chart colouring (user picked "B1" from a comparison): the area under the curve is coloured by dose level, not by step. Consecutive steps with the same mg form one level, even across a pen change. Each distinct dose gets a colour by its position from lowest to highest, cycling through six steps of the data teal (deep → light). Neighbouring levels never share a colour: the later one moves to the next free colour and keeps it everywhere, so a dose always has one colour. Pauses and the time after the last dose are neutral; the line stays teal; no divider lines between colours. Labels above the chart show each level's mg (never clicks), with no separate legend (the user removed it as redundant). Pens (clicks mode) are a quiet row under the dates, not lines on the plot (user's pick "B"; the old dashed lines skipped Pen 1 and were too loud): every pen gets a grey hairline as wide as its time in use, with "Pen N · strength mg" under it, shortened to "Pen N" when it doesn't fit. The PNG/PDF exports draw the same row.
- Number fields never show the browser's up/down arrows (Chrome draws them on hover, inside the field, which shifts the number). A step's dose count uses `CountField`: − and + at its edges, the number centred between them, digits only (user's pick "C" from a comparison). Dose every / Chart length use `Stepper`.
- Each step shows the dates of its first and last dose (a pause shows the dates it covers); its dose count is the step's own input.
- Settings card: lays out by the card's own width (container queries): 2 columns on phones, 4 at mid width, one row only when every field fits (`@[69rem]`). "Dose every" and "Chart length" are `Stepper`s (number + unit + − / + at the trailing edge, aligned with the other fields; unit shortens to "d"/"wk" when narrow). The mg / KwikPen clicks toggle halves never shrink below their labels.
- Start date uses the shadcn date picker (Popover + Calendar), not the native input, whose popup and icon ignored the dark palette. `color-scheme: dark` is set so remaining native controls draw dark.
- With no dose ahead, Next dose reads "None planned"; only in clicks mode with every pen used up (clicks used ≥ capacity) does it read "None left" (user's request: running out of planned doses isn't running out of medicine).
- Now / Next dose / Highest are one summary strip (user's pick "B"): values at body size, 3 columns split by hairlines when the strip is ≥ 32rem, label-left / value-right rows when narrower.
- Order below xl: settings, summary, chart, plan, doses. At xl the plan is the left column.
- Header: title + summary, and one control, "Reset", top right on the title's line at every width. It asks ("Clear everything?"), deletes the saved plan, and opens a blank plan (`blankPlan()`: today, every 7 days, one 2.5 mg dose, mg mode). The user chose a blank plan over the example; first-time visitors still get the example.
- Footer (user's pick "B", a quiet footer, no card): a hairline and small ghost buttons: Export PDF, Export chart (PNG), Export plan (JSON), Import plan (JSON), Copy share link. On phones a two-column grid of outlined buttons, the last full width. The user doesn't want the PDF called "for your doctor", and found "Chart image" odd. The disclaimer is the last line of the page, under these buttons, not in the chart card (user's request). The exports keep their own copy (bottom of the PNG, every PDF page footer) from the same `DISCLAIMER` constant, since they travel without the page.
- Exports (`shadcn-src/src/lib/export.ts`, all made in the browser on click): the chart is drawn again as an SVG in a light "paper" palette (light teal tints for the dose levels, matched by position to the app's), rasterised for the PNG (1200×675 @2×) and placed in the PDF. The PDF (jsPDF, Helvetica, A4) has a title, four facts, the chart, the steps table and every dose, the disclaimer and page numbers; long plans run onto more pages with the table header repeated. jsPDF loads only when a PDF is made. Text in the PDF must stay Latin-1 (no "≈").
- Plan file: `{ app: "glp1-plotter", version: 1, plan }`, the plan in the same shape as a share link (`planJson`). Import also accepts a bare plan, asks before replacing, and shows a note if the file isn't a plan.
- "+ Add step" is centred in its card footer, in line with "+ Add pen".
- Phones (clicks mode), user's pick "B" then "B2": a step is two columns. Left: the mg per dose as the step's headline with "Step N · dates" under it, then the slider. Right: the Doses field ("2 doses") above the clicks field ("15 cl"). The pen's strength menu, the Doses fields and the clicks fields are all 7.5rem wide and share one right edge (also the meter's). Same-month dates read "5–12 Sept". In mg mode the step name has its own line on phones.
- No remove × column on steps: at 1 dose, the Doses field's − becomes a bin that removes the step (`CountField` `onRemove`). Where a step can't be removed (the only step, or a pen's only step) the − is just disabled. Fields show their unit ("doses", "cl") in 13px.
- Remove pen is a × in the pen's title row, straight above the strength menu, the glyph lined up with the menu's right edge (pick "B2"; "Remove pen" in the footer was the rejected alternative). The × beside the strength menu was removed.

## Persistence and loading

- State is saved to `localStorage` key `glp1-plotter:v1` after every change.
- Reset removes the saved plan, then the blank plan is saved as usual.
- Load order at page start: glapp-style query params (`medicationN`, `doseN`, `fromN`, `toN`, `frequencyN`, `start_date`, `length`) → share link (`#plan=` base64url JSON of the full state, made by "Copy share link") → saved state → built-in example. Gaps in a glapp link become 0 mg pause steps. After loading, the page strips the query string and hash.

## How the user works with you

- **Commit and push to `main` after every finished, verified change, without asking**, until the user says the plotter ships to real users (GitHub Pages serves `main`; it isn't public yet). Then go back to asking. Per change: `node --test`, `cd shadcn-src && npm run build`, check in the browser, commit (only your files), push, then wait until the live page serves the new `assets/index-*.js` before saying it's live.
- **Design decisions go through comparisons.** For any non-trivial visual change the user wants a few working options to compare, then picks one by letter ("B1", "C", …). Build the pick exactly; don't add extras they didn't choose. Record the pick in the UI decisions above.
- **Don't place controls "wherever there's room".** The user rejected a checkbox dropped under a meter as not designed. Work out where a control belongs (what it changes, what it sits next to) before placing it.
- **Ask before a third round.** On the phone pen-step redesign (see PLAN.md) three rounds of options were rejected, each judged worse. When a round is rejected, ask what specifically is wrong before generating more.
- **What worked:** the user's own diagnosis first ("the × wastes space", "clicks and mg are detached"), then two or three options that share one skeleton and differ in one variable, shown as interactive mockups with real data at 320/390/430px, reviewed in the browser before sending. They picked within one round and then asked for small follow-ups ("B, but…"). Keep comparisons that tight.
- When a choice is genuinely theirs (where a destructive control goes, what Reset leaves, which PDF approach), ask with AskUserQuestion and a recommended option, rather than guessing.
- The impeccable design hook flags Geist as an overused font on every page. Geist is the project's font on purpose; leave it and don't add an ignore rule unless the user asks.

## Gotchas

- **Build output is the repo root.** `vite.config.ts` has `outDir: ".."` with `emptyOutDir: false`; the build script deletes `../assets` first. Never set `emptyOutDir: true`.
- **GitHub Pages caches files ~10 min.** The built page uses hashed asset names, so it's safe. `classic/` imports `../model.js?v=2`; bump the number whenever `model.js` exports change or a cached old model breaks it.
- **Recharts 3 orders a layer by mount order, not JSX order.** A `ReferenceArea` added after first render was drawn over the curve. Give chart layers an explicit `zIndex` (the dose-label areas use `-150`).
- **`CountField` inside a flex row needs `shrink-0`** or it collapses until the number disappears.
- **Testing exports in the Claude browser pane:** downloads don't land anywhere, so patch `HTMLAnchorElement.prototype.click` to collect `{download, href}` and fetch the blob within 10 s (the URL is then revoked). To look at a PDF, render it with pdf.js from cdnjs into a canvas overlay.
- **Testing in the Claude browser pane:** the clipboard API is blocked (stub `navigator.clipboard` to test "Copy share link"); a hash-only `navigate` doesn't reload the page (call `location.reload()`); CSS animations run slowly there, so don't read their end state too soon; widths under 768px also emulate a touch screen (`pointer: coarse`), which changes some sizes.
- Testing writes to `localStorage` on `localhost:5173`, not the live site. Put back the example plan afterwards: `{start:"2026-08-01",weeks:12,drug:"tirzepatide-injection",freq:7,clicks:false,gold:false,pens:[],steps:[{dose:2.5,doses:7},{dose:3.7,doses:1},{dose:3.25,doses:1}]}`.
- `npx eslint` reports 3 pre-existing `react-refresh/only-export-components` errors (badge, button, toggle export variants). Not caused by recent work; leave them unless asked.
- Phone layouts use Tailwind container queries (`@container`, `@max-md/card-header:`, `@[69rem]:`) sized by the card, not the viewport. Check 320, 375, 768, 1280 and 1440px when changing layout.

## Working preferences

- Name the actor for every step of a process (script, CI, agent, the user), and keep build-time and run-time separate.
- Minimal boilerplate; small, testable phases.
- Before refactoring, write tests that pin the model (e.g. tirzepatide `ka ≈ 3.3122`; default example dose days: 0,7,…,42 then 49 then 56) so the maths can't drift.

## Ideas not yet built

- Supporting two medications at the same time (would need one step sequence per medication).
