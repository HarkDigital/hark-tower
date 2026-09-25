import { BRAND } from '../content'
import { holdInert, releaseInert } from './inert'
import { markSvg } from './mark'
import { mountRotateGate } from './rotate'

/*
 * Boot screen: sheet A-001, the tower's elevation, drawing itself.
 *
 * A full-screen blueprint: blueprint-blue paper with a fine grid, a double
 * sheet border with zone marks, and the tower's south elevation drawn in
 * cyan linework (SVG stroke-dashoffset) as progress() rises: the ground line
 * and hatch, the structural grid bubbles, the neighbouring buildings, then
 * the columns rising with each floor line drawn in just behind them, the
 * outrigger belts, the crown, the climbing crane with a beam on its hook,
 * and finally the dimension string and elevation marks. A drawing title
 * block sits in the corner ("HARK TOWER · A-001 · ELEVATION · DRAWN BY HARK
 * DIGITAL DESIGN · SCALE 1:500") with a mono percentage.
 *
 * finish(): the drawing completes, the crown's diamond lights signal green
 * and an "Issued for construction" stamp lands; then the whole sheet is
 * LIFTED AWAY (up and off, ~0.8 s), revealing the dawn site behind it.
 * finish() resolves a beat into the lift (main.ts then fires 'hark:reveal',
 * so the hero's hoisted words ride the reveal); the node removes itself once
 * the sheet is gone. Reduced motion: no thump, the sheet fades instead.
 *
 * Rules: shows at least ~1.2 s, never hangs (every wait is a timer, never an
 * animation or a frame callback, so a background tab still finishes), the
 * page behind is inert while it's up, and skip (?nointro) removes it at once.
 *
 * API used by main.ts: createLoader(root, { skip }) → { progress(0..1), finish() }.
 */

const MIN_MS = 1250
/** how long the drawing takes to complete once finish() is called */
const CLOSE_MS = 480
/** the stamp lands and holds */
const STAMP_MS = 380
/** the lift (keep in step with ui.css) */
const LIFT_MS = 820

const wait = (ms: number) => new Promise<void>(r => window.setTimeout(r, ms))
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const seg = (v: number, a: number, b: number) => clamp01((v - a) / (b - a))

/* ------------------------------------------------------------------ drawing */

// viewBox units; the tower is 30 m x 240 m (1:8), 60 floors
const G = 680
const TOP = 120
const L = 175
const R = 245
const FH = (G - TOP) / 60
const COLS = [175, 192.5, 210, 227.5, 245]
const MAST = [226, 236]

interface Stroke {
  /** drawn with a dash (single subpath) */
  el: SVGPathElement
  a: number
  b: number
}

function elevationSvg() {
  const out: string[] = []
  /** a single-subpath line that DRAWS on between progress a..b */
  const dr = (d: string, cls: string, a: number, b: number) =>
    out.push(`<path class="ld-ln ${cls}" d="${d}" pathLength="1" data-a="${a}" data-b="${b}"/>`)
  /** detail that FADES in between a..b (multi-subpath, dashed, text) */
  const fd = (inner: string, a: number, b: number, cls = '') => out.push(`<g class="ld-fd ${cls}" data-a="${a}" data-b="${b}">${inner}</g>`)

  // ---- ground, hatch, piles, structural grid
  dr(`M14 ${G}H406`, 'ld-ln--ground', 0, 0.1)
  let hatch = ''
  for (let x = 22; x <= 404; x += 8) hatch += `M${x} ${G + 1.5}l-6.5 8`
  fd(`<path class="ld-ln ld-ln--thin" d="${hatch}"/>`, 0.03, 0.14)
  let piles = `M${L - 4} ${G}V${G + 24}H${R + 4}V${G}`
  for (const x of COLS) piles += `M${x} ${G}v24`
  fd(`<path class="ld-ln ld-ln--hidden" d="${piles}"/>`, 0.06, 0.16)
  const letters = ['A', 'B', 'C', 'D', 'E']
  fd(
    COLS.map(
      (x, i) =>
        `<path class="ld-ln ld-ln--center" d="M${x} ${G + 26}v10"/><circle class="ld-ln" cx="${x}" cy="${G + 44}" r="7"/><text class="ld-tx ld-tx--bub" x="${x}" y="${G + 47}">${letters[i]}</text>`,
    ).join(''),
    0.06,
    0.18,
  )

  // ---- the neighbours (faint)
  const city: [number, number, number][] = [
    [22, 68, 430],
    [72, 116, 520],
    [300, 352, 372],
    [356, 402, 478],
  ]
  city.forEach(([x0, x1, top], i) => {
    dr(`M${x0} ${G}V${top}H${x1}V${G}`, 'ld-ln--city', 0.1 + i * 0.05, 0.34 + i * 0.05)
    let w = ''
    for (let y = top + 12; y < G - 6; y += 12) w += `M${x0 + 5} ${y}H${x1 - 5}`
    let mull = ''
    for (let x = x0 + 11.5; x < x1 - 4; x += 11.5) mull += `M${x} ${top + 6}V${G - 6}`
    fd(`<path class="ld-ln ld-ln--win" d="${w}${mull}"/>`, 0.26 + i * 0.04, 0.46 + i * 0.04)
  })

  // ---- the tower: columns rise; floors draw in just behind them
  for (const x of COLS) dr(`M${x} ${G}V${TOP}`, 'ld-ln--col', 0.1, 0.8)
  for (let i = 1; i <= 60; i++) {
    const y = +(G - i * FH).toFixed(2)
    const major = i % 10 === 0
    out.push(`<path class="ld-ln ld-ln--floor${major ? ' is-major' : ''}" d="M${L} ${y}H${R}" pathLength="1" data-floor="${i}"/>`)
  }
  // outrigger belts (two-storey X braces) at the mechanical floors
  for (const f of [20, 40, 58]) {
    const y0 = +(G - (f - 1) * FH).toFixed(2)
    const y1 = +(G - (f + 1) * FH).toFixed(2)
    out.push(`<path class="ld-ln ld-ln--brace" d="M${L} ${y0}L${R} ${y1}M${L} ${y1}L${R} ${y0}" data-belt="${f + 1}"/>`)
  }

  // ---- the crown: the Hark sign box and its diamond
  dr(`M181 ${TOP}V96H221V${TOP}`, 'ld-ln--crown', 0.8, 0.87)
  dr('M201 101L208 108L201 115L194 108Z', 'ld-diamond', 0.84, 0.89)

  // ---- the climbing crane on the core
  const [m0, m1] = MAST
  dr(`M${m0} ${TOP}V46`, 'ld-ln--crane', 0.82, 0.9)
  dr(`M${m1} ${TOP}V46`, 'ld-ln--crane', 0.82, 0.9)
  let lat = `M${m0} ${TOP}`
  for (let y = TOP - 8, k = 1; y >= 46; y -= 8, k++) lat += `L${k % 2 ? m1 : m0} ${y}`
  fd(`<path class="ld-ln ld-ln--thin" d="${lat}"/>`, 0.86, 0.92)
  dr(`M${m1} 40H104`, 'ld-ln--crane', 0.86, 0.93)
  dr(`M${m0} 46H104V40`, 'ld-ln--crane', 0.86, 0.93)
  let jl = ''
  for (let x = m0 - 7, k = 0; x > 106; x -= 7, k++) jl += `M${x} ${k % 2 ? 40 : 46}L${x - 7} ${k % 2 ? 46 : 40}`
  fd(`<path class="ld-ln ld-ln--thin" d="${jl}"/>`, 0.9, 0.95)
  dr(`M${m1} 40H274V46H${m1}`, 'ld-ln--crane', 0.88, 0.93)
  fd(
    `<path class="ld-ln" d="M258 46h14v12h-14z"/><path class="ld-ln ld-ln--thin" d="M${m0} 40L231 18L${m1} 40M231 18L112 40M231 18L270 40"/><path class="ld-ln" d="M${m0 - 8} 46h8v8h-8z"/>`,
    0.9,
    0.95,
  )
  // trolley, cable, hook and a beam on its way up
  dr('M112 46V148', 'ld-ln--cable', 0.9, 0.96)
  fd(
    `<path class="ld-ln" d="M107 40.5h10v5.5h-10z"/><path class="ld-ln" d="M112 148l-3 4a3 3 0 1 0 6 0"/><path class="ld-ln ld-ln--thin" d="M112 150L96 160M112 150L128 160"/><path class="ld-ln ld-ln--beam" d="M94 160h36M94 166h36M112 160v6"/>`,
    0.93,
    0.98,
  )

  // ---- dimension string + elevation marks
  dr(`M249 ${G}H268`, 'ld-ln--dim', 0.87, 0.92)
  dr(`M249 ${TOP}H268`, 'ld-ln--dim', 0.87, 0.92)
  dr(`M262 ${G}V${TOP}`, 'ld-ln--dim', 0.88, 0.97)
  const mid = (G + TOP) / 2
  fd(
    `<path class="ld-ln" d="M258 ${G + 4}l8 -8M258 ${TOP + 4}l8 -8"/><text class="ld-tx ld-tx--dim" transform="translate(274 ${mid}) rotate(-90)">240.0 M</text>`,
    0.92,
    1,
  )
  const marks: [number, string][] = [
    [G, 'EL. +000.0'],
    [G - 30 * FH, 'EL. +120.0'],
    [TOP, 'EL. +240.0'],
  ]
  fd(
    marks
      .map(
        ([y, t]) =>
          `<path class="ld-ln ld-ln--thin" d="M163 ${y}H175"/><circle class="ld-ln" cx="167" cy="${y}" r="3.4"/><path class="ld-fill" d="M167 ${y}V${y - 3.4}A3.4 3.4 0 0 1 170.4 ${y}ZM167 ${y}V${y + 3.4}A3.4 3.4 0 0 1 163.6 ${y}Z"/><text class="ld-tx ld-tx--el" x="160" y="${y - 5}">${t}</text>`,
      )
      .join(''),
    0.9,
    1,
  )

  // ---- the drawing's own title
  fd(
    `<circle class="ld-ln" cx="36" cy="${G + 72}" r="11"/><text class="ld-tx ld-tx--num" x="36" y="${G + 76}">1</text><path class="ld-ln" d="M50 ${G + 72}H236"/><text class="ld-tx ld-tx--title" x="54" y="${G + 66}">SOUTH ELEVATION</text><text class="ld-tx ld-tx--small" x="54" y="${G + 84}">SCALE 1:500</text>`,
    0.12,
    0.24,
  )

  return `<svg class="ld-svg" viewBox="0 0 420 780" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">${out.join('')}</svg>`
}

/** detail 2: the typical floor plan (30 x 30 m, 5 x 5 column grid, the core) */
function planSvg() {
  const out: string[] = []
  const dr = (d: string, cls: string, a: number, b: number) =>
    out.push(`<path class="ld-ln ${cls}" d="${d}" pathLength="1" data-a="${a}" data-b="${b}"/>`)
  const fd = (inner: string, a: number, b: number) => out.push(`<g class="ld-fd" data-a="${a}" data-b="${b}">${inner}</g>`)
  const X = [45, 82.5, 120, 157.5, 195]
  const Y = [52, 89.5, 127, 164.5, 202]
  const letters = ['A', 'B', 'C', 'D', 'E']
  // grid lines + bubbles
  let grid = ''
  for (const x of X) grid += `M${x} 26V214`
  for (const y of Y) grid += `M26 ${y}H214`
  fd(
    `<path class="ld-ln ld-ln--center" d="${grid}"/>` +
      X.map((x, i) => `<circle class="ld-ln" cx="${x}" cy="17" r="7"/><text class="ld-tx ld-tx--bub" x="${x}" y="20">${letters[i]}</text>`).join('') +
      Y.map((y, i) => `<circle class="ld-ln" cx="17" cy="${y}" r="7"/><text class="ld-tx ld-tx--bub" x="17" y="${y + 3}">${i + 1}</text>`).join(''),
    0.14,
    0.3,
  )
  // slab edge + the curtain wall's outer line
  dr('M41 48H199V206H41Z', 'ld-ln--col', 0.2, 0.42)
  dr('M37.5 44.5H202.5V209.5H37.5Z', 'ld-ln--thin', 0.26, 0.48)
  // columns
  let cols = ''
  for (const x of X) for (const y of Y) cols += `M${x - 2.4} ${y - 2.4}h4.8v4.8h-4.8z`
  fd(`<path class="ld-fill" d="${cols}"/>`, 0.3, 0.5)
  // the core: two lift banks and a stair
  dr('M97.5 104.5H142.5V149.5H97.5Z', 'ld-ln--crown', 0.36, 0.56)
  fd('<path class="ld-ln ld-ln--thin" d="M120 104.5V149.5M97.5 127H142.5M97.5 104.5L120 127M120 104.5L97.5 127M120 127L142.5 149.5M142.5 127L120 149.5"/>', 0.46, 0.62)
  // dimension + title
  fd(
    `<path class="ld-ln" d="M45 226H195M45 221v10M195 221v10M41 230l8 -8M191 230l8 -8"/><text class="ld-tx ld-tx--dim" x="120" y="222">30.0 M</text>`,
    0.5,
    0.66,
  )
  fd(
    `<circle class="ld-ln" cx="37" cy="254" r="10"/><text class="ld-tx ld-tx--num" x="37" y="258">2</text><path class="ld-ln" d="M50 254H214"/><text class="ld-tx ld-tx--title" x="54" y="248">TYPICAL FLOOR PLAN</text><text class="ld-tx ld-tx--small" x="54" y="265">SCALE 1:500</text>`,
    0.18,
    0.32,
  )
  return `<svg class="ld-plan-svg" viewBox="0 0 240 272" aria-hidden="true" focusable="false">${out.join('')}</svg>`
}

/* ------------------------------------------------------------------ loader */

export function createLoader(root: HTMLElement, { skip = false } = {}) {
  // phones held sideways get the rotate card from the very first frame
  mountRotateGate()
  if (skip) {
    root.remove()
    return { progress() {}, finish: () => Promise.resolve() }
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  const zones = (n: number, alpha = false) =>
    Array.from({ length: n }, (_, i) => `<span>${alpha ? String.fromCharCode(65 + i) : i + 1}</span>`).join('')
  root.innerHTML = `
  <div class="ld${reduced ? ' is-reduced' : ''}">
    <p class="sr-only" role="status">Loading ${BRAND.name}</p>
    <div class="ld-sheet" aria-hidden="true">
      <div class="ld-zones ld-zones--top">${zones(6)}</div>
      <div class="ld-zones ld-zones--bottom">${zones(6)}</div>
      <div class="ld-zones ld-zones--left">${zones(4, true)}</div>
      <div class="ld-zones ld-zones--right">${zones(4, true)}</div>
      <div class="ld-frame">
        <div class="ld-notes">
          <p class="ld-notes-h">General notes</p>
          <ol>
            <li>Structural steel: wide-flange, red-oxide primer.</li>
            <li>Curtain wall: unitized, mirror-tint glazing.</li>
            <li>Crown: Hark mark, signal green.</li>
          </ol>
        </div>
        <div class="ld-draw">${elevationSvg()}</div>
        <div class="ld-plan">${planSvg()}</div>
        <div class="ld-stamp"><span class="ld-stamp-a">Issued for construction</span><span class="ld-stamp-b">Hark Digital Design</span></div>
        <div class="ld-tb">
          <div class="ld-tb-head">
            <span class="ld-tb-mark">${markSvg('ld-tb-mark-svg')}</span>
            <p class="ld-tb-proj"><b>Hark Tower</b><span>Hark.Digital · Concept</span></p>
          </div>
          <div class="ld-tb-grid">
            <p><span>Sheet</span><b>A-001</b></p>
            <p><span>Title</span><b>Elevation</b></p>
            <p><span>Scale</span><b>1:500</b></p>
            <p class="is-wide"><span>Drawn by</span><b>Hark Digital Design</b></p>
            <p class="is-pct"><span>Progress</span><b><i class="ld-num">000</i>%</b></p>
          </div>
        </div>
      </div>
    </div>
  </div>`
  holdInert('loader', [
    document.getElementById('track'),
    document.getElementById('stages'),
    document.getElementById('chrome'),
    document.querySelector<HTMLElement>('.skip-link'),
  ])

  const wrap = root.querySelector<HTMLElement>('.ld')!
  const num = root.querySelector<HTMLElement>('.ld-num')!
  const strokes: Stroke[] = [...root.querySelectorAll<SVGPathElement>('path[data-a]')].map(el => ({
    el,
    a: parseFloat(el.dataset.a!),
    b: parseFloat(el.dataset.b!),
  }))
  const fades = [...root.querySelectorAll<SVGGElement>('g.ld-fd')].map(el => ({
    el,
    a: parseFloat(el.dataset.a!),
    b: parseFloat(el.dataset.b!),
  }))
  const floors = [...root.querySelectorAll<SVGPathElement>('path[data-floor]')].map(el => ({
    el,
    i: parseInt(el.dataset.floor!, 10),
  }))
  const belts = [...root.querySelectorAll<SVGPathElement>('path[data-belt]')].map(el => ({
    el,
    i: parseInt(el.dataset.belt!, 10),
  }))

  const start = performance.now()
  let target = 0
  let shown = -1
  let finishing = false
  let raf = 0
  let lastPct = -1
  let lastT = start

  const paint = (v: number) => {
    for (const s of strokes) s.el.style.strokeDashoffset = (1 - seg(v, s.a, s.b)).toFixed(4)
    for (const f of fades) f.el.style.opacity = seg(v, f.a, f.b).toFixed(3)
    // the columns' leading edge, in floors: each floor line draws just behind it
    const front = seg(v, 0.1, 0.8) * 60
    for (const f of floors) f.el.style.strokeDashoffset = (1 - clamp01((front - f.i + 0.4) / 1.6)).toFixed(4)
    for (const b of belts) b.el.style.opacity = clamp01((front - b.i) / 1.5).toFixed(3)
    const pct = Math.round(v * 100)
    if (pct !== lastPct) {
      lastPct = pct
      num.textContent = String(pct).padStart(3, '0')
    }
  }
  paint(0)
  shown = 0

  // Cosmetic easing toward the real progress. Before finish() the drawing may
  // only creep toward ~92% at the pace of the minimum display time, so the
  // tower always has time to rise and 100 always means "done".
  const step = (ms: number) => {
    raf = 0
    const dt = Math.min(0.1, Math.max(0, (ms - lastT) / 1000))
    lastT = ms
    const cap = finishing ? 1 : Math.min(0.92, ((ms - start) / MIN_MS) * 0.92)
    const goal = Math.min(finishing ? 1 : target, cap)
    const next = shown + (goal - shown) * (1 - Math.exp(-dt * (finishing ? 8 : 4)))
    const v = goal - next < 0.002 ? goal : next
    if (v !== shown) {
      shown = v
      paint(v)
    }
    if (!(finishing && shown >= 1)) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)

  return {
    progress(p: number) {
      const v = clamp01(Number.isFinite(p) ? p : 0)
      target = Math.max(target, v)
    },
    async finish(): Promise<void> {
      const left = MIN_MS - (performance.now() - start)
      if (left > 0) await wait(left)
      // complete the drawing
      finishing = true
      target = 1
      if (!raf) raf = requestAnimationFrame(step)
      await wait(reduced ? 140 : CLOSE_MS)
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      shown = 1
      paint(1)
      // the crown lights and the sheet is stamped
      wrap.classList.add('is-done')
      await wait(reduced ? 200 : STAMP_MS)
      // lift the sheet away: the page wakes up as it starts to move
      wrap.classList.add('is-out')
      releaseInert('loader')
      window.setTimeout(() => root.remove(), (reduced ? 380 : LIFT_MS) + 120)
      // hand over a beat into the lift, so the hero's reveal rides it
      await wait(reduced ? 60 : 180)
    },
  }
}
