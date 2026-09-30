# Product brief

## What it is

A single-page planner that shows the estimated amount of a GLP-1 medication in the body over time, for a titration plan the user builds step by step. It runs entirely in the browser: no accounts, no server, and inputs are saved locally.

## Who it's for

The owner and the people they share it with. These are people already on a GLP-1 (mostly tirzepatide) who manage their own dose schedule. Many of them microdose, dialling partial doses by clicks from a multi-dose KwikPen. They are comfortable with numbers and know their medication, but they aren't pharmacologists.

Sharing happens through links: a plan can be encoded in a glapp-style URL and opened by someone else.

## What it's meant to do

1. **Visualise levels.** Turn a plan (steps of dose × weeks, dosed every N days) into a curve of estimated mg in the body, so the user can see peaks, troughs and how levels build up or taper.
2. **Plan pen usage (core).** For tirzepatide, plan by pen: choose a pen strength, dial each dose in clicks (60 clicks = one labelled dose), and see how many clicks and mg are left in each pen. The golden dose can be counted or not.
3. **Replace glapp.io's plotter.** Use the same pharmacokinetic model and drug constants as glapp.io, so results are directly comparable, but fix its scheduling bug: a 1-week step gives exactly one dose. Open glapp links as they are.

## Principles

- **The maths is fixed.** The model matches glapp exactly and is pinned by tests. Design changes never touch it.
- **Clicks are first-class.** Pen and clicks planning is a main path, not a hidden advanced mode.
- **Explain, don't silently change.** When the app rounds a dose to clicks, merges link rows or extends the chart, it says so.
- **One plan, one medication.** Keep the model simple enough to trust at a glance.

## Not goals

- Medical advice or dose recommendations. The curve is an estimate from a population model, not a measurement.
- Accounts, sync or a backend.
- Plotting several medications at once (possible later, see CLAUDE.md).
