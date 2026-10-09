# GLP-1 Plotter

A single-page tool that plots the estimated amount of a GLP-1 medication in the body over time, for a titration plan made of steps (and, for tirzepatide, KwikPens dialled by clicks). It runs entirely in the browser: no accounts, no backend; the plan is saved in `localStorage`.

Live at https://bilal-psd.github.io/glp-1-dosage-planner/ (GitHub Pages, served from the root of `main`).

## Layout

- `app/`: the page source. React + Vite + Tailwind + shadcn/ui + Recharts.
  - `app/src/App.tsx`: the page.
  - `app/src/BenzoApp.tsx`, `app/benzo/index.html`: the benzodiazepine plotter, a second page at `/benzo/`.
  - `app/src/components/fields.tsx`: the number fields both pages use.
  - `app/src/lib/export.ts`: the PNG and PDF exports (jsPDF, loaded only when a PDF is made).
  - `app/src/index.css`: colour tokens (on `.dark`).
- `model.js`: the maths and scheduling rules, a pure ES module bundled into the page at build time.
- `benzo-model.js`: the benzodiazepine plotter's maths and scheduling rules (imports `solveKa` from `model.js`).
- `test/model.test.mjs`, `test/benzo-model.test.mjs`: tests that pin the models.
- `index.html`, `benzo/index.html`, `assets/`: **build output**. Never edit by hand.

## Develop

```bash
npm --prefix app install
npm --prefix app run dev        # http://localhost:5174
node --test                     # model tests, run before and after any change
```

## Build and deploy

There is no CI build. Whoever changes `app/` runs the build and commits its output:

1. `cd app && npm run build` writes `index.html`, `benzo/index.html` and `assets/` into the repo root (`outDir: ".."`; the build script clears `../assets` first; never set `emptyOutDir: true`).
2. Check the build: `python3 -m http.server 5173` from the repo root (ES modules don't load from `file://`).
3. Commit the source and the build output together, then push to `main`. GitHub Pages serves it within a few minutes; asset names are hashed, so caching is safe.

## Pharmacokinetic model (must stay identical)

Ported from glapp.io's plotter so results are directly comparable. Don't change it; `test/model.test.mjs` pins it (e.g. tirzepatide `ka ≈ 3.3122`).

| drug | t½ (days) | F | Vd (L) | Tmax (days) |
|---|---|---|---|---|
| tirzepatide-injection | 5 | 0.8 | 10.3 | 1 |
| semaglutide-injection | 7 | 0.89 | 12.5 | 1.5 |
| semaglutide-oral | 7 | 0.01 | 12.5 | 0.042 |
| retatrutide-injection | 6 | 0.8 | 10 | 1.5 |

1. `ke = ln2 / t½`.
2. `ka` is solved from Tmax with Newton's method on `Tmax = ln(ka/ke)/(ka−ke)`, starting at `2.5/Tmax` (`solveKa`).
3. Each dose adds a Bateman curve, `F·D·ka / (Vd·(ka−ke)) · (e^(−ke·t) − e^(−ka·t))`, with a degenerate branch when `ka ≈ ke`.
4. Doses are summed (superposition) and sampled every 6 h over `weeks × 7` days.
5. The chart shows concentration × Vd, i.e. mg in the body.

## Scheduling rules

- A plan is one medication, one "every N days" interval, and an ordered list of steps. Each step has a dose (mg, or clicks on a pen) and a number of doses.
- Steps run back to back in dose slots (`layout(steps, freq)`): dose k of the plan falls on day `k·freq`. A dose of 0 is a pause step.
- If the steps run past the chart length, the page extends the length; it never shrinks it.
- KwikPen clicks (tirzepatide only): 60 clicks = one labelled dose, so `mg = clicks / 60 × strength`. A pen holds 240 clicks, or 300 with its "Golden dose" switch on.
- Older plans measured steps in weeks; `upgradePlan()` converts them (`⌈weeks·7 / freq⌉` doses). Keep it working: saved plans and share links in the wild still use the old shape.

## Persistence and links

- The plan is saved to `localStorage` key `glp1-plotter:v1` after every change.
- Load order: glapp-style query params (`medicationN`, `doseN`, `fromN`, `toN`, `frequencyN`, `start_date`, `length`) → share link (`#plan=`, base64url JSON) → saved plan → built-in example. The page then strips the query and hash.
- Plan files (Export / Import plan) are `{ app: "glp1-plotter", version: 1, plan }`.

## Benzodiazepine plotter (`/benzo/`)

A separate page so the GLP-1 model and its links stay untouched. Same one-compartment oral Bateman curve and `solveKa`, but in hours, sampled every 15 minutes, and shown as a blood level: ng/mL = mg in body / (Vd L/kg × weight kg) × 1000.

| drug | t½ low / typical / high (h) | Tmax (h) | F | Vd (L/kg) | source |
|---|---|---|---|---|---|
| alprazolam | 6.3 / 11.2 / 26.9 | 1.5 | 0.9 | 0.8 | Xanax label (t½); Greenblatt & Wright 1993 (Vd) |
| clonazepam | 17 / 35 / 60 | 2.5 | 0.9 | 3 | Klonopin / Rivotril labels (typical t½, F, Vd); review range |
| lorazepam | 10 / 12 / 20 | 2 | 0.9 | 1.3 | Ativan label; Greenblatt 1981 |
| diazepam | 20 / 40 / 100 | 1.25 | 0.95 | 0.9 | Valium label (t½ up to 48 h, Vd 0.8–1.0); high end is older people |
| └ nordazepam | 40 / 71 / 100 | — | fm 0.64 | 0.9 (assumed = diazepam) | Valium label (up to 100 h); fm set so nordazepam ≈ diazepam at steady state |

- Each curve is a sum of exponentials (`terms`), so `simulate` keeps a running sum per exponent: cost is samples + doses. Diazepam adds nordazepam as a formed metabolite (fm of diazepam's elimination, scaled by molar mass).
- The line uses the typical half-life; the shaded band spans the low and high variants (parent and metabolite paired low-with-low).
- A plan is a start date, weight (kg; `lb` only changes the display), one drug, 1–4 daily dose times and steps of `{ mg: [one per time], days }`, run back to back. `cleanPlan()` validates anything loaded, imported or linked, and stretches `days` to fit the steps (never shrinks).
- Saved to `localStorage` key `benzo-plotter:v1`; share links use `#plan=`; plan files are `{ app: "benzo-plotter", version: 1, plan }`.
- Keep it descriptive, never prescriptive: no "therapeutic range", no suggested doses or taper speeds, and keep the seizure warning on the page and in both exports (`DISCLAIMER` in `BenzoApp.tsx`).

## Conventions

- Dark mode only. One font family (Geist). Type sizes 13 / 16 / 24 px; spacing 8 / 12 / 16 / 24.
- `--data` (teal) is only for medication data: the curve, pen meters, dose sliders. Interactive chrome stays neutral.
- Layouts use Tailwind container queries sized by the card, not the viewport. Check 320, 375, 768, 1280 and 1440 px when changing layout.
- The exports redraw the chart in a light "paper" palette. PDF text must stay Latin-1 (jsPDF's built-in Helvetica), so no "≈".
- The page is an estimate, not medical advice; keep the disclaimer on the page and in both exports (`DISCLAIMER` in `App.tsx`).

## Gotchas

- **Recharts 3 orders chart layers by mount order, not JSX order.** A layer added after the first render can draw over the curve; give layers an explicit `zIndex` (the dose-label areas use `-150`).
- **`CountField` inside a flex row needs `shrink-0`**, or it collapses until the number disappears.
- `npx eslint` reports 3 known `react-refresh/only-export-components` errors in shadcn's `badge`, `button` and `toggle`; they're harmless.
