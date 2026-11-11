// The GLP-1 plotter, built from shadcn/ui components. The maths and scheduling rules are in ../model.js; the plan is saved
// in localStorage "glp1-plotter:v1" and shared as a #plan= link.
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts"
import { CalendarDays, Check, Download, FileText, Image as ImageIcon, Info, Link2, Minus, Plus, Trash2, Upload, X } from "lucide-react"

import * as M from "../../model.js"
import { cn } from "@/lib/utils"
import { type ExportData, PAPER_AFTER, PAPER_DOSE_COLOURS, PAPER_PAUSE, download, exportPdf, exportPng } from "@/lib/export"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
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
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

type Drug = { halfLife: number; bioavailability: number; volumeOfDistribution: number; tmax: number; name: string }
// A step is a dose repeated `doses` times, every `freq` days (the plan's interval when unset); layout() adds start/end
// (days, end-exclusive) and from/to (calendar weeks).
type Step = { dose: number; doses: number; freq?: number; pen?: number; clicks?: number; start?: number; end?: number; from?: number; to?: number }
type Plan = { start: string; weeks: number; drug: string; freq: number; clicks: boolean; gold: boolean; pens: { strength: number; gold?: boolean }[]; steps: Step[] }
type DoseEvent = { t: number; dose: number }

const DRUGS = M.DRUGS as Record<string, Drug>
const { TIRZ, CLICKS, PEN_CLICKS, STRENGTHS } = M
const EXAMPLE = M.EXAMPLE as Plan
const doseEvents = M.doseEvents as (s: Step, freq: number, weeks: number) => DoseEvent[]
const simulate = M.simulate as (e: DoseEvent[], drug: string, weeks: number) => [number, number][]
const amountBefore = M.amountBefore as (e: DoseEvent[], drug: string, t: number) => number
const stack = M.layout as (steps: Step[], freq: number) => number
const stepFreq = M.stepFreq as (s: Step, freq: number) => number
const upgradePlan = M.upgradePlan as (p: Plan) => Plan
const KEY = "glp1-plotter:v1"
// Shown once at the bottom of the page, and in the PNG and on every PDF page.
// Footer word-links (credit, Privacy & disclaimer): quiet grey, underlined so they read as links.
const footLink = "rounded-sm underline decoration-muted-foreground/40 underline-offset-3 transition-colors outline-none hover:text-foreground hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
const DISCLAIMER ="Estimate from a one-compartment model with glapp.io's drug constants. Not a measurement, and not medical advice."

// Six steps of the data teal (OKLCH hue 182), deep to light, for the area under the curve; kept darker than the curve itself.
const DOSE_COLOURS = Array.from({ length: 6 }, (_, i) => { const f = i / 5; return `oklch(${(0.36 + 0.30 * f).toFixed(3)} ${(0.055 + 0.045 * f).toFixed(3)} 182)` })
const NO_DOSE_COLOUR = "#2a2b30", AFTER_COLOUR = "#1e2a29"
// Room right of the plot, enough for half of the last date label ("24 Oct"), which sits on the plot's right edge.
const PLOT_RIGHT = 20
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const mgFmt = (v: number) => (+v).toFixed(2).replace(/\.?0+$/, "")
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`
// The plan as plain JSON: what a share link carries and what a plan file holds (with a small wrapper).
const planJson = (plan: Plan) => ({ start: plan.start, weeks: plan.weeks, drug: plan.drug, freq: plan.freq, clicks: plan.clicks, gold: plan.gold, pens: plan.pens, steps: plan.steps.map(({ dose, doses, freq, pen, clicks }) => ({ dose, doses, freq, pen, clicks })) })
// What Reset leaves: today's date, one 2.5 mg dose every 7 days, entered in mg (user's choice: a blank plan, not the example).
const blankPlan = (): Plan => ({ start: isoDay(new Date()), weeks: 12, drug: TIRZ, freq: 7, clicks: false, gold: false, pens: [], steps: [{ dose: 2.5, doses: 1 }] })
// Stacks the steps and stretches the chart to fit them (never shrinks it). Clicks mode needs tirzepatide and a pen for
// every step; a plan that breaks either (an old or hand-made link or file) falls back to mg, which keeps every dose.
function fit(p: Plan) {
  if (p.clicks && (p.drug !== TIRZ || !Array.isArray(p.pens) || p.steps.some(s => !p.pens[s.pen ?? -1]))) p.clicks = false
  const total = stack(p.steps, p.freq)
  if (total > p.weeks) p.weeks = total
  return p
}
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

// Every fact on the page has its own box: a small label, the value, and an optional second line under it (a date,
// the mg beside a click count). Never several facts joined with dots in one line of text (user's request).
function Fact({ label, value, sub, warn, className }: { label: string; value: ReactNode; sub?: ReactNode; warn?: boolean; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-lg border px-3 py-2", warn && "border-destructive/40 bg-destructive/10", className)}>
      <div className={cn("text-xs text-muted-foreground", warn && "text-destructive")}>{label}</div>
      <div className={cn("font-medium tabular-nums", warn && "text-destructive")}>{value}</div>
      {sub != null && <div className={cn("text-xs text-muted-foreground tabular-nums", warn && "text-destructive/80")}>{sub}</div>}
    </div>
  )
}
// Short facts about a card (its weeks, its dose count) as chips under the title.
function Chips({ items }: { items: string[] }) {
  return <div className="flex flex-wrap gap-1.5">{items.map(t => <Badge key={t} variant="outline" className="font-normal text-muted-foreground tabular-nums">{t}</Badge>)}</div>
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

// The mg per dose of a step. Follows the plan when it changes from elsewhere (a removed step, Reset, Import), but not while
// the typed text already means that value ("2." stays "2."). An empty field changes nothing; on blur it shows the dose again.
function MgField({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const [draft, setDraft] = useState(mgFmt(value))
  const [shown, setShown] = useState(value)
  if (value !== shown) { setShown(value); if (draft === "" || +draft !== value) setDraft(mgFmt(value)) }
  return (
    <Input type="number" min={0} step={0.05} className="w-16 text-end pointer-coarse:h-9 sm:w-28" value={draft} aria-label={label}
      onChange={e => { setDraft(e.target.value); const v = +e.target.value; if (e.target.value !== "" && v >= 0) onChange(v) }}
      onBlur={() => setDraft(mgFmt(value))} />
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
  const btn = "grid size-7 shrink-0 place-items-center rounded-sm text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 pointer-coarse:size-9"
  return (
    <div className="@container flex h-9 w-full items-center rounded-lg border border-input bg-transparent ps-3 pe-1 text-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 pointer-coarse:h-11 dark:bg-muted">
      <label htmlFor={id} className="flex min-w-0 flex-1 cursor-text items-baseline gap-1">
        <input id={id} type="number" inputMode="decimal" min={min} max={max} step={step} value={draft}
          style={{ width: `${Math.max(draft.length, 1) + 0.25}ch` }}
          className="shrink-0 bg-transparent tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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

// A small filled tag for a fact about something: a pen's weeks, a step's dates, a dose's clicks. Filled, not outlined:
// outlines are kept for things you can change.
function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded-md bg-white/6 px-1.5 text-xs whitespace-nowrap text-muted-foreground tabular-nums", className)}>{children}</span>
}

// − or + in a step's tile. A press steps once; holding keeps stepping, faster the longer it's held (from 130 ms down to
// 30 ms a step), and stops at the limit, where the button is disabled. Enter or Space from the keyboard step once.
function HoldButton({ onStep, disabled, label, children }: { onStep: () => void; disabled?: boolean; label: string; children: ReactNode }) {
  const timer = useRef(0)
  const step = useRef(onStep)
  useEffect(() => { step.current = onStep })
  const stop = () => { clearTimeout(timer.current); timer.current = 0 }
  useEffect(() => { if (disabled) stop() }, [disabled])
  useEffect(() => stop, [])
  return (
    <button type="button" aria-label={label} disabled={disabled}
      className="grid h-[34px] touch-manipulation place-items-center text-muted-foreground transition-colors outline-none select-none hover:bg-white/7 hover:text-foreground focus-visible:bg-white/7 focus-visible:text-foreground active:bg-accent disabled:pointer-events-none disabled:opacity-35 pointer-coarse:h-10"
      onPointerDown={e => {
        if (e.button !== 0) return
        e.preventDefault(); step.current()
        let n = 0
        const tick = () => { step.current(); n++; timer.current = window.setTimeout(tick, Math.max(30, 130 - n * 10)) }
        timer.current = window.setTimeout(tick, 380)
      }}
      onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onBlur={stop} onContextMenu={e => e.preventDefault()}
      onClick={e => { if (e.detail === 0) step.current() }}>
      {children}
    </button>
  )
}

// A tile's value, typed in place: a tap selects it, Enter (or leaving it) keeps what was typed, Esc puts it back, ↑ and ↓
// nudge it. Nothing changes while typing, so "3." isn't rounded under the cursor. The field is as wide as its text (an
// invisible copy of the text sizes the grid cell both share), so the unit sits right after the number.
function TileValue({ value, label, onCommit, onNudge, className }: {
  value: string; label: string; onCommit: (v: number) => void; onNudge: (d: number) => void; className?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const fresh = useRef(false), cancel = useRef(false)
  const shown = draft ?? value
  return (
    <span className={cn("inline-grid shrink-0 self-start", className)}>
      <span aria-hidden="true" className="invisible col-start-1 row-start-1 pe-px whitespace-pre">{shown || "0"}</span>
      <input type="text" inputMode="decimal" enterKeyHint="done" autoComplete="off" size={1} aria-label={label} value={shown}
        className="col-start-1 row-start-1 w-0 min-w-full cursor-text border-b border-dashed border-input bg-transparent p-0 outline-none hover:border-muted-foreground focus:border-solid focus:border-foreground"
        onFocus={e => { setDraft(value); e.target.select(); fresh.current = true }}
        onMouseUp={e => { if (fresh.current) { e.preventDefault(); fresh.current = false } }}
        onChange={e => setDraft(e.target.value.replace(/[^\d.,]/g, ""))}
        onKeyDown={e => {
          if (e.key === "Enter") e.currentTarget.blur()
          else if (e.key === "Escape") { cancel.current = true; e.currentTarget.blur() }
          else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); onNudge(e.key === "ArrowUp" ? 1 : -1); setDraft(null) }
        }}
        onBlur={() => {
          const v = draft == null ? NaN : parseFloat(draft.replace(",", "."))
          if (!cancel.current && !isNaN(v) && draft !== value) onCommit(v)
          cancel.current = false; fresh.current = false; setDraft(null)
        }} />
    </span>
  )
}

// One of a step's three tiles: a label, the value, and − / + along the bottom (user's pick "E1"). Per dose is the wide one.
function Tile({ label, title, wide, onStep, canDown, canUp, what, children }: {
  label: string; title?: string; wide?: boolean; onStep: (d: number) => void; canDown: boolean; canUp: boolean; what: string; children: ReactNode
}) {
  return (
    <div title={title} className={cn("flex min-w-0 flex-col rounded-lg bg-white/[.045] pt-2 focus-within:ring-1 focus-within:ring-input focus-within:ring-inset", wide ? "px-2.5 @max-[21.5rem]/pen:px-2" : "px-2")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      {children}
      <div className={cn("mt-auto grid grid-cols-2 border-t border-white/8 [&>*+*]:border-l [&>*+*]:border-white/8 [&>:first-child]:rounded-bl-lg [&>:last-child]:rounded-br-lg", wide ? "-mx-2.5 @max-[21.5rem]/pen:-mx-2" : "-mx-2")}>
        <HoldButton label={`${what}: one fewer`} disabled={!canDown} onStep={() => onStep(-1)}><Minus className="size-3.5" strokeWidth={1.5} /></HoldButton>
        <HoldButton label={`${what}: one more`} disabled={!canUp} onStep={() => onStep(1)}><Plus className="size-3.5" strokeWidth={1.5} /></HoldButton>
      </div>
    </div>
  )
}

export default function App() {
  const [{ plan: first, notes: firstNotes }] = useState(initialPlan)
  const [plan, setPlan] = useState<Plan>(() => fit(first))
  const [notes, setNotes] = useState<string[]>(firstNotes)
  // Notes from a mode switch fade in; notes present at page load don't. Dismissing fades them out first.
  const [notesAnim, setNotesAnim] = useState<"none" | "in" | "out">("none")
  // Doses that switching to clicks couldn't dial exactly. Shown on their own step, not at the top of the page; each one
  // shows only while its step still has the clicks and pen strength it was rounded to, and they clear when steps move.
  const [dial, setDial] = useState<{ i: number; was: number; now: number; clicks: number; strength: number }[]>([])
  const [copied, setCopied] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  const [plotWidth, setPlotWidth] = useState(0)
  const [pendingImport, setPendingImport] = useState<{ plan: Plan; name: string } | null>(null)
  const [importName, setImportName] = useState("")  // kept after closing, so the dialog's text doesn't blank while it fades out
  const [busy, setBusy] = useState<"" | "pdf" | "png">("")
  const fileRef = useRef<HTMLInputElement>(null)
  const chartRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (location.search || location.hash) history.replaceState(null, "", location.pathname) }, [])

  // Every edit goes through here: copy, change, re-stack the steps, recompute mg from clicks.
  const update = (fn: (p: Plan) => void) => setPlan(prev => {
    const p = structuredClone(prev)
    fn(p)
    fit(p)
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
    // mg in the body just before each dose, for the doses table and the PDF (worked out once per plan, not per render).
    const before = new Map(events.map(e => [e, amountBefore(events, p.drug, e.t)]))
    return { steps: p.steps, perStep, events, pts, today, before }
  }, [plan])

  // The plot's width (chart minus the y axis) decides which dose labels fit; kept current as the window resizes.
  useEffect(() => {
    const el = chartRef.current
    if (!el) return
    const measure = () => setPlotWidth(el.clientWidth - 32 - PLOT_RIGHT)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(plan)) } catch { /* private mode */ } }, [plan])

  const dateAt = (day: number) => { const d = new Date(plan.start + "T00:00"); if (isNaN(+d)) return null; d.setDate(d.getDate() + Math.floor(day)); return d }
  const dayLabel = (day: number, long = false, loc?: string) => dateAt(day)?.toLocaleDateString(loc, long ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short" }) ?? `Day ${Math.floor(day)}`

  const { steps, perStep, events, pts, today, before } = calc
  const startDate = dateAt(0) ?? undefined
  const end = plan.weeks * 7
  const clicksAllowed = plan.drug === TIRZ
  // A pen holds 4 doses (240 clicks); counting its golden dose (per pen, off by default, not guaranteed) adds one more.
  const penCap = (pen: { gold?: boolean }) => PEN_CLICKS + (pen.gold ? CLICKS : 0)
  const next = today == null ? undefined : events.find(e => e.t >= Math.floor(today))
  const nextStep = next && steps[perStep.findIndex(l => l.includes(next))]
  const peak = pts.reduce((m, p) => (p[1] > m[1] ? p : m), [0, 0])
  // Clicks each pen's steps use (doses inside the chart), and whether any pen still has medicine in it.
  const penUsed = plan.clicks ? plan.pens.map((_, pi) => steps.reduce((n, s, i) => n + (s.pen === pi ? (s.clicks ?? 0) * perStep[i].length : 0), 0)) : []
  const penLeft = plan.pens.some((pen, pi) => penCap(pen) > penUsed[pi])
  // Each pen's span on the chart (its first step's start to its last step's end), for the pen row under the dates.
  const penSpans = plan.clicks ? plan.pens.flatMap((pen, pi) => {
    const own = steps.filter(s => s.pen === pi && s.start! < end)
    return own.length ? [{ pi, start: own[0].start!, end: Math.min(own[own.length - 1].end!, end), name: `Pen ${pi + 1}`, strength: `${pen.strength} mg` }] : []
  }) : []

  function setClicks(on: boolean) {
    if (on === plan.clicks || (on && !clicksAllowed)) return
    // Pure: the notes come from a dry run on the current plan, not from inside the setPlan updater (which may run twice).
    const convert = (p: Plan, msg: typeof dial) => {
      if (on) {
        if (!p.pens.length || p.steps.some(s => s.pen == null || !p.pens[s.pen])) {
          const max = Math.max(...p.steps.map(s => s.dose)), str = STRENGTHS.find(v => v >= max) ?? 15
          // No note: the pen card shows its strength, and its meter turns red with a hint if the steps don't fit (user's call).
          p.pens = [{ strength: str }]; p.steps.forEach(s => { s.pen = 0 })
        }
        const rounded = new Map<Step, number>()
        p.steps.forEach(s => {
          const str = p.pens[s.pen!].strength, before = s.dose
          s.clicks = M.toClicks(s.dose, str)
          if (Math.abs(M.clicksToMg(s.clicks!, str) - before) > 1e-6) rounded.set(s, before)
        })
        p.steps.sort((a, b) => a.pen! - b.pen!)
        // Indices after the sort, which is where the steps are shown.
        p.steps.forEach((s, i) => { if (rounded.has(s)) { const str = p.pens[s.pen!].strength; msg.push({ i, was: rounded.get(s)!, now: M.clicksToMg(s.clicks!, str), clicks: s.clicks!, strength: str }) } })
      }
      p.clicks = on
    }
    const msg: typeof dial = []
    convert(structuredClone(plan), msg)
    update(p => convert(p, []))
    setDial(msg)
  }
  // Adding or removing a step or pen moves steps to new indices, so the rounding notes go.
  const restructure = (fn: (p: Plan) => void) => { setDial([]); update(fn) }

  async function share() {
    const json = JSON.stringify(planJson(plan))
    const url = location.origin + location.pathname + "#plan=" + btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { prompt("Copy this link:", url) }
  }

  const note = (msg: string) => { setNotes([msg]); setNotesAnim("in") }
  function resetAll() {
    try { localStorage.removeItem(KEY) } catch { /* private mode */ }
    setNotes([]); setNotesAnim("none"); setDial([]); setPlan(blankPlan())
  }
  function exportJson() {
    const file = { app: "glp1-plotter", version: 1, plan: planJson(plan) }
    download(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }), `glp1-plan-${isoDay(new Date())}.json`)
  }
  // Import reads a plan file (or a bare plan object), then asks before replacing the current plan.
  async function readImport(f: File) {
    try {
      const v = JSON.parse(await f.text()), raw = v && typeof v === "object" && "plan" in v ? v.plan : v
      if (!valid(raw)) throw new Error()
      const p = upgradePlan({ ...structuredClone(EXAMPLE), ...raw })
      setImportName(f.name); setPendingImport({ plan: fit(p), name: f.name })
    } catch { note(`${f.name} isn't a plan file from this page, so nothing was changed.`) }
  }
  async function runExport(kind: "pdf" | "png") {
    setBusy(kind)
    try { await (kind === "pdf" ? exportPdf : exportPng)(exportData()) }
    catch { note(`The ${kind.toUpperCase()} couldn't be made. Try again, or try another browser.`) }
    finally { setBusy("") }
  }

  const iconFade = "transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)]"
  const iconOn = "scale-100 opacity-100 blur-0", iconOff = "scale-[0.25] opacity-0 blur-[4px]"

  const weekSpan = (a: number, b: number) => (a === b ? `Week ${a}` : `Weeks ${a}–${b}`)
  // "19 Sept", "5–12 Sept" within one month, "29 Aug – 5 Sept" across months.
  const dayRange = (a: number, b: number, loc?: string) => {
    if (Math.floor(a) === Math.floor(b)) return dayLabel(a, false, loc)
    const x = dateAt(a), y = dateAt(b)
    // The browser's own range format puts day and month in the locale's order; within one month the dash is closed up
    // ("5–12 Sept", "Sep 5–12"), across months it keeps its spaces ("29 Aug – 5 Sept").
    if (!x || !y) return `${dayLabel(a, false, loc)} – ${dayLabel(b, false, loc)}`
    const range = new Intl.DateTimeFormat(loc, { day: "numeric", month: "short" }).formatRange(x, y)
    return x.getMonth() === y.getMonth() && x.getFullYear() === y.getFullYear() ? range.replace(/\s*–\s*/, "–") : range
  }

  // ---- A step's days between doses: "every 7 days" under its Doses field, opening a stepper. It is the gap before each of
  // the step's doses, the first counted from the previous step's last dose (user's call). A step without its own interval
  // follows the plan's "Dose every" (and shows it muted); setting it back to the plan's value clears it.
  function intervalPicker(i: number) {
    const s = steps[i], own = s.freq != null, f = stepFreq(s, plan.freq)
    const setFreq = (v: number | null) => update(p => { if (v == null || v === p.freq) delete p.steps[i].freq; else p.steps[i].freq = v })
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label={`Step ${i + 1} days between doses: ${plural(f, "day")}${own ? "" : " (the plan's)"}`}
            className={cn("rounded-sm px-1 text-xs whitespace-nowrap underline decoration-dotted underline-offset-3 transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50", own ? "text-foreground" : "text-muted-foreground")}>
            every {plural(f, "day")}
          </button>
        </PopoverTrigger>
        <PopoverContent className="flex w-56 flex-col gap-3" align="end">
          <Field>
            <FieldLabel htmlFor={`freq-${i}`}>Step {i + 1}: dose every</FieldLabel>
            <Stepper id={`freq-${i}`} value={f} step={0.5} min={0.5} max={30} unit={["day", "days", "d"]} onChange={v => setFreq(v)} />
          </Field>
          <p className="text-xs text-muted-foreground">{i ? "Days before each of this step's doses, counted from the previous dose." : "Days between this step's doses."}{own ? "" : " Follows the plan's “Dose every” until you change it here."}</p>
          {own && <Button variant="outline" size="sm" onClick={() => setFreq(null)}>Use the plan's {plural(plan.freq, "day")}</Button>}
        </PopoverContent>
      </Popover>
    )
  }

  // ---- One step as a table row (mg mode; clicks mode uses penStep). No remove ×: at 1 dose the Doses field's − becomes a bin.
  function stepRow(i: number) {
    const s = steps[i], n = perStep[i].length
    const dates = s.dose > 0 ? dayRange(s.start!, s.start! + (s.doses - 1) * stepFreq(s, plan.freq)) : dayRange(s.start!, s.end! - 1)
    return (
      <TableRow key={i} className="max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_7.5rem] max-sm:items-center max-sm:gap-3 max-sm:py-4 max-sm:*:p-0">
        <TableCell className="max-sm:col-span-2">
          <div className="flex items-center gap-2">Step {i + 1}{s.dose > 0 ? null : <Badge variant="secondary" className="font-normal">Pause</Badge>}</div>
          <div className="text-xs text-muted-foreground">{dates}</div>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <MgField value={s.dose} label={`Step ${i + 1} dose in mg`} onChange={v => update(p => { p.steps[i].dose = v })} />
            <span className="text-xs text-muted-foreground sm:hidden" aria-hidden="true">mg</span>
          </div>
        </TableCell>
        <TableCell className="text-end max-sm:hidden">
          {/* The result of the inputs, so quieter than them: the step's total mg. */}
          {s.dose > 0 ? <div className="text-muted-foreground tabular-nums">{mgFmt(s.dose * n)} mg</div> : <div className="text-muted-foreground">–</div>}
        </TableCell>
        <TableCell>
          <div className="flex flex-col items-end gap-1">
            <CountField value={s.doses} unit={s.doses === 1 ? "dose" : "doses"} label={`Step ${i + 1} number of doses`} onChange={v => update(p => { p.steps[i].doses = v })}
              onRemove={steps.length > 1 ? () => restructure(p => { p.steps.splice(i, 1) }) : undefined} removeLabel={`Remove step ${i + 1}`} />
            {intervalPicker(i)}
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
            <TableHead>Dose (mg)</TableHead>
            <TableHead className="w-24 text-end">Total</TableHead>
            <TableHead className="w-36 text-end">Doses</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>{indices.map(stepRow)}</TableBody>
      </Table>
      </div>
    )
  }

  // A dose that couldn't be dialled exactly: said on its own step, with what was asked and what it is now.
  const dialNote = (rounded: (typeof dial)[number]) => (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 py-1.5 ps-3 pe-1 text-xs whitespace-normal">
      <Info className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
      <span className="text-muted-foreground">Rounded to the nearest click on a {rounded.strength} mg pen</span>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className="font-normal text-muted-foreground tabular-nums">Asked {mgFmt(rounded.was)} mg</Badge>
        <Badge variant="secondary" className="font-normal tabular-nums">Now {mgFmt(rounded.now)} mg</Badge>
      </div>
      <Button variant="ghost" size="icon-xs" className="ms-auto text-muted-foreground" aria-label="Dismiss" onClick={() => setDial(d => d.filter(x => x !== rounded))}><X /></Button>
    </div>
  )

  // ---- One step in a pen card (clicks mode). Top line: "Step N" with its bin, the dates as a tag at the right (user's
  // pick "swapped"). Then three tiles, each with − / + along its bottom and a value you can type (user's pick "E1"): Per
  // dose (wider, mg with the clicks as a tag on the same line, a bar for the share of a full 60-click dose; picks "W1"
  // and "G1"), Doses (with the step's total mg) and Every (just the days; no "from plan"). On a wide card the step is one
  // row: name, tiles, dates.
  function penStep(i: number, removable: boolean) {
    const s = steps[i], clicks = s.clicks ?? 0, f = stepFreq(s, plan.freq), strength = plan.pens[s.pen!].strength
    const dates = s.dose > 0 ? dayRange(s.start!, s.start! + (s.doses - 1) * f) : dayRange(s.start!, s.end! - 1)
    const rounded = dial.find(d => d.i === i && d.clicks === s.clicks && d.strength === strength)
    const setClicksTo = (fn: (c: number) => number) => update(p => { const t = p.steps[i]; t.clicks = Math.min(CLICKS, Math.max(0, Math.round(fn(t.clicks ?? 0)))) })
    const setDosesTo = (fn: (n: number) => number) => update(p => { const t = p.steps[i]; t.doses = Math.min(99, Math.max(1, Math.round(fn(t.doses)))) })
    // Half-day steps; the plan's own interval clears the step's, so it follows the plan again.
    const setFreqTo = (fn: (d: number) => number) => update(p => {
      const t = p.steps[i], v = Math.min(30, Math.max(0.5, Math.round(fn(stepFreq(t, p.freq)) * 2) / 2))
      if (v === p.freq) delete t.freq; else t.freq = v
    })
    const share = Math.round((clicks / CLICKS) * 100)
    return (
      <div key={i} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 border-t px-(--card-spacing) pt-3 pb-3.5 first:border-t-0 @[34rem]/pen:grid-cols-[8.5rem_minmax(0,1fr)] @[34rem]/pen:grid-rows-[auto_1fr] @[34rem]/pen:items-start @[34rem]/pen:gap-x-4 @[34rem]/pen:gap-y-1.5">
        <div className="flex min-w-0 items-center gap-1 @[34rem]/pen:-mt-0.5">
          <span className="font-semibold whitespace-nowrap">Step {i + 1}</span>
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" disabled={!removable}
            aria-label={`Remove step ${i + 1}`} title={removable ? `Remove step ${i + 1}` : "A pen keeps at least one step"}
            onClick={() => restructure(p => { p.steps.splice(i, 1) })}><Trash2 className="size-3.5" /></Button>
        </div>
        <Tag className="h-auto min-h-5 justify-self-end py-0.5 text-end text-balance whitespace-normal @[34rem]/pen:col-start-1 @[34rem]/pen:row-start-2 @[34rem]/pen:justify-self-start @[34rem]/pen:text-start">{dates}</Tag>
        <div className="col-span-2 grid grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_minmax(0,1fr)] gap-1.5 @max-[21.5rem]/pen:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)_minmax(0,1fr)] @max-[21.5rem]/pen:gap-1 @[34rem]/pen:col-span-1 @[34rem]/pen:col-start-2 @[34rem]/pen:row-span-2 @[34rem]/pen:row-start-1">
          <Tile wide label="Per dose" title={`${share}% of a full dose`} what={`Step ${i + 1} clicks per dose`} canDown={clicks > 0} canUp={clicks < CLICKS} onStep={d => setClicksTo(c => c + d)}>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-1 gap-y-1">
              <span className="flex min-w-0 items-baseline gap-[3px]">
                <TileValue className="text-xl leading-tight font-semibold @max-[21.5rem]/pen:text-lg" value={mgFmt(s.dose)} label={`Step ${i + 1} dose in mg`}
                  onCommit={v => setClicksTo(() => M.toClicks(v, strength))} onNudge={d => setClicksTo(c => c + d)} />
                <span className="text-[13px] text-muted-foreground">mg</span>
              </span>
              <Tag className="@max-[21.5rem]/pen:h-[18px] @max-[21.5rem]/pen:px-[5px] @max-[21.5rem]/pen:text-[11px]">{clicks ? `${clicks} cl` : "Pause"}</Tag>
            </div>
            <div className="mt-[7px] mb-2.5 h-1 overflow-hidden rounded-full bg-accent" role="meter" aria-label={`Step ${i + 1}: share of a full dose`} aria-valuenow={share} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-data" style={{ width: `${share}%` }} />
            </div>
          </Tile>
          <Tile label="Doses" what={`Step ${i + 1} number of doses`} canDown={s.doses > 1} canUp={s.doses < 99} onStep={d => setDosesTo(n => n + d)}>
            <TileValue className="leading-snug font-semibold" value={String(s.doses)} label={`Step ${i + 1} number of doses`}
              onCommit={v => setDosesTo(() => v)} onNudge={d => setDosesTo(n => n + d)} />
            <div className="mb-2 text-xs text-balance text-muted-foreground">{mgFmt(s.dose * s.doses)} mg total</div>
          </Tile>
          <Tile label="Every" what={`Step ${i + 1} days between doses`} canDown={f > 0.5} canUp={f < 30} onStep={d => setFreqTo(v => v + d * 0.5)}>
            <span className="mb-2 flex min-w-0 flex-wrap items-baseline gap-x-[3px]">
              <TileValue className="leading-snug font-semibold" value={mgFmt(f)} label={`Step ${i + 1} days between doses`}
                onCommit={v => setFreqTo(() => v)} onNudge={d => setFreqTo(v => v + d * 0.5)} />
              <span className="text-[13px] text-muted-foreground">{f === 1 ? "day" : "days"}</span>
            </span>
          </Tile>
        </div>
        {rounded && <div className="col-span-full">{dialNote(rounded)}</div>}
      </div>
    )
  }

  // ---- Chart
  const chartConfig ={ mg: { label: "In body", color: "var(--chart-1)" } } satisfies ChartConfig
  const data = pts.map(([t, v]) => ({ t, mg: +v.toFixed(3) }))
  // Date ticks a whole number of weeks apart, as many as fit (≈60px each) up to 9, so Recharts never has to drop one
  // and leave an uneven gap. The exports use their own fixed spacing.
  const tickSpan = (n: number) => { const every = 7 * Math.max(1, Math.ceil(plan.weeks / n)); return Array.from({ length: Math.floor(end / every) + 1 }, (_, k) => k * every) }
  const ticks = tickSpan(plotWidth > 0 ? Math.max(1, Math.min(8, Math.floor(plotWidth / 60) - 1)) : 8)
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
  // Each dose level's label (its colour swatch and mg) above the plot, starting where the level starts. A label may run past
  // its own band; if the label before it is in the way it slides right, else moves up to a second row. Labels near the
  // right edge move left to stay inside the plot. Only a label with no room on either row is left out (the tooltip still
  // names every dose). Width estimate: ≈7px per character at 12px, plus the swatch.
  const runLabels: { x: number; row: number; text: string; colour: string }[] = []
  if (plotWidth > 0) {
    const rowEnds = [-Infinity, -Infinity]
    for (const r of runs) {
      const text = r.dose > 0 ? `${mgFmt(r.dose)} mg` : "Pause", w = text.length * 7 + 14
      const x0 = Math.max(0, Math.min(r.start / end * plotWidth + 2, plotWidth - w))
      const limit = Math.min(plotWidth, Math.max(Math.min(r.end, end) / end * plotWidth - 2, x0 + w))
      for (let row = 0; row < rowEnds.length; row++) {
        const at = Math.max(x0, rowEnds[row])
        if (at + w <= limit) { runLabels.push({ x: at, row, text, colour: r.dose > 0 ? doseColour.get(r.dose)! : NO_DOSE_COLOUR }); rowEnds[row] = at + w + 8; break }
      }
    }
  }
  const twoRows = runLabels.some(l => l.row === 1)

  // ---- Dose rows
  const doseRows = steps.flatMap((s, i) => perStep[i].map(e => ({ e, s }))).sort((a, b) => a.e.t - b.e.t)
  const totalMg = events.reduce((n, e) => n + e.dose, 0)
  const totalClicks = plan.clicks ? doseRows.reduce((n, r) => n + (r.s.clicks ?? 0), 0) : 0

  // ---- Summary: Now, Next dose and Highest, each a value with the date it's for on its own line.
  // Before the start or once the medicine is gone, Now says so instead of showing ≈ 0.0 mg.
  const lastDose = events[events.length - 1]
  const nowMg = today == null || today < 0 ? 0 : amountBefore(events, plan.drug, today)
  const summary: { label: string; value: ReactNode; sub?: string }[] = [
    today == null ? { label: "Now", value: "–" }
      : today < 0 ? { label: "Now", value: "Not started", sub: `Starts ${dayLabel(0, true)}` }
      : lastDose && today > lastDose.t && nowMg < 0.05 ? { label: "Now", value: "Finished", sub: `Last dose ${dayLabel(lastDose.t, true)}` }
      : { label: "Now", value: `≈ ${nowMg.toFixed(1)} mg`, sub: new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) },
    !next ? { label: "Next dose", value: plan.clicks && !penLeft ? "None left" : "None planned" }
      : { label: "Next dose", sub: Math.floor(next.t) === Math.floor(today!) ? "Today" : dayLabel(next.t, true),
          value: plan.clicks ? <span className="flex flex-wrap items-center gap-x-1.5">{mgFmt(next.dose)} mg<Badge variant="outline" className="h-4 px-1.5 font-normal text-muted-foreground">{nextStep?.clicks} cl</Badge></span> : `${mgFmt(next.dose)} mg` },
    { label: "Highest", value: `≈ ${peak[1].toFixed(1)} mg`, sub: dayLabel(peak[0], true) },
  ]
  const addPen = () => restructure(p => {
    const l = p.steps[p.steps.length - 1]
    p.pens.push({ strength: p.pens[l.pen!].strength }); p.steps.push({ ...l, doses: 1, pen: p.pens.length - 1 })
  })

  // ---- What the PDF and PNG show: the same plan, chart and doses as the page, in the light paper colours.
  function exportData(): ExportData {
    // The PDF's Helvetica only draws Latin-1: dates in a locale that needs other letters (ja, ru, ar…) use British English.
    const loc = /^[\x20-\xff\u2009\u202f]*$/.test(new Date(2026, 8, 30).toLocaleDateString(undefined, { weekday: "short", month: "short" })) ? undefined : "en-GB"
    const full = (t: number) => dateAt(t)?.toLocaleDateString(loc, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) ?? `Day ${Math.floor(t)}`
    // Pen and its strength are two columns, not one "1 · 5 mg" cell.
    const pen = (s: Step) => [`Pen ${s.pen! + 1}`, `${plan.pens[s.pen!].strength} mg`]
    const last = runs[runs.length - 1]
    return {
      title: `${DRUGS[plan.drug].name}: dosing plan`,
      subtitle: "Estimated amount in the body",
      made: `Made ${new Date().toLocaleDateString(loc, { day: "numeric", month: "short", year: "numeric" })}`,
      facts: [["Starts", full(0)], steps.some(s => s.freq != null) ? ["Dose every", plural(plan.freq, "day"), "Some steps differ"] : ["Dose every", plural(plan.freq, "day")], ["Doses", String(events.length)], ["Total", `${mgFmt(totalMg)} mg`], ["Highest in body", `${peak[1].toFixed(1)} mg`, dayLabel(peak[0], true, loc)]],
      pts, end, yMax, yTicks,
      xTicks: tickSpan(8).map(t => ({ t, label: dayLabel(t, false, loc) })),
      bands: runs.map(r => ({ start: r.start, end: r.end, fill: r.dose > 0 ? PAPER_DOSE_COLOURS[DOSE_COLOURS.indexOf(doseColour.get(r.dose)!)] : PAPER_PAUSE, label: r.dose > 0 ? `${mgFmt(r.dose)} mg` : "pause" }))
        .concat(last && last.end < end ? [{ start: last.end, end, fill: PAPER_AFTER, label: "" }] : []),
      pens: penSpans.map(({ start, end, name, strength }) => ({ start, end, name, strength })),
      steps: {
        head: ["Step", ...(plan.clicks ? ["Pen", "Strength", "Clicks"] : []), "Per dose", "Doses", "Every", "Dates", "Total"],
        right: [false, ...(plan.clicks ? [false, true, true] : []), true, true, true, false, true],
        widths: [5, ...(plan.clicks ? [6, 7, 6] : []), 9, 7, 7, 18, 9],
        rows: steps.map((s, i) => [String(i + 1), ...(plan.clicks ? [...pen(s), String(s.clicks ?? 0)] : []), s.dose > 0 ? `${mgFmt(s.dose)} mg` : "Pause", String(s.doses), plural(stepFreq(s, plan.freq), "day"),
          s.dose > 0 ? dayRange(s.start!, s.start! + (s.doses - 1) * stepFreq(s, plan.freq), loc) : dayRange(s.start!, s.end! - 1, loc), s.dose > 0 ? `${mgFmt(s.dose * perStep[i].length)} mg` : "-"]),
      },
      doses: {
        head: ["Date", "Week", ...(plan.clicks ? ["Pen", "Strength", "Clicks"] : []), "Dose", "Level before dose"],
        right: [false, true, ...(plan.clicks ? [false, true, true] : []), true, true],
        widths: [14, 6, ...(plan.clicks ? [6, 7, 6] : []), 8, 12],
        rows: doseRows.map(({ e, s }) => [full(e.t), String(Math.floor(e.t / 7) + 1), ...(plan.clicks ? [...pen(s), String(s.clicks)] : []), `${mgFmt(e.dose)} mg`, `${before.get(e)!.toFixed(2)} mg`]),
      },
      disclaimer: DISCLAIMER,
      fileStem: `glp1-plan-${isoDay(new Date())}`,
    }
  }

  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-4 md:px-12 md:py-8">
      {/* Reset is the header's only control, top right on the title's line at every width (user's request). The title
          has no summary line under it: the settings card right below already shows the medication and length. */}
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">GLP-1 plotter</h1>
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

      {/* Page-level messages only (a share link or file that couldn't be read, an export that failed). A dose that
          couldn't be dialled exactly is said on its own step. */}
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

      {/* Settings: two columns on phones, four in a mid-width card, one row once everything fits. In the one row the
          fields share the width and the dose-entry toggle sits right after them, with no gap opening up before it.
          Sized by the card (container query), not the viewport. */}
      <Card className="@container">
        <CardContent className="grid grid-cols-2 items-start gap-4 @lg:grid-cols-4 @lg:gap-6 @[69rem]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_max-content]">
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
          {/* On the narrowest phones (card under 19rem) the two steppers take a row each: half a row can't hold the
              number, its unit and two touch-sized buttons. */}
          <Field className="@max-[19rem]:col-span-2">
            <FieldLabel htmlFor="freq">Dose every</FieldLabel>
            <Stepper id="freq" value={plan.freq} step={0.5} min={0.5} max={30} unit={["day", "days", "d"]} onChange={v => update(p => { p.freq = v })} />
          </Field>
          <Field className="@max-[19rem]:col-span-2">
            <FieldLabel htmlFor="len">Chart length</FieldLabel>
            <Stepper id="len" value={plan.weeks} step={1} min={steps[steps.length - 1].to ?? 1} max={104} unit={["week", "weeks", "wk"]} onChange={v => update(p => { p.weeks = v })} />
          </Field>
          <Field className="col-span-2 @[69rem]:col-span-1">
            <FieldLabel>Enter doses as</FieldLabel>
            <ToggleGroup className="grid grid-cols-[1fr_1fr]" type="single" variant="outline" spacing={0} value={plan.clicks ? "clicks" : "mg"} onValueChange={v => v && setClicks(v === "clicks")}>
              <ToggleGroupItem value="mg">mg</ToggleGroupItem>
              <ToggleGroupItem value="clicks" disabled={!clicksAllowed} title={clicksAllowed ? undefined : "KwikPen clicks are for tirzepatide KwikPens"}>KwikPen clicks</ToggleGroupItem>
            </ToggleGroup>
          </Field>
        </CardContent>
      </Card>

      {/* Below xl one column: summary, chart, plan, doses. At xl the plan and the doses are the left column and the
          summary and chart stay in view on the right while the plan scrolls, so neither column leaves a big gap. */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,680px)_minmax(0,1fr)]">

        <div className="flex flex-col gap-6 xl:sticky xl:top-8 xl:col-start-2 xl:row-span-2 xl:row-start-1">
          {/* Summary: three boxes, each a label, its value and the date it's for on a line of its own. Under 22rem (the
              narrowest phones) the boxes stack, label on the left and value over date on the right. */}
          <section className="@container/summary" aria-label="Summary">
            <div className="grid gap-2 @[22rem]/summary:grid-cols-3 sm:gap-4">
              {summary.map(({ label, value, sub }) => (
                <Card key={label} size="sm" className="gap-0.5 px-3 @max-[22rem]/summary:grid @max-[22rem]/summary:grid-cols-[1fr_auto] @max-[22rem]/summary:gap-x-4 sm:px-4">
                  <div className="text-xs text-muted-foreground @max-[22rem]/summary:row-span-2 @max-[22rem]/summary:self-center">{label}</div>
                  <div className="font-medium tabular-nums @max-[22rem]/summary:justify-self-end">{value}</div>
                  <div className={cn("text-xs text-muted-foreground tabular-nums @max-[22rem]/summary:text-end", sub == null && "@max-[22rem]/summary:hidden")}>{sub ?? "\u00a0"}</div>
                </Card>
              ))}
            </div>
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Estimated amount in body (mg)</CardTitle>
              {/* A key for what the colours mean, one item each; the mg of each level is above the plot. */}
              <CardDescription className="flex flex-wrap gap-x-4 gap-y-1">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[2px]" style={{ background: `linear-gradient(90deg, ${DOSE_COLOURS[0]}, ${DOSE_COLOURS[5]})` }} />Dose level</span>
                {runs.some(r => r.dose <= 0) && <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[2px]" style={{ background: NO_DOSE_COLOUR }} />Pause</span>}
                {showToday && <span className="flex items-center gap-1.5"><span className="h-2.5 w-0.5 rounded-full bg-[var(--today)]" />Today</span>}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Dose level labels: one or two rows above the plot (positions worked out in runLabels). Offsets match the
                  plot (y axis 32px, PLOT_RIGHT on the right). */}
              <div className={cn("relative", twoRows ? "h-11" : "h-6")} style={{ marginLeft: 32, marginRight: PLOT_RIGHT }} aria-label="Dose levels">
                {runLabels.map(l => (
                  <span key={`${l.x}-${l.text}`} className="absolute flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground tabular-nums" style={{ left: l.x, bottom: l.row * 20 + 2 }}>
                    <span className="size-2 rounded-[2px]" style={{ background: l.colour }} />{l.text}
                  </span>
                ))}
              </div>
              <ChartContainer config={chartConfig} className="aspect-auto h-80 w-full" ref={chartRef}>
                <AreaChart data={data} margin={{ top: 8, left: 0, right: PLOT_RIGHT }}>
                  <CartesianGrid vertical={false} />
                  <defs>
                    <linearGradient id="dose-fill" x1="0" y1="0" x2="1" y2="0">
                      {doseStops.map(([o, c], k) => <stop key={k} offset={o} style={{ stopColor: c }} />)}
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="t" type="number" domain={[0, end]} ticks={ticks} interval={0} tickFormatter={v => dayLabel(v)} tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis width={32} tickLine={false} axisLine={false} domain={[0, yMax]} ticks={yTicks} />
                  {/* Tooltip: one labelled row per fact (date, day, amount, the dose level at that time). */}
                  <ChartTooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const t = payload[0].payload.t as number, mg = payload[0].payload.mg as number
                    const r = runs.find(r => t >= r.start && t < r.end)
                    const rows: [string, string][] = [["Date", dayLabel(t, true)], ["Day", String(Math.floor(t))], ["In body", `${mg.toFixed(2)} mg`],
                      ["Dose", r ? (r.dose > 0 ? `${mgFmt(r.dose)} mg` : "Pause") : "After last dose"]]
                    return (
                      <dl className="grid min-w-40 grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
                        {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="text-end font-medium tabular-nums">{v}</dd></div>)}
                      </dl>
                    )
                  }} />
                  <Area dataKey="mg" type="linear" stroke="var(--color-mg)" fill="url(#dose-fill)" fillOpacity={1} strokeWidth={2} isAnimationActive={false} />
                  {showToday && <ReferenceLine x={today!} stroke="var(--today)" strokeWidth={2} />}
                </AreaChart>
              </ChartContainer>
              {/* Pens: a row under the dates, a hairline as wide as each pen's time in use with its name and a strength
                  chip below. Nothing on the plot itself, so the pens stay quiet. Offsets match the plot (y axis 32px,
                  PLOT_RIGHT on the right). Without room for the chip, just the name. */}
              {penSpans.length > 0 && (
                <div className="relative mt-1 h-7 text-xs text-muted-foreground" style={{ marginLeft: 32, marginRight: PLOT_RIGHT }} aria-label="Pens">
                  {penSpans.map(p => (
                    <div key={p.pi} className="absolute top-0 flex flex-col gap-1 overflow-hidden" style={{ left: `${p.start / end * 100}%`, width: `${(p.end - p.start) / end * 100}%` }}>
                      <div className="mx-px h-px bg-muted-foreground/40" />
                      <div className="flex items-center gap-1.5 ps-0.5">
                        <span className="truncate">{p.name}</span>
                        {(p.end - p.start) / end * plotWidth >= (p.name.length + p.strength.length) * 7 + 30 && <Badge variant="outline" className="h-4 px-1.5 font-normal text-muted-foreground">{p.strength}</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <section className="flex flex-col gap-6 xl:col-start-1 xl:row-start-1" aria-label="Plan">
          {!plan.clicks ? (
            <Card>
              <CardHeader>
                <CardTitle>Steps</CardTitle>
                <CardDescription><Chips items={[weekSpan(1, steps[steps.length - 1].to!), plural(events.length, "dose")]} /></CardDescription>
              </CardHeader>
              <CardContent>{stepTable(steps.map((_, i) => i))}</CardContent>
              <CardFooter className="justify-center py-2">
                <Button variant="ghost" onClick={() => restructure(p => { p.steps.push({ ...p.steps[p.steps.length - 1], doses: 1 }) })}><Plus data-icon="inline-start" />Add step</Button>
              </CardFooter>
            </Card>
          ) : (
            <>
              {plan.pens.map((pen, pi) => {
                const own = steps.map((s, i) => [s, i] as const).filter(([s]) => s.pen === pi)
                const used = penUsed[pi]
                const doses = own.reduce((n, [, i]) => n + perStep[i].length, 0)
                const cap = penCap(pen), left = cap - used, over = left < 0, n = cap / CLICKS
                const mgOf = (c: number) => `${mgFmt((c * pen.strength) / CLICKS)} mg`
                return (
                  <Card key={pi} className="@container/pen gap-0 py-0">
                    {/* The pen's own band, set apart from its steps by colour and a line: name and tags, remove ×, golden dose
                        and strength (user's pick "B2": their own row under the ×, at the right on a wide card), the meter. */}
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b bg-band p-(--card-spacing)">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
                        <CardTitle className="me-1">Pen {pi + 1}</CardTitle>
                        {/* The strength is the menu below, so the tags don't repeat it. */}
                        {own.length > 0 && <><Tag>{weekSpan(own[0][0].from!, own[own.length - 1][0].to!)}</Tag><Tag>{plural(doses, "dose")}</Tag></>}
                      </div>
                      {plan.pens.length > 1 ? (
                        <Button variant="ghost" size="icon-sm" className="relative -my-1 -me-1.5 justify-self-end text-muted-foreground after:absolute after:-inset-2 hover:text-foreground" aria-label={`Remove pen ${pi + 1}`} onClick={() => restructure(p => {
                          p.steps = p.steps.filter(s => s.pen !== pi); p.steps.forEach(s => { if (s.pen! > pi) s.pen!-- }); p.pens.splice(pi, 1)
                        })}><X /></Button>
                      ) : <span />}
                      <div className="col-span-2 flex items-center justify-between gap-3 @[26rem]/pen:justify-self-end">
                        <div className="flex items-center gap-2">
                          <Switch id={`gold-${pi}`} checked={!!pen.gold} onCheckedChange={c => update(p => { p.pens[pi].gold = c })} />
                          <Label htmlFor={`gold-${pi}`} className="text-xs font-normal whitespace-nowrap text-muted-foreground" title={`Counts the extra dose most pens hold (+${CLICKS} clicks); not guaranteed`}>Golden dose</Label>
                        </div>
                        <Select value={String(pen.strength)} onValueChange={v => update(p => { p.pens[pi].strength = +v })}>
                          <SelectTrigger className="w-36" aria-label={`Pen ${pi + 1} strength`}><SelectValue /></SelectTrigger>
                          <SelectContent>{STRENGTHS.map(v => <SelectItem key={v} value={String(v)}>{v} mg pen</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      {/* The meter: one segment per dose the pen holds (4, or 5 with the golden dose, whose segment is striped:
                          not guaranteed), then Used and Left (or Over by), each in clicks with its mg under it. */}
                      <div className="col-span-2 flex flex-col gap-2">
                        <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} role="meter" aria-label={`Pen ${pi + 1} clicks used`} aria-valuenow={used} aria-valuemin={0} aria-valuemax={cap}>
                          {Array.from({ length: n }, (_, k) => {
                            const fill = over ? 1 : Math.min(1, Math.max(0, (used - k * CLICKS) / CLICKS)), golden = !!pen.gold && k === n - 1
                            return (
                              <span key={k} title={golden ? "Golden dose" : `Dose ${k + 1}`} className={cn("block h-2 overflow-hidden rounded-[2px] bg-accent first:rounded-s-full last:rounded-e-full", golden && "bg-[repeating-linear-gradient(135deg,var(--accent)_0_3px,#3a3b42_3px_6px)]")}>
                                <span className={cn("block h-full", over ? "bg-destructive" : "bg-data")} style={{ width: `${fill * 100}%` }} />
                              </span>
                            )
                          })}
                        </div>
                        <div className="flex justify-between gap-4 tabular-nums">
                          <div><div className="text-xs text-muted-foreground">Used</div><div className="font-semibold">{used} of {cap} cl</div><div className="text-xs text-muted-foreground">{mgOf(used)}</div></div>
                          <div className={cn("text-end", over && "text-destructive")}>
                            <div className={cn("text-xs", !over && "text-muted-foreground")}>{over ? "Over by" : "Left"}</div>
                            <div className="font-semibold">{Math.abs(left)} cl</div>
                            <div className={cn("text-xs", !over && "text-muted-foreground")}>{mgOf(Math.abs(left))}{over ? " short" : ""}</div>
                          </div>
                        </div>
                        {over && (
                          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 py-1 ps-3 pe-1 text-xs text-destructive">
                            <span>More than this pen holds</span>
                            <Button variant="outline" size="sm" className="text-foreground" onClick={addPen}><Plus data-icon="inline-start" />Add pen</Button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div>{own.map(([, i]) => penStep(i, own.length > 1))}</div>
                    <CardFooter className="justify-center py-2">
                      <Button variant="ghost" onClick={() => restructure(p => {
                        const mine = p.steps.filter(s => s.pen === pi), l = mine[mine.length - 1]
                        p.steps.splice(p.steps.indexOf(l) + 1, 0, { ...l, doses: 1 })
                      })}><Plus data-icon="inline-start" />Add step</Button>
                    </CardFooter>
                  </Card>
                )
              })}
              <Button variant="outline" onClick={addPen}><Plus data-icon="inline-start" />Add pen</Button>
            </>
          )}
        </section>

        <Card className="xl:col-start-1 xl:row-start-2">
          <CardHeader>
            <CardTitle>Doses</CardTitle>
            <div className={cn("mt-2 grid gap-2", plan.clicks ? "grid-cols-3" : "grid-cols-2")}>
              <Fact label="Doses" value={events.length} />
              {plan.clicks && <Fact label="Clicks" value={totalClicks} />}
              <Fact label="Total" value={`${mgFmt(totalMg)} mg`} />
            </div>
          </CardHeader>
          <CardContent>
            {/* Phones in clicks mode swap Week for Clicks, so each dose stays one line. */}
            <Table className="text-xs [&_td]:py-3.5">
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className={cn("text-end", plan.clicks ? "max-sm:hidden" : "max-[359px]:hidden")}>Week</TableHead>
                  {plan.clicks && <><TableHead className="max-sm:hidden">Pen</TableHead><TableHead className="text-end">Clicks</TableHead></>}
                  <TableHead className="text-end">Dose</TableHead>
                  <TableHead className="text-end max-sm:whitespace-normal">Level before dose</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {doseRows.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No doses in this plan.</TableCell></TableRow>}
                {doseRows.map(({ e, s }, k) => {
                  const past = today != null && e.t < Math.floor(today), isNext = next === e
                  return (
                    <TableRow key={k} className={isNext ? "bg-[var(--today-soft)]" : past ? "text-muted-foreground" : undefined}>
                      <TableCell className={isNext ? "font-semibold" : undefined}>
                        <div className="flex items-center gap-2">{dayLabel(e.t, true)}{isNext && <Badge variant="outline" className="border-[var(--today)] font-normal text-[var(--today)]">Next</Badge>}</div>
                      </TableCell>
                      <TableCell className={cn("text-end", plan.clicks ? "max-sm:hidden" : "max-[359px]:hidden")}>{Math.floor(e.t / 7) + 1}</TableCell>
                      {plan.clicks && <>
                        <TableCell className="max-sm:hidden"><div className="flex items-center gap-1.5">Pen {s.pen! + 1}<Badge variant="outline" className="h-4 px-1.5 font-normal text-muted-foreground">{plan.pens[s.pen!].strength} mg</Badge></div></TableCell>
                        <TableCell className="text-end tabular-nums">{s.clicks}</TableCell>
                      </>}
                      <TableCell className="text-end tabular-nums">{mgFmt(e.dose)} mg</TableCell>
                      <TableCell className="text-end tabular-nums">{before.get(e)!.toFixed(2)} mg</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      {/* Share, export and import: a quiet footer under everything (user's pick "B"), since they're rarely used.
          Phones: a two-column grid of outlined buttons, the last one full width. */}
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
              <AlertDialogAction onClick={() => { if (pendingImport) { setNotes([]); setNotesAnim("none"); setDial([]); setPlan(pendingImport.plan) } setPendingImport(null) }}>Replace</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {/* The short medical line stays visible; the full disclaimer and the privacy note open in a dialog from a word-link
            (user's choice: a link, not a seventh footer button). The exports keep the full DISCLAIMER line. */}
        <p className="mt-4 text-xs text-muted-foreground">Estimate only, not medical advice.</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Built with ♥ by <a href="https://bybilal.in" target="_blank" rel="noopener" className={footLink}>Bilal</a></span>
          <AlertDialog>
            <AlertDialogTrigger asChild><button type="button" className={footLink}>Privacy &amp; disclaimer</button></AlertDialogTrigger>
            <AlertDialogContent className="data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-md">
              <AlertDialogHeader className="place-items-start text-left">
                <AlertDialogTitle>Privacy &amp; disclaimer</AlertDialogTitle>
              </AlertDialogHeader>
              <AlertDialogDescription asChild>
                <div className="grid gap-4 text-sm">
                  <section className="grid gap-1">
                    <h3 className="font-medium text-foreground">Not medical advice</h3>
                    <p>Estimates from a one-compartment model using glapp.io's drug constants, not measurements. Always follow your prescriber's instructions. Provided as is, without warranty.</p>
                  </section>
                  <section className="grid gap-1">
                    <h3 className="font-medium text-foreground">Privacy</h3>
                    <p>Your plan is stored only in this browser. Nothing is sent to a server: no accounts, cookies or tracking. A share link contains your plan, so anyone with the link can see it. The site is hosted on GitHub Pages, which keeps standard server logs.</p>
                  </section>
                </div>
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogAction>Close</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </footer>
    </main>
  )
}
