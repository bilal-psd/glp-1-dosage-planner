// Exports, all made in the browser when the user asks: the chart as a PNG, the plan as a PDF (chart + steps + every
// dose), and the plan as a JSON file that Import reads back. Both images use a light "paper" palette, not the app's dark
// one, so they print and read well. jsPDF is loaded only when a PDF is made.

export type Table = { head: string[]; rows: string[][]; right: boolean[]; widths: number[] }  // widths: relative
export type ExportData = {
  title: string            // "Tirzepatide dosing plan"
  subtitle: string         // "Injection · estimated amount in the body"
  made: string             // "Made 2 Oct 2026"
  facts: [string, string][]
  pts: [number, number][]
  end: number              // chart length in days
  yMax: number
  yTicks: number[]
  xTicks: { t: number; label: string }[]
  bands: { start: number; end: number; fill: string; label: string }[]
  pens: { start: number; end: number; label: string }[]  // a row under the dates; empty in mg mode
  steps: Table
  doses: Table
  disclaimer: string
  fileStem: string         // "glp1-plan-2026-10-02"
}

const INK = "#17181b", INK2 = "#5d6068", RULE = "#e3e4e8", LINE = "#1f8a80", MARK = "#9a9ca3"
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif"
// Light tints of the data teal for the dose levels, matched by position to the app's six dark ones (lightest = lowest).
export const PAPER_DOSE_COLOURS = Array.from({ length: 6 }, (_, i) => { const f = i / 5; return `oklch(${(0.95 - 0.17 * f).toFixed(3)} ${(0.025 + 0.06 * f).toFixed(3)} 182)` })
export const PAPER_PAUSE = "#f0f1f3", PAPER_AFTER = "#eef4f3"

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")

// The chart as an SVG string, w × h px. With `framed`, a title and subtitle go above it and the disclaimer below
// (the PNG); without, it's the bare chart (placed in the PDF, which has its own title and footer).
export function chartSvg(d: ExportData, w: number, h: number, framed: boolean) {
  const top = framed ? 80 : 0, bottom = framed ? 52 : 0, pad = framed ? 32 : 0
  const fs = framed ? 14 : 9
  // Room above the plot for two rows of dose labels.
  // Room below for the dates and, with pens, the pen row.
  const penRow = d.pens.length ? fs * 2 + 6 : 0
  const L = pad + 28, R = w - pad - 8, T = top + 8 + fs * 2.8, B = h - bottom - fs - 12 - penRow
  const x = (t: number) => L + (t / d.end) * (R - L), y = (v: number) => B - (v / d.yMax) * (B - T)
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}">`
  s += `<rect width="${w}" height="${h}" fill="#ffffff"/>`
  if (framed) {
    s += `<text x="${pad}" y="${pad + 22}" font-size="24" font-weight="700" fill="${INK}">${esc(d.title)}</text>`
    s += `<text x="${pad}" y="${pad + 46}" font-size="15" fill="${INK2}">${esc(d.subtitle)}</text>`
  }
  // Dose bands under the curve, clipped to the area below it.
  const line = d.pts.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join("")
  s += `<defs><clipPath id="under"><path d="${line}L${x(d.end)},${B}L${x(0)},${B}Z"/></clipPath></defs>`
  s += `<g clip-path="url(#under)">${d.bands.map(b => `<rect x="${x(b.start)}" y="${T}" width="${Math.max(0, x(Math.min(b.end, d.end)) - x(b.start))}" height="${B - T}" fill="${b.fill}"/>`).join("")}</g>`
  for (const v of d.yTicks) s += `<line x1="${L}" x2="${R}" y1="${y(v)}" y2="${y(v)}" stroke="${RULE}" stroke-width="1"/><text x="${L - 8}" y="${y(v) + fs * 0.35}" font-size="${fs}" text-anchor="end" fill="${INK2}">${v}</text>`
  d.xTicks.forEach(({ t, label }, i) => {
    const anchor = i === 0 && t === 0 ? "start" : t >= d.end ? "end" : "middle"
    s += `<text x="${x(t)}" y="${B + fs + 6}" font-size="${fs}" text-anchor="${anchor}" fill="${INK2}">${esc(label)}</text>`
  })
  // Each band's mg label at its start; it may run past its own band. If the label before it is in the way, it slides
  // right within its band (a long band still gets labelled), else moves up to a second row, else is left out.
  const labelEnds = [-Infinity, -Infinity]
  for (const b of d.bands) {
    if (!b.label) continue
    const x0 = x(b.start) + 3, tw = b.label.length * fs * 0.58, limit = Math.min(R, Math.max(x(Math.min(b.end, d.end)) - 3, x0 + tw))
    let row = -1, lx = x0
    for (let r = 0; r < labelEnds.length && row < 0; r++) { const at = Math.max(x0, labelEnds[r]); if (at + tw <= limit) { row = r; lx = at } }
    if (row < 0) continue
    labelEnds[row] = lx + tw + fs * 0.6
    s += `<text x="${lx}" y="${T - 8 - row * fs * 1.4}" font-size="${fs}" font-weight="600" fill="${INK}">${esc(b.label)}</text>`
  }
  // Pens: a hairline as wide as each pen's time in use, its name below; the name shortens to "Pen N", or goes, if it doesn't fit.
  const py = B + fs + 6 + fs * 0.9
  for (const p of d.pens) {
    const x0 = x(p.start) + 1, x1 = x(Math.min(p.end, d.end)) - 1, room = x1 - x0 - 2
    s += `<line x1="${x0}" x2="${x1}" y1="${py}" y2="${py}" stroke="${MARK}" stroke-width="1"/>`
    const label = [p.label, p.label.split(" · ")[0]].find(l => l.length * fs * 0.55 <= room)
    if (label) s += `<text x="${x0 + 2}" y="${py + fs + 3}" font-size="${fs}" fill="${INK2}">${esc(label)}</text>`
  }
  s += `<path d="${line}" fill="none" stroke="${LINE}" stroke-width="${framed ? 2.5 : 1.5}" stroke-linejoin="round"/>`
  if (framed) s += `<text x="${pad}" y="${h - pad + 8}" font-size="13" fill="${INK2}">${esc(d.disclaimer)}</text>`
  return s + "</svg>"
}

async function svgToCanvas(svg: string, w: number, h: number, scale: number) {
  const img = new Image()
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)
  await img.decode()
  const c = document.createElement("canvas")
  c.width = w * scale; c.height = h * scale
  const g = c.getContext("2d")!
  g.scale(scale, scale); g.drawImage(img, 0, 0, w, h)
  return c
}

export function download(blob: Blob, name: string) {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob); a.download = name
  document.body.append(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

export async function exportPng(d: ExportData) {
  const W = 1200, H = 675
  const c = await svgToCanvas(chartSvg(d, W, H, true), W, H, 2)
  const blob = await new Promise<Blob | null>(r => c.toBlob(r, "image/png"))
  if (blob) download(blob, `${d.fileStem}-chart.png`)
}

// A4 portrait, in points. Helvetica throughout (built into every PDF reader), so only Latin-1 characters in the text.
export async function exportPdf(d: ExportData) {
  // Dashes and thin spaces from date ranges become their Latin-1 look-alikes.
  d = JSON.parse(JSON.stringify(d), (_, v) => (typeof v === "string" ? v.replace(/[\u2013\u2014]/g, "-").replace(/[\u2009\u202f]/g, " ") : v))
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ unit: "pt", format: "a4" })
  const PW = 595.28, PH = 841.89, M = 48, CW = PW - 2 * M, FOOT = PH - 36
  const ink = () => doc.setTextColor(INK), ink2 = () => doc.setTextColor(INK2)
  let y = M

  doc.setFont("helvetica", "bold"); doc.setFontSize(18); ink(); doc.text(d.title, M, y + 14)
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); ink2(); doc.text(d.subtitle, M, y + 30)
  doc.text([d.made, "GLP-1 plotter"], PW - M, y + 18, { align: "right", lineHeightFactor: 1.5 })
  y += 42
  doc.setDrawColor(INK); doc.setLineWidth(1.25); doc.line(M, y, PW - M, y)
  y += 20

  const colW = CW / d.facts.length
  d.facts.forEach(([k, v], i) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); ink2(); doc.text(k, M + i * colW, y)
    doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); ink(); doc.text(v, M + i * colW, y + 14)
  })
  y += 38

  const label = (t: string) => { doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); ink2(); doc.text(t.toUpperCase(), M, y, { charSpace: 0.6 }); y += 16 }

  label("Estimated amount in body (mg)")
  const chartH = 200, cw = Math.round(CW), ch = chartH
  // 3× is sharp in print; "FAST" deflates the image so the file stays small enough to email.
  const c = await svgToCanvas(chartSvg(d, cw, ch, false), cw, ch, 3)
  doc.addImage(c, "PNG", M, y, cw, ch, undefined, "FAST")
  y += chartH + 24

  const table = (t: Table) => {
    const n = t.head.length, rowH = 15, sum = t.widths.reduce((a, b) => a + b, 0)
    const edges = t.widths.reduce<number[]>((e, w) => [...e, e[e.length - 1] + (w / sum) * CW], [M])
    // Left-aligned cells start at their column's left edge; right-aligned ones end 10pt short of the right edge (flush on the last).
    const at = (i: number) => (t.right[i] ? edges[i + 1] - (i === n - 1 ? 0 : 10) : edges[i])
    const head = () => {
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); ink2()
      t.head.forEach((h, i) => doc.text(h, at(i), y, { align: t.right[i] ? "right" : "left" }))
      y += 5; doc.setDrawColor(INK); doc.setLineWidth(0.75); doc.line(M, y, PW - M, y); y += 11
    }
    head()
    for (const row of t.rows) {
      if (y > FOOT - 28) { doc.addPage(); y = M; head() }
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); ink()
      row.forEach((cell, i) => doc.text(cell, at(i), y, { align: t.right[i] ? "right" : "left" }))
      y += 4; doc.setDrawColor(RULE); doc.setLineWidth(0.5); doc.line(M, y, PW - M, y); y += rowH - 4
    }
    y += 14
  }

  label("Steps"); table(d.steps)
  if (y > FOOT - 80) { doc.addPage(); y = M }
  label("Every dose"); table(d.doses)

  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setDrawColor(RULE); doc.setLineWidth(0.5); doc.line(M, FOOT - 12, PW - M, FOOT - 12)
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); ink2()
    doc.text(doc.splitTextToSize(d.disclaimer, CW - 60), M, FOOT)
    doc.text(`${p} / ${pages}`, PW - M, FOOT, { align: "right" })
  }
  download(doc.output("blob"), `${d.fileStem}.pdf`)
}
