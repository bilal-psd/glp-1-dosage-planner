// The GLP-1 plotter (the main page), built from shadcn/ui components. The earlier hand-styled page is frozen at ../classic/.
// Same maths (../model.js), same saved plan (localStorage "glp1-plotter:v1") and same share-link format as that page.
import { useEffect, useMemo, useState } from "react"
import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceLine, XAxis, YAxis } from "recharts"
import { CalendarDays, Check, Link2, Minus, Plus, X } from "lucide-react"

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
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

type Drug = { halfLife: number; bioavailability: number; volumeOfDistribution: number; tmax: number; name: string }
// A step is a dose repeated `doses` times; layout() adds start/end (days, end-exclusive) and from/to (calendar weeks).
type Step = { dose: number; doses: number; pen?: number; clicks?: number; start?: number; end?: number; from?: number; to?: number }
type Plan = { start: string; weeks: number; drug: string; freq: number; clicks: boolean; gold: boolean; pens: { strength: number }[]; steps: Step[] }
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
  const penCap = PEN_CLICKS + (plan.gold ? CLICKS : 0)
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
  const dayRange = (a: number, b: number) => (Math.floor(a) === Math.floor(b) ? dayLabel(a) : `${dayLabel(a)} – ${dayLabel(b)}`)

  // ---- One step as a table row; clicks mode gets − / slider / +, mg mode a number field.
  function stepRow(i: number) {
    const s = steps[i], n = perStep[i].length
    const removable = steps.length > 1 && !(plan.clicks && steps.filter(x => x.pen === s.pen).length === 1)
    const setClicksTo = (c: number) => update(p => { p.steps[i].clicks = Math.min(CLICKS, Math.max(0, c)) })
    return (
      <TableRow key={i} className="max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto_auto_28px] max-sm:items-center max-sm:gap-x-3 max-sm:gap-y-3 max-sm:py-4 max-sm:*:p-0">
        <TableCell className={plan.clicks ? undefined : "max-[359px]:col-span-4"}>
          <div>Step {i + 1}</div>
          <div className="text-xs text-muted-foreground">{s.dose > 0 ? dayRange(s.start!, s.start! + (s.doses - 1) * plan.freq) : `Pause · ${dayRange(s.start!, s.end! - 1)}`}</div>
        </TableCell>
        <TableCell className={plan.clicks ? "max-sm:col-span-4 max-sm:col-start-1 max-sm:row-start-2" : undefined}>
          {plan.clicks ? (
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon-sm" className="relative text-muted-foreground after:absolute after:-inset-2 hover:text-foreground" aria-label={`Step ${i + 1}: one click less`} onClick={() => setClicksTo((s.clicks ?? 0) - 1)}><Minus /></Button>
              <Slider className="min-w-24" min={0} max={CLICKS} step={1} value={[s.clicks ?? 0]} onValueChange={([v]) => setClicksTo(v)} aria-label={`Step ${i + 1} clicks per dose`} />
              <Button variant="ghost" size="icon-sm" className="relative text-muted-foreground after:absolute after:-inset-2 hover:text-foreground" aria-label={`Step ${i + 1}: one click more`} onClick={() => setClicksTo((s.clicks ?? 0) + 1)}><Plus /></Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input type="number" min={0} step={0.05} className="w-16 text-end pointer-coarse:h-9 sm:w-28" defaultValue={mgFmt(s.dose)} aria-label={`Step ${i + 1} dose in mg`}
                onChange={e => { const v = +e.target.value; if (v >= 0) update(p => { p.steps[i].dose = v }) }} />
              <span className="text-xs text-muted-foreground sm:hidden" aria-hidden="true">mg</span>
            </div>
          )}
        </TableCell>
        <TableCell className={plan.clicks ? "text-end" : "text-end max-sm:hidden"}>
          {plan.clicks
            ? <><div className="font-semibold">{s.clicks} cl</div><div className="text-xs text-muted-foreground">{s.clicks ? `${mgFmt(s.dose)} mg` : "pause"}</div></>
            : <div className="font-semibold">{s.dose > 0 ? `${mgFmt(s.dose * n)} mg` : "pause"}</div>}
        </TableCell>
        <TableCell>
          <div className="flex items-center justify-center gap-2">
            <Input type="number" min={1} className="w-14 text-center pointer-coarse:h-9" value={s.doses} aria-label={`Step ${i + 1} number of doses`}
              onChange={e => { const v = Math.round(+e.target.value); if (v >= 1) update(p => { p.steps[i].doses = v }) }} />
            <span className="text-xs text-muted-foreground sm:hidden" aria-hidden="true">×</span>
          </div>
        </TableCell>
        <TableCell className="max-[359px]:col-start-4">
          {removable && <Button variant="ghost" size="icon-sm" className="relative text-muted-foreground after:absolute after:-inset-2 hover:text-foreground" aria-label={`Remove step ${i + 1}`} onClick={() => update(p => { p.steps.splice(i, 1) })}><X /></Button>}
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
            <TableHead className="w-24 text-center">Doses</TableHead>
            <TableHead className="w-14"><span className="sr-only">Remove</span></TableHead>
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

  // A step's label above the chart only shows when its band is wide enough for the text (≈7.5px per character at 13px),
  // so neighbouring labels never run into each other as the chart narrows.
  const bandLabel = (s: Step) => {
    const pen = plan.clicks && firstOfPen.indexOf(s) > 0 ? `Pen ${s.pen! + 1} · ` : ""
    const text = pen + (s.dose > 0 ? (plan.clicks ? `${s.clicks} cl` : `${mgFmt(s.dose)} mg`) : "pause")
    const px = (Math.min(s.end!, end) - s.start!) / end * plotWidth
    return px >= text.length * 7.5 + 12 ? text : ""
  }

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
          Sized by the card (container query), not the viewport. "Count golden dose" sits under the toggle it belongs to. */}
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
            {plan.clicks && (
              <div className="flex h-9 items-center gap-2 pointer-coarse:h-11">
                <Checkbox id="gold" checked={plan.gold} onCheckedChange={c => update(p => { p.gold = c === true })} />
                <Label htmlFor="gold">Count golden dose</Label>
              </div>
            )}
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
            <CardDescription>Sampled every 6 h{showToday ? " · amber line is today" : ""}{penStarts.length ? " · dashed lines are new pens" : ""}</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="aspect-auto h-80 w-full" ref={el => { if (el && Math.abs(el.clientWidth - 40 - plotWidth) > 4) setPlotWidth(el.clientWidth - 40) }}>
              <AreaChart data={data} margin={{ top: 24, left: 0, right: 8 }}>
                <CartesianGrid vertical={false} />
                {/* Step bands sit in their own layer below the grid and the curve. Recharts 3 orders a layer by mount order,
                    so without an explicit zIndex a band for a step added later was drawn over the curve. */}
                {steps.filter(s => s.start! < end).map((s, i) => (
                  <ReferenceArea key={i} zIndex={-150} x1={s.start!} x2={Math.min(s.end!, end)} fill={i % 2 ? "transparent" : "var(--band)"} fillOpacity={1} ifOverflow="hidden"
                    label={{ value: bandLabel(s), position: "insideTopLeft", fill: "var(--muted-foreground)", fontSize: 13, dy: -20 }} />
                ))}
                <XAxis dataKey="t" type="number" domain={[0, end]} ticks={ticks} tickFormatter={v => dayLabel(v)} tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis width={32} tickLine={false} axisLine={false} domain={[0, yMax]} ticks={yTicks} />
                <ChartTooltip content={<ChartTooltipContent indicator="line" labelFormatter={(_, p) => { const t = p?.[0]?.payload?.t as number; return `${dayLabel(t, true)} · day ${t}` }} formatter={v => `${Number(v ?? 0).toFixed(2)} mg`} />} />
                <Area dataKey="mg" type="linear" stroke="var(--color-mg)" fill="var(--color-mg)" fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
                {penStarts.map(s => <ReferenceLine key={s.pen} x={s.start!} stroke="var(--marker)" strokeWidth={1.5} strokeDasharray="3 4" />)}
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
              <CardFooter className="py-2">
                <Button variant="ghost" className="-ms-2.5" onClick={() => update(p => { p.steps.push({ ...p.steps[p.steps.length - 1], doses: 1 }) })}><Plus data-icon="inline-start" />Add step</Button>
              </CardFooter>
            </Card>
          ) : (
            <>
              {plan.pens.map((pen, pi) => {
                const own = steps.map((s, i) => [s, i] as const).filter(([s]) => s.pen === pi)
                const used = own.reduce((n, [s, i]) => n + (s.clicks ?? 0) * perStep[i].length, 0)
                const doses = own.reduce((n, [, i]) => n + perStep[i].length, 0)
                const left = penCap - used
                return (
                  <Card key={pi}>
                    <CardHeader>
                      <CardTitle>Pen {pi + 1}</CardTitle>
                      <CardDescription>{[`${pen.strength} mg KwikPen`, ...(own.length ? [weekSpan(own[0][0].from!, own[own.length - 1][0].to!), plural(doses, "dose")] : [])].map((t, k) => <span key={k}>{k ? " · " : ""}<span className="whitespace-nowrap">{t}</span></span>)}</CardDescription>
                      <CardAction className="flex items-center gap-2">
                        <Select value={String(pen.strength)} onValueChange={v => update(p => { p.pens[pi].strength = +v })}>
                          <SelectTrigger aria-label={`Pen ${pi + 1} strength`}><SelectValue /></SelectTrigger>
                          <SelectContent>{STRENGTHS.map(v => <SelectItem key={v} value={String(v)}>{v} mg</SelectItem>)}</SelectContent>
                        </Select>
                        {plan.pens.length > 1 && (
                          <Button variant="ghost" size="icon-sm" className="relative text-muted-foreground after:absolute after:-inset-2 hover:text-foreground" aria-label={`Remove pen ${pi + 1}`} onClick={() => update(p => {
                            p.steps = p.steps.filter(s => s.pen !== pi); p.steps.forEach(s => { if (s.pen! > pi) s.pen!-- }); p.pens.splice(pi, 1)
                          })}><X /></Button>
                        )}
                      </CardAction>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                      <div className="flex flex-col gap-3">
                        <Progress className={left < 0 ? "[&_[data-slot=progress-indicator]]:bg-destructive" : undefined} value={Math.min(100, (used / penCap) * 100)} aria-label={`Pen ${pi + 1} clicks used`} />
                        <div className={`flex flex-wrap justify-between gap-2 text-xs ${left < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                          <span><span className="font-semibold text-foreground">{used}</span> / {penCap} clicks used</span>
                          <span>{left >= 0 ? `${left} clicks left · ${mgFmt((left * pen.strength) / CLICKS)} mg` : `${-left} clicks over (${mgFmt((-left * pen.strength) / CLICKS)} mg short). Add a pen or move steps.`}</span>
                        </div>
                      </div>
                      {stepTable(own.map(([, i]) => i))}
                    </CardContent>
                    <CardFooter className="py-2">
                      <Button variant="ghost" className="-ms-2.5" onClick={() => update(p => {
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
