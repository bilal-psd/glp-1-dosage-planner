// The GLP-1 plotter (the main page), built from shadcn/ui components. The earlier hand-styled page is frozen at ../classic/.
// Same maths (../model.js), same saved plan (localStorage "glp1-plotter:v1") and same share-link format as that page.
import { useEffect, useMemo, useState } from "react"
import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceLine, XAxis, YAxis } from "recharts"
import { CalendarDays, Check, Link2, Minus, Plus, Trash2, X } from "lucide-react"

import * as M from "../../model.js"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

type Drug = { halfLife: number; bioavailability: number; volumeOfDistribution: number; tmax: number; name: string }
// A step is a dose repeated `doses` times; layout() adds start/end (days, end-exclusive) and from/to (calendar weeks).
type Step = { dose: number; doses: number; pen?: number; clicks?: number; start?: number; end?: number; from?: number; to?: number }
type Plan = { start: string; weeks: number; drug: string; freq: number; clicks: boolean; gold: boolean; pens: { strength: number; gold?: boolean }[]; steps: Step[] }
type DoseEvent = { t: number; dose: number }

const DRUGS = M.DRUGS as Record<string, Drug>
const { TIRZ, CLICKS, PEN_CLICKS, STRENGTHS } = M
const EXAMPLE = M.EXAMPLE as Plan
const doseEvents = M.doseEvents as (s: Step, freq: number, weeks: number) => DoseEvent[]
const simulate = M.simulate as (e: DoseEvent[], drug: string, weeks: number) => [number, number][]
const amountBefore = M.amountBefore as (e: DoseEvent[], drug: string, t: number) => number
const stack = M.layout as (steps: Step[], freq: number) => number
const upgradePlan = M.upgradePlan as (p: Plan) => Plan
const KEY = "glp1-plotter:v1"

// Six steps of the data teal (OKLCH hue 182), deep to light, for the area under the curve; kept darker than the curve itself.
const DOSE_COLOURS = Array.from({ length: 6 }, (_, i) => { const f = i / 5; return `oklch(${(0.36 + 0.30 * f).toFixed(3)} ${(0.055 + 0.045 * f).toFixed(3)} 182)` })
const NO_DOSE_COLOUR = "#2a2b30", AFTER_COLOUR = "#1e2a29"
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const mgFmt = (v: number) => (+v).toFixed(2).replace(/\.?0+$/, "")
const shortName = (d: string) => DRUGS[d].name.replace(/ \(.*/, "")
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`
const valid = (v: unknown): v is Plan => !!v && typeof v === "object" && Array.isArray((v as Plan).steps) && (v as Plan).steps.length > 0 && (v as Plan).drug in DRUGS

// Load: a glapp-style link wins, then a share link (#plan=…), then what this browser saved, then the example.
// Share links and saved plans from before steps were counted in doses have weeks per step; upgradePlan converts them.
function initialPlan(): { plan: Plan; notes: string[] } {
  const link = M.fromGlappParams(new URLSearchParams(location.search))
  if (link) return { plan: link.state as Plan, notes: link.notes }
  const notes: string[] = []
  const m = location.hash.match(/plan=([\w-]+)/)
  if (m) {
    try {
      const v = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, "+").replace(/_/g, "/")))))
      if (valid(v)) return { plan: upgradePlan({ ...structuredClone(EXAMPLE), ...v }), notes }
    } catch { /* reported below */ }
    notes.push("That share link couldn't be read, so your saved plan is shown instead.")
  }
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null")
    if (valid(v)) return { plan: upgradePlan(v), notes }
  } catch { /* fall through */ }
  return { plan: structuredClone(EXAMPLE), notes }
}

// A number field with its unit and −/+ inside one field-shaped box: the value starts at the same inset as the
// other settings fields, and the buttons sit on the trailing edge where the select chevron and calendar icon are.
// Buttons are 28px in a 36px field (4px inset), so their 6px radius nests inside the field's 10px.
// A whole-number count with − and + at its edges and the number centred between them (user's pick "C" from a comparison).
// Replaces a native number field, whose Chrome-only hover arrows pushed the number off centre. Typing is digits only;
// a typed value applies when it's in range, and the field shows the current value again on blur.
// With onRemove, the − turns into a bin at the minimum and removes the item (replaces a separate × column; user's pick "B").
function CountField({ value, onChange, min = 1, max = 99, label, unit, onRemove, removeLabel }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; label: string; unit?: string
  onRemove?: () => void; removeLabel?: string
}) {
  const [draft, setDraft] = useState(String(value))
  const [shown, setShown] = useState(value)
  if (value !== shown) { setShown(value); setDraft(String(value)) }
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)))
  const bin = !!onRemove && value <= min
  const btn = "grid h-full w-7 shrink-0 place-items-center text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground disabled:pointer-events-none disabled:opacity-40"
  return (
    <div className="grid h-9 w-30 shrink-0 grid-cols-[1.75rem_minmax(0,1fr)_1.75rem] items-center overflow-hidden rounded-lg border border-input text-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-muted">
      {bin
        ? <button type="button" className={`${btn} hover:text-destructive focus-visible:text-destructive`} aria-label={removeLabel} onClick={onRemove}><Trash2 className="size-3.5" strokeWidth={1.5} /></button>
        : <button type="button" className={btn} aria-label={`${label}: one fewer`} disabled={value <= min} onClick={() => set(value - 1)}><Minus className="size-3.5" strokeWidth={1.5} /></button>}
      {/* With a unit, number and unit are centred together; the number field is sized to its digits. */}
      <label className="flex min-w-0 cursor-text items-baseline justify-center gap-1">
      <input type="text" inputMode="numeric" value={draft} aria-label={label} className={`min-w-0 bg-transparent text-center tabular-nums outline-none ${unit ? "" : "w-full"}`}
        style={unit ? { width: `${Math.max(draft.length, 1) + 0.25}ch` } : undefined}
        onChange={e => { const t = e.target.value.replace(/\D/g, "").slice(0, 2); setDraft(t); const v = +t; if (t !== "" && v >= min && v <= max) onChange(v) }}
        onKeyDown={e => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); set(value + (e.key === "ArrowUp" ? 1 : -1)) } }}
        onBlur={() => setDraft(String(value))} />
      {unit && <span className="text-xs text-muted-foreground" aria-hidden="true">{unit}</span>}
      </label>
      <button type="button" className={btn} aria-label={`${label}: one more`} disabled={value >= max} onClick={() => set(value + 1)}><Plus className="size-3.5" strokeWidth={1.5} /></button>
    </div>
  )
}

function Stepper({ id, value, onChange, step, min, max, unit }: {
  id: string; value: number; onChange: (v: number) => void; step: number; min: number; max: number; unit: [string, string, string]
}) {
  const [draft, setDraft] = useState(String(value))
  const [shown, setShown] = useState(value)
  if (value !== shown) { setShown(value); setDraft(String(value)) }
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step))
  const nudge = (d: number) => onChange(clamp(value + d))
  const btn = "grid size-7 shrink-0 place-items-center rounded-[6px] text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 pointer-coarse:size-9"
  return (
    <div className="@container flex h-9 w-full items-center rounded-lg border border-input bg-transparent ps-3 pe-1 text-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 pointer-coarse:h-11 dark:bg-muted">
      <label htmlFor={id} className="flex min-w-0 flex-1 cursor-text items-baseline gap-1">
        <input id={id} type="number" inputMode="decimal" min={min} max={max} step={step} value={draft}
          style={{ width: `${Math.max(draft.length, 1) + 0.25}ch` }}
          className="min-w-0 bg-transparent tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          onChange={e => { setDraft(e.target.value); const v = +e.target.value; if (e.target.value !== "" && v >= min && v <= max) onChange(v) }}
          onBlur={() => setDraft(String(value))} />
        {/* Full unit when the field has room (more room needed with 36px touch buttons); the short form otherwise. */}
        <span className="sr-only truncate text-muted-foreground pointer-fine:@[7.5rem]:not-sr-only pointer-coarse:@[8.5rem]:not-sr-only">{value === 1 ? unit[0] : unit[1]}</span>
        <span className="text-muted-foreground pointer-fine:@[7.5rem]:hidden pointer-coarse:@[8.5rem]:hidden" aria-hidden="true">{unit[2]}</span>
      </label>
      <div className="flex items-center gap-0.5">
        <button type="button" className={btn} aria-label={`Fewer ${unit[1]}`} disabled={value <= min} onClick={() => nudge(-step)}><Minus className="size-3.5" strokeWidth={1.5} /></button>
        <button type="button" className={btn} aria-label={`More ${unit[1]}`} disabled={value >= max} onClick={() => nudge(step)}><Plus className="size-3.5" strokeWidth={1.5} /></button>
      </div>
    </div>
  )
}

export default function App() {
  const [{ plan: first, notes: firstNotes }] = useState(initialPlan)
  const [plan, setPlan] = useState<Plan>(() => (first.drug === TIRZ ? first : { ...first, clicks: false }))
  const [notes, setNotes] = useState<string[]>(firstNotes)
  // Notes from a mode switch fade in; notes present at page load don't. Dismissing fades them out first.
  const [notesAnim, setNotesAnim] = useState<"none" | "in" | "out">("none")
  const [copied, setCopied] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  const [plotWidth, setPlotWidth] = useState(0)

  useEffect(() => { if (location.search || location.hash) history.replaceState(null, "", location.pathname) }, [])

  // Every edit goes through here: copy, change, re-stack the steps, recompute mg from clicks.
  const update = (fn: (p: Plan) => void) => setPlan(prev => {
    const p = structuredClone(prev)
    fn(p)
    const total = stack(p.steps, p.freq)
    if (total > p.weeks) p.weeks = total
    if (p.clicks) p.steps.forEach(s => { s.dose = M.clicksToMg(s.clicks ?? 0, p.pens[s.pen ?? 0].strength) })
    return p
  })

  const calc = useMemo(() => {
    const p = structuredClone(plan)
    stack(p.steps, p.freq)
    const perStep = p.steps.map(s => doseEvents(s, p.freq, p.weeks))
    const events = perStep.flat().sort((a, b) => a.t - b.t)
    const pts = simulate(events, p.drug, p.weeks)
    const start = new Date(p.start + "T00:00")
    const today = isNaN(+start) ? null : (Date.now() - +start) / 864e5
    return { steps: p.steps, perStep, events, pts, today }
  }, [plan])

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(plan)) } catch { /* private mode */ } }, [plan])

  const dateAt = (day: number) => { const d = new Date(plan.start + "T00:00"); if (isNaN(+d)) return null; d.setDate(d.getDate() + Math.floor(day)); return d }
  const dayLabel = (day: number, long = false) => dateAt(day)?.toLocaleDateString(undefined, long ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short" }) ?? `Day ${Math.floor(day)}`

  const { steps, perStep, events, pts, today } = calc
  const startDate = dateAt(0) ?? undefined
  const end = plan.weeks * 7
  const clicksAllowed = plan.drug === TIRZ
  // A pen holds 4 doses (240 clicks); counting its golden dose (per pen, off by default, not guaranteed) adds one more.
  const penCap = (pen: { gold?: boolean }) => PEN_CLICKS + (pen.gold ? CLICKS : 0)
  const next = today == null ? undefined : events.find(e => e.t >= Math.floor(today))
  const nextStep = next && steps[perStep.findIndex(l => l.includes(next))]
  const peak = pts.reduce((m, p) => (p[1] > m[1] ? p : m), [0, 0])
  const firstOfPen = plan.clicks ? plan.pens.map((_, pi) => steps.find(s => s.pen === pi)) : []
  const penStarts = firstOfPen.slice(1).filter(Boolean) as Step[]

  function setClicks(on: boolean) {
    if (on === plan.clicks || (on && !clicksAllowed)) return
    const msg: string[] = []
    update(p => {
      if (on) {
        if (!p.pens.length || p.steps.some(s => s.pen == null || !p.pens[s.pen])) {
          const max = Math.max(...p.steps.map(s => s.dose)), str = STRENGTHS.find(v => v >= max) ?? 15
          p.pens = [{ strength: str }]; p.steps.forEach(s => { s.pen = 0 })
          msg.push(`All steps are on one ${str} mg pen. If it runs out, change a pen's strength or add a pen.`)
        }
        p.steps.forEach((s, i) => {
          const str = p.pens[s.pen!].strength, before = s.dose
          s.clicks = M.toClicks(s.dose, str)
          const after = M.clicksToMg(s.clicks!, str)
          if (Math.abs(after - before) > 1e-6) msg.push(`Step ${i + 1}: ${mgFmt(before)} mg can't be dialled exactly on a ${str} mg pen, so it's now ${s.clicks} clicks = ${mgFmt(after)} mg.`)
        })
        p.steps.sort((a, b) => a.pen! - b.pen!)
      }
      p.clicks = on
    })
    setNotes(msg)
    setNotesAnim("in")
  }

  async function share() {
    const json = JSON.stringify({ start: plan.start, weeks: plan.weeks, drug: plan.drug, freq: plan.freq, clicks: plan.clicks, gold: plan.gold, pens: plan.pens, steps: plan.steps.map(({ dose, doses, pen, clicks }) => ({ dose, doses, pen, clicks })) })
    const url = location.origin + location.pathname + "#plan=" + btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { prompt("Copy this link:", url) }
  }

  const iconFade = "transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)]"
  const iconOn = "scale-100 opacity-100 blur-0", iconOff = "scale-[0.25] opacity-0 blur-[4px]"

  const summary = [shortName(plan.drug), plan.clicks ? plural(plan.pens.length, "pen") : null, `${plan.weeks} weeks`].filter(Boolean).join(" · ")
  const weekSpan = (a: number, b: number) => (a === b ? `Week ${a}` : `Weeks ${a}–${b}`)
  // "19 Sept", "5–12 Sept" within one month, "29 Aug – 5 Sept" across months.
  const dayRange = (a: number, b: number) => {
    if (Math.floor(a) === Math.floor(b)) return dayLabel(a)
    const x = dateAt(a), y = dateAt(b)
    return x && y && x.getMonth() === y.getMonth() && x.getFullYear() === y.getFullYear() ? `${x.getDate()}–${dayLabel(b)}` : `${dayLabel(a)} – ${dayLabel(b)}`
  }

  // ---- One step as a table row; clicks mode gets − / slider / +, mg mode a number field.
  function stepRow(i: number) {
    const s = steps[i], n = perStep[i].length
    const removable = steps.length > 1 && !(plan.clicks && steps.filter(x => x.pen === s.pen).length === 1)
    const setClicksTo = (c: number) => update(p => { p.steps[i].clicks = Math.min(CLICKS, Math.max(0, c)) })
    const dates = s.dose > 0 ? dayRange(s.start!, s.start! + (s.doses - 1) * plan.freq) : dayRange(s.start!, s.end! - 1)
    // Phones: two columns. Left: what the step is, then the slider; right: the Doses field above the clicks field, the same
    // width and right edge as the pen's strength menu (user's pick "B2"). In clicks mode the mg per dose heads the step,
    // right above the slider that sets it. No remove ×: at 1 dose the Doses field's − becomes a bin.
    return (
      <TableRow key={i} className="max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_7.5rem] max-sm:items-center max-sm:gap-3 max-sm:py-4 max-sm:*:p-0">
        <TableCell className={plan.clicks ? undefined : "max-sm:col-span-2"}>
          {plan.clicks && (
            <div className="sm:hidden">
              <div className={s.dose > 0 ? "font-semibold tabular-nums" : "text-muted-foreground"}>{s.dose > 0 ? `${mgFmt(s.dose)} mg` : "Pause"}</div>
              <div className="text-xs text-muted-foreground"><span className="whitespace-nowrap">Step {i + 1} ·</span> <span className="whitespace-nowrap">{dates}</span></div>
            </div>
          )}
          <div className={plan.clicks ? "max-sm:hidden" : undefined}>
            <div>Step {i + 1}</div>
            <div className="text-xs text-muted-foreground">{s.dose > 0 ? dates : `Pause · ${dates}`}</div>
          </div>
        </TableCell>
        <TableCell className={plan.clicks ? "max-sm:col-span-2 max-sm:col-start-1 max-sm:row-start-2" : undefined}>
          {plan.clicks ? (
            // Slider for big moves; the clicks field beside it for exact clicks, with − and + next to the number (user's pick "B").
            <div className="flex items-center gap-3 sm:gap-4">
              <Slider className="min-w-20" min={0} max={CLICKS} step={1} value={[s.clicks ?? 0]} onValueChange={([v]) => setClicksTo(v)} aria-label={`Step ${i + 1} clicks per dose`} />
              <CountField value={s.clicks ?? 0} min={0} max={CLICKS} unit="cl" label={`Step ${i + 1} clicks per dose`} onChange={setClicksTo} />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input type="number" min={0} step={0.05} className="w-16 text-end pointer-coarse:h-9 sm:w-28" defaultValue={mgFmt(s.dose)} aria-label={`Step ${i + 1} dose in mg`}
                onChange={e => { const v = +e.target.value; if (v >= 0) update(p => { p.steps[i].dose = v }) }} />
              <span className="text-xs text-muted-foreground sm:hidden" aria-hidden="true">mg</span>
            </div>
          )}
        </TableCell>
        <TableCell className="text-end max-sm:hidden">
          {plan.clicks
            ? <div className="font-semibold">{s.clicks ? `${mgFmt(s.dose)} mg` : "pause"}</div>
            : <div className="font-semibold">{s.dose > 0 ? `${mgFmt(s.dose * n)} mg` : "pause"}</div>}
        </TableCell>
        <TableCell className={plan.clicks ? "max-sm:col-start-2 max-sm:row-start-1" : undefined}>
          <div className="flex justify-end">
            <CountField value={s.doses} unit={s.doses === 1 ? "dose" : "doses"} label={`Step ${i + 1} number of doses`} onChange={v => update(p => { p.steps[i].doses = v })}
              onRemove={removable ? () => update(p => { p.steps.splice(i, 1) }) : undefined} removeLabel={`Remove step ${i + 1}`} />
          </div>
        </TableCell>
      </TableRow>
    )
  }

  function stepTable(indices: number[]) {
    return (
      <div className="[&_[data-slot=table-container]]:overflow-visible">
      <Table className="table-fixed max-sm:block max-sm:[&>tbody]:block">
        <TableHeader className="max-sm:hidden">
          <TableRow>
            <TableHead className="w-28">Step</TableHead>
            <TableHead>{plan.clicks ? "Clicks per dose" : "Dose (mg)"}</TableHead>
            <TableHead className="w-24 text-end">{plan.clicks ? "Dose" : "Total"}</TableHead>
            <TableHead className="w-36 text-end">Doses</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>{indices.map(stepRow)}</TableBody>
      </Table>
      </div>
    )
  }

  // ---- Chart
  const chartConfig = { mg: { label: "In body", color: "var(--chart-1)" } } satisfies ChartConfig
  const data = pts.map(([t, v]) => ({ t, mg: +v.toFixed(3) }))
  const tickEvery = 7 * Math.max(1, Math.ceil(plan.weeks / 8))
  const ticks = Array.from({ length: Math.floor(end / tickEvery) + 1 }, (_, k) => k * tickEvery)
  const showToday = today != null && today >= 0 && today <= end
  const yStep = peak[1] > 8 ? 4 : peak[1] > 4 ? 2 : 1, yMax = Math.max(yStep, Math.ceil(peak[1] / yStep) * yStep)
  const yTicks = Array.from({ length: yMax / yStep + 1 }, (_, k) => k * yStep)

  // Dose levels: consecutive steps with the same mg per dose form one run (even across a pen change, which gets its own
  // marker). The chart labels runs in mg, whether doses are entered as mg or clicks. A pause is a run of its own.
  const runs = steps.reduce<{ dose: number; start: number; end: number }[]>((acc, s) => {
    const d = +s.dose.toFixed(4), last = acc[acc.length - 1]
    if (last && last.dose === d && last.end === s.start) last.end = s.end!
    else acc.push({ dose: d, start: s.start!, end: s.end! })
    return acc
  }, []).filter(r => r.start < end)
  // A run's label shows only when its band is wide enough for the text (≈7.5px per character at 13px).
  const runLabel = (r: { dose: number; start: number; end: number }) => {
    const text = r.dose > 0 ? `${mgFmt(r.dose)} mg` : "pause"
    return (Math.min(r.end, end) - r.start) / end * plotWidth >= text.length * 7.5 + 12 ? text : ""
  }
  // The area under the curve is coloured by dose level (chosen by the user from a comparison, option "B1"):
  // - Each distinct dose gets a colour by its position from lowest to highest, cycling through DOSE_COLOURS.
  // - Neighbouring dose levels never share a colour: if one would, the later (higher) dose moves to the next free colour,
  //   and keeps it everywhere it appears. So a dose always has one colour, including when it comes back later.
  // - Pauses and the time after the last dose are neutral. The line itself stays teal.
  const levels = [...new Set(runs.map(r => r.dose))].filter(d => d > 0).sort((a, b) => a - b)
  const doseColour = new Map<number, string>()
  {
    const near = new Map(levels.map(d => [d, new Set<number>()]))
    runs.forEach((r, i) => { const n = runs[i + 1]; if (n && r.dose > 0 && n.dose > 0) { near.get(r.dose)!.add(n.dose); near.get(n.dose)!.add(r.dose) } })
    const slot = new Map<number, number>(), K = DOSE_COLOURS.length
    levels.forEach((d, rank) => {
      const taken = new Set([...near.get(d)!].filter(n => slot.has(n)).map(n => slot.get(n)))
      let k = rank % K
      for (let j = 0; j < K && taken.has(k); j++) k = (k + 1) % K
      slot.set(d, k); doseColour.set(d, DOSE_COLOURS[k])
    })
  }
  // Hard colour stops along x (the area spans the whole x domain, so 0–1 of its box is day 0 to the chart end).
  const doseStops = runs.flatMap(r => { const c = r.dose > 0 ? doseColour.get(r.dose)! : NO_DOSE_COLOUR; return [[r.start / end, c], [Math.min(r.end, end) / end, c]] as [number, string][] })
    .concat(runs.length && runs[runs.length - 1].end < end ? [[runs[runs.length - 1].end / end, AFTER_COLOUR], [1, AFTER_COLOUR]] : [])

  // ---- Dose rows
  const doseRows = steps.flatMap((s, i) => perStep[i].map(e => ({ e, s }))).sort((a, b) => a.e.t - b.e.t)
  const totalMg = events.reduce((n, e) => n + e.dose, 0)
  const totalClicks = plan.clicks ? doseRows.reduce((n, r) => n + (r.s.clicks ?? 0), 0) : 0

  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-4 md:px-12 md:py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-baseline gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">GLP-1 plotter</h1>
          <span className="text-xs text-muted-foreground">{summary}</span>
        </div>
        <div className="flex flex-wrap gap-2 max-sm:w-full max-sm:*:grow">
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="outline">Reset to example</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Replace your plan with the example?</AlertDialogTitle>
                <AlertDialogDescription>Your current plan will be lost.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => { setNotes([]); setNotesAnim("none"); setPlan(structuredClone(EXAMPLE)) }}>Replace</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button onClick={share}>
            <span data-icon="inline-start" className="relative flex">
              <Check className={cn("absolute inset-0", iconFade, copied ? iconOn : iconOff)} />
              <Link2 className={cn(iconFade, copied ? iconOff : iconOn)} />
            </span>
            <span className="grid">
              <span className={cn("col-start-1 row-start-1", copied && "invisible")}>Copy share link</span>
              <span className={cn("col-start-1 row-start-1", !copied && "invisible")}>Link copied</span>
            </span>
          </Button>
        </div>
      </header>

      {notes.length > 0 && (
        <Alert
          className={notesAnim === "in" ? "animate-in fade-in-0 slide-in-from-top-2 duration-200 ease-out" : notesAnim === "out" ? "animate-out fade-out-0 slide-out-to-top-3 duration-150 ease-out fill-mode-forwards" : undefined}
          onAnimationEnd={e => { if (e.target === e.currentTarget && notesAnim === "out") { setNotes([]); setNotesAnim("none") } }}>
          <AlertDescription className="flex items-start justify-between gap-4">
            <div className="space-y-1">{notes.map(n => <p key={n}>{n}</p>)}</div>
            <Button variant="ghost" size="icon" aria-label="Dismiss message" onClick={() => setNotesAnim("out")}><X /></Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Settings: two columns on phones, four in a mid-width card, one row once everything fits.
          Sized by the card (container query), not the viewport. */}
      <Card className="@container">
        <CardContent className="grid grid-cols-2 items-start gap-4 @lg:grid-cols-4 @lg:gap-6 @[69rem]:grid-cols-[minmax(0,14rem)_minmax(0,10rem)_minmax(0,10rem)_minmax(0,10rem)_minmax(max-content,1fr)]">
          <Field className="col-span-2 @[69rem]:col-span-1">
            <FieldLabel>Medication</FieldLabel>
            <Select value={plan.drug} onValueChange={v => update(p => { p.drug = v; if (v !== TIRZ) p.clicks = false })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(DRUGS).map(([k, v]) => <SelectItem key={k} value={k}>{v.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field className="col-span-2 @[69rem]:col-span-1">
            <FieldLabel htmlFor="start">Start date</FieldLabel>
            {/* shadcn date picker instead of the native one, whose popup and icon ignore the page's colours. */}
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger asChild>
                <button id="start" type="button" className="flex h-9 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent px-3 text-sm whitespace-nowrap transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:h-11 dark:bg-muted dark:hover:bg-accent">
                  {startDate ? startDate.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : <span className="text-muted-foreground">Pick a date</span>}
                  <CalendarDays className="size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" captionLayout="dropdown" selected={startDate} defaultMonth={startDate} startMonth={new Date(2020, 0)} endMonth={new Date(2035, 11)}
                  onSelect={d => { if (!d) return; update(p => { p.start = isoDay(d) }); setDateOpen(false) }} />
              </PopoverContent>
            </Popover>
          </Field>
          <Field>
            <FieldLabel htmlFor="freq">Dose every</FieldLabel>
            <Stepper id="freq" value={plan.freq} step={0.5} min={0.5} max={30} unit={["day", "days", "d"]} onChange={v => update(p => { p.freq = v })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="len">Chart length</FieldLabel>
            <Stepper id="len" value={plan.weeks} step={1} min={steps[steps.length - 1].to ?? 1} max={104} unit={["week", "weeks", "wk"]} onChange={v => update(p => { p.weeks = v })} />
          </Field>
          <Field className="col-span-2 @[69rem]:col-span-1 @[69rem]:w-auto @[69rem]:justify-self-end">
            <FieldLabel>Enter doses as</FieldLabel>
            <ToggleGroup className="grid grid-cols-[1fr_1fr]" type="single" variant="outline" spacing={0} value={plan.clicks ? "clicks" : "mg"} onValueChange={v => v && setClicks(v === "clicks")}>
              <ToggleGroupItem value="mg">mg</ToggleGroupItem>
              <ToggleGroupItem value="clicks" disabled={!clicksAllowed} title={clicksAllowed ? undefined : "KwikPen clicks are for tirzepatide KwikPens"}>KwikPen clicks</ToggleGroupItem>
            </ToggleGroup>
          </Field>
        </CardContent>
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,680px)_minmax(0,1fr)]">

        {/* Summary: one strip, values at body size so they read as context for the chart, not as headlines.
            Three columns split by hairlines when there's room; label-left, value-right rows when narrow. */}
        <section className="@container xl:col-start-2" aria-label="Summary">
          <Card className="py-4">
            <CardContent className="grid gap-3 @lg:grid-cols-3 @lg:gap-6">
              {[
                [today == null ? "Now" : today < 0 ? "Now · before start" : `Now · ${new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`,
                  today == null ? "—" : `≈ ${(today < 0 ? 0 : amountBefore(events, plan.drug, today)).toFixed(1)} mg`],
                [!next ? "Next dose" : Math.floor(next.t) === Math.floor(today!) ? "Next dose · today" : `Next dose · ${dayLabel(next.t, true)}`,
                  !next ? "None left" : plan.clicks ? <>{nextStep?.clicks} cl <span className="font-normal text-muted-foreground">{mgFmt(next.dose)} mg</span></> : `${mgFmt(next.dose)} mg`],
                [`Highest · ${dayLabel(peak[0], true)}`, `≈ ${peak[1].toFixed(1)} mg`],
              ].map(([label, value], k) => (
                <div key={k} className="flex items-baseline justify-between gap-4 border-t pt-3 first:border-t-0 first:pt-0 @lg:block @lg:border-t-0 @lg:border-s @lg:ps-6 @lg:pt-0 @lg:first:border-s-0 @lg:first:ps-0">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="font-medium whitespace-nowrap">{value}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <Card className="xl:col-start-2">
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-wider">Estimated amount in body (mg)</CardTitle>
            <CardDescription>Shading shows the dose{showToday ? " · amber line is today" : ""}{penStarts.length ? " · dashed lines are new pens" : ""}</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="aspect-auto h-80 w-full" ref={el => { if (el && Math.abs(el.clientWidth - 40 - plotWidth) > 4) setPlotWidth(el.clientWidth - 40) }}>
              <AreaChart data={data} margin={{ top: 24, left: 0, right: 8 }}>
                <CartesianGrid vertical={false} />
                <defs>
                  <linearGradient id="dose-fill" x1="0" y1="0" x2="1" y2="0">
                    {doseStops.map(([o, c], k) => <stop key={k} offset={o} style={{ stopColor: c }} />)}
                  </linearGradient>
                </defs>
                {/* Transparent areas that only carry each dose level's mg label. Their own layer below the curve: Recharts 3 orders
                    a layer by mount order, so without an explicit zIndex an area added later was drawn over the curve. */}
                {runs.map((r, i) => (
                  <ReferenceArea key={i} zIndex={-150} x1={r.start} x2={Math.min(r.end, end)} fill="transparent" ifOverflow="hidden"
                    label={{ value: runLabel(r), position: "insideTopLeft", fill: "var(--muted-foreground)", fontSize: 13, dy: -20 }} />
                ))}
                <XAxis dataKey="t" type="number" domain={[0, end]} ticks={ticks} tickFormatter={v => dayLabel(v)} tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis width={32} tickLine={false} axisLine={false} domain={[0, yMax]} ticks={yTicks} />
                <ChartTooltip content={<ChartTooltipContent indicator="line" labelFormatter={(_, p) => { const t = p?.[0]?.payload?.t as number; return `${dayLabel(t, true)} · day ${t}` }} formatter={v => `${Number(v ?? 0).toFixed(2)} mg`} />} />
                <Area dataKey="mg" type="linear" stroke="var(--color-mg)" fill="url(#dose-fill)" fillOpacity={1} strokeWidth={2} isAnimationActive={false} />
                {penStarts.map(s => <ReferenceLine key={s.pen} x={s.start!} stroke="var(--marker)" strokeWidth={1.5} strokeDasharray="3 4"
                  label={{ value: `Pen ${s.pen! + 1} (${plan.pens[s.pen!].strength} mg)`, position: "insideBottomLeft", offset: 8, fill: "var(--foreground)", fontSize: 13 }} />)}
                {showToday && <ReferenceLine x={today!} stroke="var(--today)" strokeWidth={2} />}
              </AreaChart>
            </ChartContainer>
          </CardContent>
          <CardFooter className="text-xs text-muted-foreground">Estimate from a one-compartment model with glapp.io's drug constants. Not a measurement, and not medical advice.</CardFooter>
        </Card>

        <section className="flex flex-col gap-6 xl:col-start-1 xl:row-span-3 xl:row-start-1" aria-label="Plan">
          {!plan.clicks ? (
            <Card>
              <CardHeader>
                <CardTitle>Steps</CardTitle>
                <CardDescription>{weekSpan(1, steps[steps.length - 1].to!)} · {plural(events.length, "dose")}</CardDescription>
              </CardHeader>
              <CardContent>{stepTable(steps.map((_, i) => i))}</CardContent>
              <CardFooter className="justify-center py-2">
                <Button variant="ghost" onClick={() => update(p => { p.steps.push({ ...p.steps[p.steps.length - 1], doses: 1 }) })}><Plus data-icon="inline-start" />Add step</Button>
              </CardFooter>
            </Card>
          ) : (
            <>
              {plan.pens.map((pen, pi) => {
                const own = steps.map((s, i) => [s, i] as const).filter(([s]) => s.pen === pi)
                const used = own.reduce((n, [s, i]) => n + (s.clicks ?? 0) * perStep[i].length, 0)
                const doses = own.reduce((n, [, i]) => n + perStep[i].length, 0)
                const cap = penCap(pen), left = cap - used
                return (
                  <Card key={pi}>
                    <CardHeader>
                      <CardTitle>Pen {pi + 1}</CardTitle>
                      <CardDescription className="@max-md/card-header:col-span-2">{[`${pen.strength} mg KwikPen`, ...(own.length ? [weekSpan(own[0][0].from!, own[own.length - 1][0].to!), plural(doses, "dose")] : [])].map((t, k) => <span key={k}>{k ? " · " : ""}<span className="whitespace-nowrap">{t}</span></span>)}</CardDescription>
                      {/* Remove pen: in the title row, straight above the strength menu (user's pick "B2"). Pulled out by the
                          icon's inset so the × itself, not its button, lines up with the menu's right edge. */}
                      {plan.pens.length > 1 && (
                        <Button variant="ghost" size="icon-sm" className="relative col-start-2 row-start-1 -my-1 -me-1.5 justify-self-end text-muted-foreground after:absolute after:-inset-2 hover:text-foreground" aria-label={`Remove pen ${pi + 1}`} onClick={() => update(p => {
                          p.steps = p.steps.filter(s => s.pen !== pi); p.steps.forEach(s => { if (s.pen! > pi) s.pen!-- }); p.pens.splice(pi, 1)
                        })}><X /></Button>
                      )}
                      {/* The pen's settings: golden dose (user's pick "B") and strength, under the remove ×. On a narrow card
                          (phones) they move to their own row under the title, golden dose left, strength right. */}
                      <CardAction className="row-span-1 row-start-2 flex items-center gap-3 @max-md/card-header:col-span-2 @max-md/card-header:col-start-1 @max-md/card-header:row-start-3 @max-md/card-header:mt-2 @max-md/card-header:justify-self-stretch">
                        <div className="flex items-center gap-2 @max-md/card-header:me-auto">
                          <Switch id={`gold-${pi}`} checked={!!pen.gold} onCheckedChange={c => update(p => { p.pens[pi].gold = c })} />
                          <Label htmlFor={`gold-${pi}`} className="text-xs font-normal whitespace-nowrap text-muted-foreground" title={`Counts the extra dose most pens hold (+${CLICKS} clicks); not guaranteed`}>Golden dose</Label>
                        </div>
                        <Select value={String(pen.strength)} onValueChange={v => update(p => { p.pens[pi].strength = +v })}>
                          <SelectTrigger className="w-30" aria-label={`Pen ${pi + 1} strength`}><SelectValue /></SelectTrigger>
                          <SelectContent>{STRENGTHS.map(v => <SelectItem key={v} value={String(v)}>{v} mg</SelectItem>)}</SelectContent>
                        </Select>
                      </CardAction>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                      <div className="flex flex-col gap-3">
                        <Progress className={left < 0 ? "[&_[data-slot=progress-indicator]]:bg-destructive" : undefined} value={Math.min(100, (used / cap) * 100)} aria-label={`Pen ${pi + 1} clicks used`} />
                        <div className={`flex flex-wrap justify-between gap-2 text-xs ${left < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                          <span><span className="font-semibold text-foreground">{used}</span> / {cap} clicks used</span>
                          <span>{left >= 0 ? `${left} clicks left · ${mgFmt((left * pen.strength) / CLICKS)} mg` : `${-left} clicks over (${mgFmt((-left * pen.strength) / CLICKS)} mg short). Add a pen or move steps.`}</span>
                        </div>
                      </div>
                      {stepTable(own.map(([, i]) => i))}
                    </CardContent>
                    <CardFooter className="justify-center py-2">
                      <Button variant="ghost" onClick={() => update(p => {
                        const mine = p.steps.filter(s => s.pen === pi), l = mine[mine.length - 1]
                        p.steps.splice(p.steps.indexOf(l) + 1, 0, { ...l, doses: 1 })
                      })}><Plus data-icon="inline-start" />Add step</Button>
                    </CardFooter>
                  </Card>
                )
              })}
              <Button variant="outline" onClick={() => update(p => {
                const l = p.steps[p.steps.length - 1]
                p.pens.push({ strength: p.pens[l.pen!].strength }); p.steps.push({ ...l, doses: 1, pen: p.pens.length - 1 })
              })}><Plus data-icon="inline-start" />Add pen</Button>
            </>
          )}
        </section>

        <Card className="xl:col-start-2">
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-wider">Doses</CardTitle>
            <CardDescription>{plural(events.length, "dose")}{plan.clicks ? ` · ${totalClicks} clicks` : ""} · {mgFmt(totalMg)} mg</CardDescription>
          </CardHeader>
          <CardContent>
            <Table className="text-xs [&_td]:py-3.5">
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-end max-[359px]:hidden">Week</TableHead>
                  {plan.clicks && <><TableHead className="max-sm:hidden">Pen</TableHead><TableHead className="text-end max-sm:hidden">Clicks</TableHead></>}
                  <TableHead className="text-end">Dose</TableHead>
                  <TableHead className="text-end max-sm:whitespace-normal">In body before</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {doseRows.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No doses in this plan.</TableCell></TableRow>}
                {doseRows.map(({ e, s }, k) => {
                  const past = today != null && e.t < Math.floor(today), isNext = next === e
                  return (
                    <TableRow key={k} className={isNext ? "bg-[var(--today-soft)]" : past ? "text-muted-foreground" : undefined}>
                      <TableCell className={isNext ? "font-semibold" : undefined}>{dayLabel(e.t, true)}{isNext && " · next"}</TableCell>
                      <TableCell className="text-end max-[359px]:hidden">{Math.floor(e.t / 7) + 1}</TableCell>
                      {plan.clicks && <><TableCell className="max-sm:hidden">{s.pen! + 1} · {plan.pens[s.pen!].strength} mg</TableCell><TableCell className="text-end max-sm:hidden">{s.clicks}</TableCell></>}
                      <TableCell className="text-end">{mgFmt(e.dose)} mg{plan.clicks && <div className="text-muted-foreground sm:hidden">{s.clicks} cl</div>}</TableCell>
                      <TableCell className="text-end">{amountBefore(events, plan.drug, e.t).toFixed(2)} mg</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
