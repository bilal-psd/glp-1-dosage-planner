// The benzodiazepine plotter: the estimated blood level (ng/mL) over a plan of daily doses, with the half-life range as a
// shaded band. The maths and scheduling rules are in ../benzo-model.js; the plan is saved in localStorage
// "benzo-plotter:v1" and shared as a #plan= link. Same look and building blocks as the GLP-1 plotter (App.tsx).
import { useEffect, useMemo, useRef, useState } from "react"
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, XAxis, YAxis } from "recharts"
import { CalendarDays, Check, Download, FileText, Image as ImageIcon, Link2, Plus, Upload, X } from "lucide-react"

import * as B from "../../benzo-model.js"
import { cn } from "@/lib/utils"
import { type ExportData, PAPER_DOSE_COLOURS, PAPER_PAUSE, download, exportPdf, exportPng } from "@/lib/export"
import { CountField, MgField, Stepper } from "@/components/fields"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

type Drug = { name: string; brand: string; halfLife: number[]; tmax: number; F: number; vd: number; metabolite?: { name: string; halfLife: number[] } }
type Step = { mg: number[]; days: number; start?: number; end?: number }
type Plan = { start: string; weight: number; lb: boolean; drug: string; times: string[]; steps: Step[]; days: number }
type DoseEvent = { t: number; mg: number; step: number }
type Series = { t: Float64Array; parent: Float64Array; metabolite: Float64Array }

const DRUGS = B.BENZOS as Record<string, Drug>
const EXAMPLE = B.EXAMPLE as Plan
const cleanPlan = B.cleanPlan as (v: unknown) => Plan | null
const layout = B.layout as (steps: Step[]) => number
const doseEvents = B.doseEvents as (p: Plan) => DoseEvent[]
const simulate = B.simulate as (e: DoseEvent[], drug: string, kg: number, hours: number, v?: number, dt?: number) => Series
const levelAt = B.levelAt as (e: DoseEvent[], drug: string, kg: number, t: number, v?: number) => { parent: number; metabolite: number; total: number }
const hourOf = B.hourOf as (s: string) => number
const KEY = "benzo-plotter:v1", LB = 2.20462, DT = 0.25
// Shown under the header, at the bottom of the page, and in the PNG and on every PDF page.
const DISCLAIMER = "Estimate from a one-compartment population model, not a measurement, and not medical advice. Don't stop or lower a benzodiazepine on your own: stopping suddenly can cause seizures."

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
// Benzo doses come in quarters of a tablet (0.125 mg), so three decimals.
const mg3 = (v: number) => (+v).toFixed(3).replace(/\.?0+$/, "")
const ng = (v: number) => (v < 10 ? v.toFixed(1) : Math.round(v).toString())
const hrs = (h: number) => (h < 10 ? h.toFixed(1).replace(/\.0$/, "") : Math.round(h).toString())
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`
const dayTotal = (s: Step) => s.mg.reduce((a, b) => a + b, 0)
const planJson = (p: Plan) => ({ start: p.start, weight: p.weight, lb: p.lb, drug: p.drug, times: p.times, days: p.days, steps: p.steps.map(({ mg, days }) => ({ mg, days })) })
const blankPlan = (): Plan => ({ ...structuredClone(EXAMPLE), start: isoDay(new Date()) })
// A round step for the y axis: 1, 2, 2.5 or 5 × 10^n, about five ticks up to max.
const niceStep = (max: number) => { const raw = Math.max(max, 0.1) / 5, p = 10 ** Math.floor(Math.log10(raw)); return p * ([1, 2, 2.5, 5, 10].find(m => m * p >= raw) ?? 10) }

// Load: a share link (#plan=…), then what this browser saved, then the example.
function initialPlan(): { plan: Plan; notes: string[] } {
  const notes: string[] = []
  const m = location.hash.match(/plan=([\w-]+)/)
  if (m) {
    try {
      const p = cleanPlan(JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, "+").replace(/_/g, "/"))))))
      if (p) return { plan: p, notes }
    } catch { /* reported below */ }
    notes.push("That share link couldn't be read, so your saved plan is shown instead.")
  }
  try {
    const p = cleanPlan(JSON.parse(localStorage.getItem(KEY) ?? "null"))
    if (p) return { plan: p, notes }
  } catch { /* fall through */ }
  return { plan: blankPlan(), notes }
}

export default function BenzoApp() {
  const [{ plan: first, notes: firstNotes }] = useState(initialPlan)
  const [plan, setPlan] = useState<Plan>(first)
  const [notes, setNotes] = useState<string[]>(firstNotes)
  const [copied, setCopied] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  const [plotWidth, setPlotWidth] = useState(0)
  const [pendingImport, setPendingImport] = useState<{ plan: Plan; name: string } | null>(null)
  const [importName, setImportName] = useState("")
  const [busy, setBusy] = useState<"" | "pdf" | "png">("")
  const [openedAt] = useState(() => Date.now())  // "now" for the chart and summary: when the page was opened
  const fileRef = useRef<HTMLInputElement>(null)
  const chartRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (location.search || location.hash) history.replaceState(null, "", location.pathname) }, [])
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(planJson(plan))) } catch { /* private mode */ } }, [plan])
  useEffect(() => {
    const el = chartRef.current
    if (!el) return
    const measure = () => setPlotWidth(el.clientWidth - 48)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Every edit goes through here: copy, change, then clean (which also stretches the chart to fit the steps).
  const update = (fn: (p: Plan) => void) => setPlan(prev => { const p = structuredClone(prev); fn(p); return cleanPlan(p) ?? prev })

  const drug = DRUGS[plan.drug], hasMet = !!drug.metabolite
  const calc = useMemo(() => {
    const steps = structuredClone(plan.steps)
    layout(steps)
    const events = doseEvents(plan), hours = plan.days * 24
    // Typical half-life, then the short and long ends of the range, every 15 minutes.
    const [lo, typ, hi] = [0, 1, 2].map(v => simulate(events, plan.drug, plan.weight, hours, v, DT))
    const n = typ.t.length, total = (s: Series, i: number) => s.parent[i] + s.metabolite[i]
    let peak = 0
    for (let i = 1; i < n; i++) if (total(typ, i) > total(typ, peak)) peak = i
    // The chart gets at most ~1200 points: each bucket of samples gives its lowest and highest point, in time order, so
    // the daily swing still shows on a long chart. The band spans the bucket's lowest low and highest high.
    const size = Math.max(1, Math.ceil(n / 600)), data: { t: number; total: number; parent: number; range: [number, number] }[] = []
    let rangeHi = 0
    for (let a = 0; a < n; a += size) {
      const b = Math.min(n, a + size)
      let iMin = a, iMax = a, rLo = Infinity, rHi = 0
      for (let i = a; i < b; i++) {
        const v = total(typ, i)
        if (v < total(typ, iMin)) iMin = i
        if (v > total(typ, iMax)) iMax = i
        rLo = Math.min(rLo, total(lo, i), total(hi, i), v); rHi = Math.max(rHi, total(lo, i), total(hi, i), v)
      }
      rangeHi = Math.max(rangeHi, rHi)
      for (const i of size === 1 || iMin === iMax ? [iMin] : [Math.min(iMin, iMax), Math.max(iMin, iMax)])
        data.push({ t: typ.t[i] / 24, total: +total(typ, i).toFixed(3), parent: +typ.parent[i].toFixed(3), range: [+rLo.toFixed(3), +rHi.toFixed(3)] })
    }
    // Each day's average level, then each week's: what a taper looks like week by week.
    const perDay = Math.round(24 / DT), weeks: { week: number; from: number; to: number; mean: number; low: number; high: number; mgPerDay: number }[] = []
    for (let w = 0; w * 7 < plan.days; w++) {
      const from = w * 7, to = Math.min(plan.days, from + 7)
      let sum = 0, count = 0, low = Infinity, high = 0
      for (let i = from * perDay; i < Math.min(n, to * perDay); i++) { const v = total(typ, i); sum += v; count++; low = Math.min(low, v); high = Math.max(high, v) }
      const mg = events.filter(e => e.t >= from * 24 && e.t < to * 24).reduce((s, e) => s + e.mg, 0)
      weeks.push({ week: w + 1, from, to, mean: count ? sum / count : 0, low: count ? low : 0, high, mgPerDay: mg / (to - from) })
    }
    // Now, in hours from midnight on the start date, and the level then (low and high from the half-life range).
    const startMs = +new Date(plan.start + "T00:00"), nowH = isNaN(startMs) ? null : (openedAt - startMs) / 36e5
    const v = nowH == null || nowH < 0 ? [0, 0, 0] : [0, 1, 2].map(k => levelAt(events, plan.drug, plan.weight, nowH, k).total)
    const now = nowH == null ? null : { total: v[1], lo: Math.min(...v), hi: Math.max(...v) }
    return { steps, events, data, peak: { t: typ.t[peak], v: total(typ, peak) }, rangeHi, weeks, nowH, now }
  }, [plan, openedAt])

  const { steps, events, data, peak, rangeHi, weeks, nowH, now } = calc
  const end = plan.days
  const dateAt = (day: number) => { const d = new Date(plan.start + "T00:00"); if (isNaN(+d)) return null; d.setDate(d.getDate() + Math.floor(day)); return d }
  const dayLabel = (day: number, long = false, loc?: string) => dateAt(day)?.toLocaleDateString(loc, long ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short" }) ?? `Day ${Math.floor(day) + 1}`
  const timeLabel = (h: number, loc?: string) => new Date(2000, 0, 1, Math.floor(h), Math.round((h % 1) * 60)).toLocaleTimeString(loc, { hour: "numeric", minute: "2-digit" })
  const dayRange = (a: number, b: number, loc?: string) => {
    const x = dateAt(a), y = dateAt(b)
    if (Math.floor(a) === Math.floor(b) || !x || !y) return dayLabel(a, false, loc)
    const range = new Intl.DateTimeFormat(loc, { day: "numeric", month: "short" }).formatRange(x, y)
    return x.getMonth() === y.getMonth() && x.getFullYear() === y.getFullYear() ? range.replace(/\s*–\s*/, "–") : range
  }
  const startDate = dateAt(0) ?? undefined
  const next = nowH == null ? undefined : events.find(e => e.t >= nowH)
  const nextLabel = (t: number) => `${Math.floor(t / 24) === Math.floor(nowH! / 24) ? "today" : dayLabel(t / 24, true)}, ${timeLabel(t % 24)}`

  // ---- Settings handlers
  const setWeightShown = (v: number) => update(p => { p.weight = p.lb ? +(v / LB).toFixed(2) : v })
  const weightShown = plan.lb ? Math.round(plan.weight * LB) : Math.round(plan.weight)
  function addTime() {
    update(p => {
      const last = hourOf(p.times[p.times.length - 1]), h = (Math.floor(last) + 6) % 24
      p.times.push(`${String(h).padStart(2, "0")}:00`); p.steps.forEach(s => s.mg.push(0))
    })
  }
  const removeTime = (j: number) => update(p => { p.times.splice(j, 1); p.steps.forEach(s => s.mg.splice(j, 1)) })

  async function share() {
    const json = JSON.stringify(planJson(plan))
    const url = location.origin + location.pathname + "#plan=" + btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { prompt("Copy this link:", url) }
  }
  function resetAll() {
    try { localStorage.removeItem(KEY) } catch { /* private mode */ }
    setNotes([]); setPlan(blankPlan())
  }
  function exportJson() {
    const file = { app: "benzo-plotter", version: 1, plan: planJson(plan) }
    download(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }), `benzo-plan-${isoDay(new Date())}.json`)
  }
  async function readImport(f: File) {
    try {
      const v = JSON.parse(await f.text()), p = cleanPlan(v && typeof v === "object" && "plan" in v ? v.plan : v)
      if (!p) throw new Error()
      setImportName(f.name); setPendingImport({ plan: p, name: f.name })
    } catch { setNotes([`${f.name} isn't a plan file from this page, so nothing was changed.`]) }
  }
  async function runExport(kind: "pdf" | "png") {
    setBusy(kind)
    try { await (kind === "pdf" ? exportPdf : exportPng)(exportData()) }
    catch { setNotes([`The ${kind.toUpperCase()} couldn't be made. Try again, or try another browser.`]) }
    finally { setBusy("") }
  }
  const iconFade = "transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)]"
  const iconOn = "scale-100 opacity-100 blur-0", iconOff = "scale-[0.25] opacity-0 blur-[4px]"

  // ---- Chart
  const chartConfig = { total: { label: hasMet ? "Total" : drug.name, color: "var(--data)" }, parent: { label: drug.name, color: "var(--data)" } } satisfies ChartConfig
  const tickEvery = [1, 2, 7, 14, 28, 56, 91].find(k => end / k <= 8) ?? 182
  const ticks = Array.from({ length: Math.floor(end / tickEvery) + 1 }, (_, k) => k * tickEvery)
  const yStep = niceStep(rangeHi), yMax = Math.max(yStep, Math.ceil(rangeHi / yStep - 1e-9) * yStep)
  const yTicks = Array.from({ length: Math.round(yMax / yStep) + 1 }, (_, k) => +(k * yStep).toFixed(6))
  const today = nowH == null ? null : nowH / 24, showToday = today != null && today >= 0 && today <= end
  // Runs: consecutive steps with the same doses form one labelled stretch of the chart ("1 mg/day", or "none").
  const runs = steps.reduce<{ mg: number[]; start: number; end: number }[]>((acc, s) => {
    const last = acc[acc.length - 1]
    if (last && last.mg.join() === s.mg.join()) last.end = s.end!
    else acc.push({ mg: s.mg, start: s.start!, end: s.end! })
    return acc
  }, []).filter(r => r.start < end)
  const runText = (r: { mg: number[] }) => { const d = r.mg.reduce((a, b) => a + b, 0); return d > 0 ? `${mg3(d)} mg/day` : "none" }
  const runLabel = (r: { mg: number[]; start: number; end: number }) => { const text = runText(r); return (Math.min(r.end, end) - r.start) / end * plotWidth >= text.length * 7.5 + 12 ? text : "" }
  const halfLife = drug.halfLife, met = drug.metabolite
  const range = `${hrs(halfLife[0])}–${hrs(halfLife[2])} h`

  // ---- What the PDF and PNG show, in the light paper colours.
  function exportData(): ExportData {
    const loc = /^[\x20-\xff\u2009\u202f]*$/.test(new Date(2026, 8, 30).toLocaleDateString(undefined, { weekday: "short", month: "short" }) + timeLabel(20.5)) ? undefined : "en-GB"
    const full = (d: number) => dateAt(d)?.toLocaleDateString(loc, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) ?? `Day ${Math.floor(d) + 1}`
    const levels = [...new Set(runs.map(r => dayTotal(r as Step)).filter(d => d > 0))].sort((a, b) => a - b)
    return {
      title: `${drug.name} plan`,
      subtitle: `Estimated blood level (ng/mL) for ${weightShown} ${plan.lb ? "lb" : "kg"} · shaded: half-life ${range}${hasMet ? ` · dashed: ${drug.name.toLowerCase()} alone, the rest is ${met!.name.toLowerCase()}` : ""}`,
      made: `Made ${new Date().toLocaleDateString(loc, { day: "numeric", month: "short", year: "numeric" })}`,
      app: "Benzodiazepine plotter",
      chartLabel: "Estimated blood level (ng/mL)",
      dosesLabel: "Week by week",
      facts: [["Starts", full(0)], ["Dose times", plan.times.map(t => timeLabel(hourOf(t), loc)).join(", ")], ["Doses", `${events.length} · ${mg3(events.reduce((s, e) => s + e.mg, 0))} mg`], ["Highest", `${ng(peak.v)} ng/mL · ${dayLabel(peak.t / 24, false, loc)}`]],
      pts: data.map(d => [d.t, d.total]),
      pts2: hasMet ? data.map(d => [d.t, d.parent]) : undefined,
      range: data.map(d => [d.t, d.range[0], d.range[1]]),
      end, yMax, yTicks,
      xTicks: ticks.map(t => ({ t, label: dayLabel(t, false, loc) })),
      bands: runs.map(r => { const d = dayTotal(r as Step); return { start: r.start, end: r.end, fill: d > 0 ? PAPER_DOSE_COLOURS[levels.indexOf(d) % PAPER_DOSE_COLOURS.length] : PAPER_PAUSE, label: runText(r) } }),
      pens: [],
      steps: {
        head: ["Step", ...plan.times.map(t => timeLabel(hourOf(t), loc)), "Days", "Dates", "Per day"],
        right: [false, ...plan.times.map(() => true), true, false, true],
        widths: [5, ...plan.times.map(() => 8), 6, 16, 8],
        rows: steps.map((s, i) => [String(i + 1), ...s.mg.map(v => (v > 0 ? `${mg3(v)} mg` : "-")), String(s.days), dayRange(s.start!, s.end! - 1, loc), dayTotal(s) > 0 ? `${mg3(dayTotal(s))} mg` : "none"]),
      },
      doses: {
        head: ["Week", "Dates", "Dose per day", "Average level", "Lowest - highest", "Change"],
        right: [true, false, true, true, true, true],
        widths: [5, 16, 10, 10, 12, 8],
        rows: weeks.map((w, k) => [String(w.week), dayRange(w.from, w.to - 1, loc), `${mg3(w.mgPerDay)} mg`, `${ng(w.mean)} ng/mL`, `${ng(w.low)} - ${ng(w.high)}`, change(k)]),
      },
      disclaimer: DISCLAIMER,
      fileStem: `benzo-plan-${isoDay(new Date())}`,
    }
  }
  // A week's average level against the week before, as a percentage ("−12%").
  function change(k: number) {
    if (!k || weeks[k - 1].mean < 1e-6) return "-"
    const c = Math.round((weeks[k].mean / weeks[k - 1].mean - 1) * 100)
    return c === 0 ? "0%" : `${c > 0 ? "+" : "-"}${Math.abs(c)}%`
  }

  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-4 md:px-12 md:py-8">
      <header className="flex items-start justify-between gap-4 sm:items-center">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-4">
          <h1 className="text-2xl font-semibold tracking-tight">Benzodiazepine plotter</h1>
          <span className="text-xs text-muted-foreground">{drug.name} · {weightShown} {plan.lb ? "lb" : "kg"} · {plural(plan.days, "day")}</span>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild><Button variant="outline" className="shrink-0">Reset</Button></AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear everything?</AlertDialogTitle>
              <AlertDialogDescription>Your plan is deleted from this browser and you start again with a blank plan. Export a plan file first if you want to keep it.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={resetAll}>Clear everything</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </header>

      {/* Always shown: what the page is for, and the one rule that matters most with these drugs. */}
      <p className="max-w-[80ch] text-xs text-muted-foreground">
        For looking at a plan, not for making one. Blood levels of these drugs don't tell you how well they work, and tolerance changes that over time.
        Don't stop or lower a benzodiazepine on your own: stopping suddenly can cause seizures. Make any change with your prescriber.
      </p>

      {notes.length > 0 && (
        <Alert className="animate-in fade-in-0 slide-in-from-top-2 duration-200 ease-out">
          <AlertDescription className="flex items-start justify-between gap-4">
            <div className="space-y-1">{notes.map(n => <p key={n}>{n}</p>)}</div>
            <Button variant="ghost" size="icon" aria-label="Dismiss message" onClick={() => setNotes([])}><X /></Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Settings: two columns on phones, four once the card has room; dose times get their own row. */}
      <Card className="@container">
        <CardContent className="grid grid-cols-2 items-start gap-4 @lg:grid-cols-4 @lg:gap-6">
          <Field className="col-span-2 @lg:col-span-1">
            <FieldLabel>Medication</FieldLabel>
            <Select value={plan.drug} onValueChange={v => update(p => { p.drug = v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(DRUGS).map(([k, v]) => <SelectItem key={k} value={k}>{v.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field className="col-span-2 @lg:col-span-1">
            <FieldLabel htmlFor="start">Start date</FieldLabel>
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
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor="weight">Weight</FieldLabel>
              <ToggleGroup type="single" size="sm" variant="outline" spacing={0} className="-my-1 h-6 [&>*]:h-6 [&>*]:px-1.5 [&>*]:text-xs" value={plan.lb ? "lb" : "kg"} onValueChange={v => v && update(p => { p.lb = v === "lb" })}>
                <ToggleGroupItem value="kg">kg</ToggleGroupItem>
                <ToggleGroupItem value="lb">lb</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <Stepper id="weight" value={weightShown} step={1} min={plan.lb ? 66 : 30} max={plan.lb ? 550 : 250} unit={plan.lb ? ["lb", "lb", "lb"] : ["kg", "kg", "kg"]} onChange={setWeightShown} />
          </Field>
          <Field>
            <FieldLabel htmlFor="len">Chart length</FieldLabel>
            <Stepper id="len" value={plan.days} step={1} min={steps[steps.length - 1].end ?? 1} max={730} unit={["day", "days", "d"]} onChange={v => update(p => { p.days = v })} />
          </Field>
          <Field className="col-span-2 @lg:col-span-4">
            <FieldLabel>Dose times</FieldLabel>
            <div className="flex flex-wrap items-center gap-2">
              {plan.times.map((t, j) => (
                <div key={j} className="flex items-center">
                  <Input type="time" className="w-36" value={t} aria-label={`Dose time ${j + 1}`} onChange={e => { const v = e.target.value; if (v) update(p => { p.times[j] = v }) }} />
                  {plan.times.length > 1 && <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" aria-label={`Remove dose time ${j + 1}`} onClick={() => removeTime(j)}><X /></Button>}
                </div>
              ))}
              {plan.times.length < B.MAX_TIMES && <Button variant="ghost" onClick={addTime}><Plus data-icon="inline-start" />Add time</Button>}
            </div>
          </Field>
          <p className="col-span-2 text-xs text-muted-foreground @lg:col-span-4">
            {drug.name} ({drug.brand}): half-life about {hrs(halfLife[1])} h ({range} in healthy adults; longer in older people and with liver disease), peaks about {hrs(drug.tmax)} h after a dose.
            {met && ` Turns into ${met.name.toLowerCase()}, also active, with a half-life of about ${hrs(met.halfLife[1])} h (up to ${hrs(met.halfLife[2])} h); the chart includes it.`}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,640px)_minmax(0,1fr)]">
        <section className="@container xl:col-start-2" aria-label="Summary">
          <Card className="py-4">
            <CardContent className="grid gap-3 @lg:grid-cols-3 @lg:gap-6">
              {[
                [nowH == null ? "Now" : nowH < 0 ? "Now · before start" : "Now", now == null ? "—" : nowH! < 0 ? "0 ng/mL" : <>≈ {ng(now.total)} ng/mL <span className="font-normal text-muted-foreground">{ng(now.lo)}–{ng(now.hi)}</span></>],
                [next ? `Next dose · ${nextLabel(next.t)}` : "Next dose", next ? `${mg3(next.mg)} mg` : "None planned"],
                [`Highest · ${dayLabel(peak.t / 24, true)}`, `≈ ${ng(peak.v)} ng/mL`],
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
            <CardTitle className="text-xs font-semibold uppercase tracking-wider">Estimated blood level (ng/mL)</CardTitle>
            <CardDescription>
              Line: typical half-life · shaded: {range}{hasMet ? ` · dashed: ${drug.name.toLowerCase()} alone, the rest is ${met!.name.toLowerCase()}` : ""}{showToday ? " · amber line is now" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="aspect-auto h-80 w-full" ref={chartRef}>
              <ComposedChart data={data} margin={{ top: 24, left: 0, right: 8 }}>
                <CartesianGrid vertical={false} />
                {runs.map((r, i) => (
                  <ReferenceArea key={i} zIndex={-150} x1={r.start} x2={Math.min(r.end, end)} fill="transparent" ifOverflow="hidden"
                    label={{ value: runLabel(r), position: "insideTopLeft", fill: "var(--muted-foreground)", fontSize: 13, dy: -20 }} />
                ))}
                <XAxis dataKey="t" type="number" domain={[0, end]} ticks={ticks} tickFormatter={v => dayLabel(v)} tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis width={40} tickLine={false} axisLine={false} domain={[0, yMax]} ticks={yTicks} />
                <ChartTooltip content={({ active, payload }) => {
                  const d = active && payload?.[0]?.payload as (typeof data)[number] | undefined
                  if (!d) return null
                  return (
                    <div className="grid gap-1 rounded-lg border bg-popover px-3 py-2 text-xs shadow-xl">
                      <div className="font-medium">{dayLabel(d.t, true)}, {timeLabel((d.t * 24) % 24)}</div>
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">{hasMet ? "Total" : drug.name}</span><span>{ng(d.total)} ng/mL</span></div>
                      {hasMet && <div className="flex justify-between gap-4"><span className="text-muted-foreground">{drug.name}</span><span>{ng(d.parent)} ng/mL</span></div>}
                      {hasMet && <div className="flex justify-between gap-4"><span className="text-muted-foreground">{met!.name}</span><span>{ng(d.total - d.parent)} ng/mL</span></div>}
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Range</span><span>{ng(d.range[0])}–{ng(d.range[1])} ng/mL</span></div>
                    </div>
                  )
                }} />
                <Area dataKey="range" type="linear" stroke="none" fill="var(--data)" fillOpacity={0.16} isAnimationActive={false} activeDot={false} />
                {hasMet && <Line dataKey="parent" type="linear" stroke="var(--data)" strokeWidth={1.25} strokeDasharray="5 4" dot={false} activeDot={false} isAnimationActive={false} />}
                <Line dataKey="total" type="linear" stroke="var(--data)" strokeWidth={2} dot={false} isAnimationActive={false} />
                {showToday && <ReferenceLine x={today!} stroke="var(--today)" strokeWidth={2} />}
              </ComposedChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <section className="flex flex-col gap-6 xl:col-start-1 xl:row-span-3 xl:row-start-1" aria-label="Plan">
          <Card className="@container">
            <CardHeader>
              <CardTitle>Steps</CardTitle>
              <CardDescription>{plural(steps[steps.length - 1].end!, "day")} · {plural(events.length, "dose")}</CardDescription>
            </CardHeader>
            <CardContent>
              {/* Phones: what the step is and its days on one line, the doses below. Wider: one line per step. */}
              <ol className="flex flex-col">
                {steps.map((s, i) => (
                  <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b py-4 first:pt-0 last:border-b-0 @xl:grid-cols-[9rem_minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                      <div>Step {i + 1}</div>
                      <div className="text-xs text-muted-foreground"><span className="whitespace-nowrap">{dayRange(s.start!, s.end! - 1)} ·</span> <span className="whitespace-nowrap">{dayTotal(s) > 0 ? `${mg3(dayTotal(s))} mg/day` : "no doses"}</span></div>
                    </div>
                    <div className="col-span-2 flex flex-wrap gap-3 @xl:col-span-1">
                      {plan.times.map((t, j) => (
                        <label key={j} className="flex flex-col gap-1">
                          <span className="text-xs text-muted-foreground">{timeLabel(hourOf(t))}</span>
                          <span className="flex items-baseline gap-1.5">
                            <MgField className="w-20 sm:w-20" value={s.mg[j]} format={mg3} step={0.125} label={`Step ${i + 1} dose at ${timeLabel(hourOf(t))} in mg`} onChange={v => update(p => { p.steps[i].mg[j] = v })} />
                            <span className="text-xs text-muted-foreground" aria-hidden="true">mg</span>
                          </span>
                        </label>
                      ))}
                    </div>
                    <div className="col-start-2 row-start-1 flex justify-end @xl:col-start-3">
                      <CountField value={s.days} unit={s.days === 1 ? "day" : "days"} label={`Step ${i + 1} number of days`} onChange={v => update(p => { p.steps[i].days = v })}
                        onRemove={steps.length > 1 ? () => update(p => { p.steps.splice(i, 1) }) : undefined} removeLabel={`Remove step ${i + 1}`} />
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
            <CardFooter className="justify-center py-2">
              <Button variant="ghost" onClick={() => update(p => { const l = p.steps[p.steps.length - 1]; p.steps.push({ mg: [...l.mg], days: 7 }) })}><Plus data-icon="inline-start" />Add step</Button>
            </CardFooter>
          </Card>
        </section>

        <Card className="xl:col-start-2">
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-wider">Week by week</CardTitle>
            <CardDescription>Average estimated level each week in ng/mL, typical half-life</CardDescription>
          </CardHeader>
          <CardContent>
            <Table className="text-xs [&_td]:py-3.5 max-sm:[&_td]:px-1 max-sm:[&_th]:px-1">
              <TableHeader>
                <TableRow>
                  <TableHead>Week</TableHead>
                  <TableHead className="text-end">mg/day</TableHead>
                  <TableHead className="text-end">Average<span className="max-sm:hidden"> (ng/mL)</span></TableHead>
                  <TableHead className="text-end max-sm:hidden">Lowest–highest</TableHead>
                  <TableHead className="text-end">Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {weeks.map((w, k) => {
                  const current = today != null && today >= w.from && today < w.to
                  return (
                    <TableRow key={k} className={current ? "bg-[var(--today-soft)]" : undefined}>
                      <TableCell className="whitespace-normal">{w.week}<div className="text-muted-foreground">{dayRange(w.from, w.to - 1)}</div></TableCell>
                      <TableCell className="text-end">{mg3(w.mgPerDay)}</TableCell>
                      <TableCell className="text-end">{ng(w.mean)}</TableCell>
                      <TableCell className="text-end max-sm:hidden">{ng(w.low)}–{ng(w.high)}</TableCell>
                      <TableCell className="text-end">{change(k).replace("-", "−")}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <footer className="border-t pt-4">
        <div className="flex flex-wrap gap-x-2 gap-y-1 sm:-mx-3 max-sm:grid max-sm:grid-cols-2 max-sm:gap-2 [&>button]:text-xs [&>button]:text-muted-foreground [&>button]:hover:text-foreground max-sm:[&>button]:h-10 max-sm:[&>button]:justify-start max-sm:[&>button]:border max-sm:[&>button]:border-border max-sm:[&>button:last-child]:col-span-2">
          <Button variant="ghost" size="sm" disabled={busy !== ""} onClick={() => runExport("pdf")}><FileText data-icon="inline-start" />{busy === "pdf" ? "Making PDF…" : "Export PDF"}</Button>
          <Button variant="ghost" size="sm" disabled={busy !== ""} onClick={() => runExport("png")}><ImageIcon data-icon="inline-start" />{busy === "png" ? "Making PNG…" : "Export chart (PNG)"}</Button>
          <Button variant="ghost" size="sm" onClick={exportJson}><Download data-icon="inline-start" />Export plan (JSON)</Button>
          <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}><Upload data-icon="inline-start" />Import plan (JSON)</Button>
          <Button variant="ghost" size="sm" onClick={share}>
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
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) readImport(f) }} />
        <AlertDialog open={!!pendingImport} onOpenChange={o => { if (!o) setPendingImport(null) }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Replace your plan?</AlertDialogTitle>
              <AlertDialogDescription>The plan in {importName} replaces the one you have now.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { if (pendingImport) { setNotes([]); setPlan(pendingImport.plan) } setPendingImport(null) }}>Replace</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <p className="mt-4 text-xs text-muted-foreground">{DISCLAIMER}</p>
        <p className="mt-2 text-xs text-muted-foreground"><a className="underline underline-offset-4 hover:text-foreground" href="../">GLP-1 plotter</a></p>
      </footer>
    </main>
  )
}
