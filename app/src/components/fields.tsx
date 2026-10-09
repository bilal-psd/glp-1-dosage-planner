// Number fields shared by both plotters: a whole-number count, an mg amount and a stepper with its unit.
import { useState } from "react"
import { Minus, Plus, Trash2 } from "lucide-react"

import { cn, mgFmt } from "@/lib/utils"
import { Input } from "@/components/ui/input"

// A number field with its unit and −/+ inside one field-shaped box: the value starts at the same inset as the
// other settings fields, and the buttons sit on the trailing edge where the select chevron and calendar icon are.
// Buttons are 28px in a 36px field (4px inset), so their 6px radius nests inside the field's 10px.
// A whole-number count with − and + at its edges and the number centred between them (user's pick "C" from a comparison).
// Replaces a native number field, whose Chrome-only hover arrows pushed the number off centre. Typing is digits only;
// a typed value applies when it's in range, and the field shows the current value again on blur.
// With onRemove, the − turns into a bin at the minimum and removes the item (replaces a separate × column; user's pick "B").
export function CountField({ value, onChange, min = 1, max = 99, label, unit, onRemove, removeLabel }: {
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
export function MgField({ value, onChange, label, format = mgFmt, step = 0.05, className }: { value: number; onChange: (v: number) => void; label: string; format?: (v: number) => string; step?: number; className?: string }) {
  const [draft, setDraft] = useState(format(value))
  const [shown, setShown] = useState(value)
  if (value !== shown) { setShown(value); if (draft === "" || +draft !== value) setDraft(format(value)) }
  return (
    <Input type="number" min={0} step={step} className={cn("w-16 text-end pointer-coarse:h-9 sm:w-28", className)} value={draft} aria-label={label}
      onChange={e => { setDraft(e.target.value); const v = +e.target.value; if (e.target.value !== "" && v >= 0) onChange(v) }}
      onBlur={() => setDraft(format(value))} />
  )
}

export function Stepper({ id, value, onChange, step, min, max, unit }: {
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
