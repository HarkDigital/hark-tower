import { el, reveal, rise, setRise } from '../../core/dom'
import { PROCESS, STATS } from '../../content'

/*
 * Blueprint HUD (visual layer only — the stage is aria-hidden; srContent
 * carries the copy). Three pieces:
 *   head    eyebrow + the hoisted headline
 *   plate   the drawing-set spec plate: a title block ("A-501 · Listen",
 *           sheet 01 of 04), "01 — Listen", the step text, and a four-step
 *           erection track
 *   stats   three elevation-datum plates (10 years, $1M+, 15), each with a
 *           datum leader drawn from the plate to its level on the tower
 */

/** 10 years, $1M+, 15 — in that order. */
export const SHOW = [STATS[0], STATS[2], STATS[1]]
/** decorative datum levels (floors) the stat plates point at, top to bottom */
export const DATUM_FLOORS = [57, 50, 43]

const SHEETS = ['A-501', 'A-502', 'A-503', 'A-504']

const ELEV = `<svg class="pr-elmark" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 8V1.6A6.4 6.4 0 0 1 14.4 8Z M8 8v6.4A6.4 6.4 0 0 1 1.6 8Z" fill="currentColor"/></svg>`

export interface HudState {
  head: number
  headIn: boolean
  plate: number
  step: number
  /** per-step erection fill 0..1 */
  fills: number[]
  stats: number[]
}

export interface DatumPoint {
  x: number
  y: number
  ok: boolean
}

export class ProcessHud {
  root: HTMLElement
  private head: HTMLElement
  private title: HTMLElement
  private plate: HTMLElement
  private cards: { card: HTMLElement; name: HTMLElement }[] = []
  private segs: HTMLElement[] = []
  private bars: HTMLElement[] = []
  private barVals = [-1, -1, -1, -1]
  private statsBox: HTMLElement
  private statEls: { box: HTMLElement; v: HTMLElement; el: HTMLElement }[] = []
  private svg: SVGSVGElement
  private paths: SVGPathElement[] = []
  private nodes: SVGPathElement[] = []
  private last = ''
  /** measured anchor of each stat plate's datum row (stage px) */
  private anchors: { x: number; y: number }[] = []
  portrait = false

  constructor(stage: HTMLElement) {
    this.root = el('div', 'pr', undefined, stage)

    // ---- headline
    const head = (this.head = el('div', 'pr-head', undefined, this.root))
    el('p', 'hud-eyebrow', 'How we work', head)
    this.title = rise(el('h2', 'hud-h2 pr-title', undefined, head), 'We listen first. <br><em>Then we build.</em>')

    // ---- the spec plate
    const plate = (this.plate = el('div', 'pr-plate hud-panel', undefined, this.root))
    const deck = el('div', 'pr-deck', undefined, plate)
    PROCESS.forEach((p, i) => {
      const card = el('div', 'pr-card', undefined, deck)
      const tb = el('div', 'pr-tb', undefined, card)
      el('span', 'pr-tb-sheet', `${SHEETS[i]} · ${p.title}`, tb)
      el('span', 'pr-tb-of', `Sheet 0${i + 1} of 04`, tb)
      const name = rise(el('h3', 'pr-name', undefined, card), `0${i + 1} — ${p.title}`)
      el('p', 'hud-body pr-text', p.text, card)
      this.cards.push({ card, name })
    })
    const track = el('ol', 'pr-track', undefined, plate)
    PROCESS.forEach((p, i) => {
      const seg = el('li', 'pr-seg', undefined, track)
      const bar = el('span', 'pr-bar', undefined, seg)
      this.bars.push(el('i', '', undefined, bar))
      el('span', 'pr-seg-t', `0${i + 1} ${p.title}`, seg)
      this.segs.push(seg)
    })

    // ---- stats: elevation datums
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this.svg.setAttribute('class', 'pr-datums')
    this.root.appendChild(this.svg)
    const stats = (this.statsBox = el('div', 'pr-stats', undefined, this.root))
    SHOW.forEach((s, i) => {
      const box = el('div', 'pr-stat hud-panel', undefined, stats)
      const elRow = el('p', 'pr-el', undefined, box)
      const y = DATUM_FLOORS[i] * 4
      elRow.innerHTML = `${ELEV}<span>EL. +${y.toFixed(1)} · L${DATUM_FLOORS[i]}</span>`
      const v = rise(el('p', 'pr-val', undefined, box), s.value)
      el('p', 'pr-lab', s.label, box)
      this.statEls.push({ box, v, el: elRow })
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('class', 'pr-datum')
      this.svg.appendChild(path)
      this.paths.push(path)
      const node = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      node.setAttribute('class', 'pr-datum-node')
      this.svg.appendChild(node)
      this.nodes.push(node)
    })

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.measure())
      ro.observe(stats)
      ro.observe(plate)
      ro.observe(head)
    }
    window.addEventListener('resize', () => this.measure())
    document.fonts?.ready.then(() => this.measure())
  }

  short = false
  setMode(portrait: boolean, short: boolean) {
    if (portrait === this.portrait && short === this.short) return
    this.portrait = portrait
    this.short = short
    this.root.classList.toggle('is-portrait', portrait)
    this.root.classList.toggle('is-short', short)
    this.measure()
  }

  /** Stage-space anchor points of the datum rows (layout reads only on resize). */
  measure() {
    const p = this.plate
    this.plateRect = { left: p.offsetLeft, top: p.offsetTop, right: p.offsetLeft + p.offsetWidth, bottom: p.offsetTop + p.offsetHeight }
    const h = this.head
    this.headRect = { left: h.offsetLeft, top: h.offsetTop, right: h.offsetLeft + h.offsetWidth, bottom: h.offsetTop + h.offsetHeight }
    this.anchors = this.statEls.map(s => {
      // offset boxes ignore the reveal transform
      let x = 0
      let y = 0
      for (let e: HTMLElement | null = s.box; e && e !== this.root; e = e.offsetParent as HTMLElement | null) {
        x += e.offsetLeft
        y += e.offsetTop
      }
      return { x: x + s.box.offsetWidth, y: y + s.el.offsetTop + s.el.offsetHeight / 2 }
    })
  }

  private plateRect = { left: 0, top: 0, right: 0, bottom: 0 }
  private headRect = { left: 0, top: 0, right: 0, bottom: 0 }
  /** current visibility of the headline block (0..1) */
  headVis = 0
  /** The headline block's box (stage px, measured on resize). */
  headBox() {
    return this.headRect
  }
  /** The spec plate's box (stage px, measured on resize) — 3D annotations keep clear of it. */
  plateBox() {
    return this.plateRect
  }

  update(s: HudState) {
    this.headVis = s.head
    reveal(this.head, s.head)
    reveal(this.plate, s.plate)
    reveal(this.statsBox, Math.max(...s.stats), 0)
    s.stats.forEach((v, i) => reveal(this.statEls[i].box, v, this.portrait || this.short ? 0 : 12))
    for (let i = 0; i < 4; i++) {
      const v = Math.round(s.fills[i] * 400) / 400
      if (v !== this.barVals[i]) {
        this.barVals[i] = v
        this.bars[i].style.transform = `scaleX(${v})`
      }
    }
    const key = `${+s.headIn}${+(s.plate > 0.5)}${s.step}${s.stats.map(v => +(v > 0.5)).join('')}${s.fills.map(f => +(f >= 1)).join('')}`
    if (key === this.last) return
    this.last = key
    setRise(this.title, s.headIn)
    this.cards.forEach((c, i) => {
      const on = s.plate > 0.5 && s.step === i
      c.card.classList.toggle('is-in', on)
      setRise(c.name, on)
    })
    this.segs.forEach((g, i) => {
      g.classList.toggle('is-active', s.step === i)
      g.classList.toggle('is-done', s.fills[i] >= 1)
    })
    this.statEls.forEach((r, i) => setRise(r.v, s.stats[i] > 0.5))
  }

  /** Per-frame datum leaders from each plate to its level on the tower (landscape only). */
  datums(points: DatumPoint[], vis: number[]) {
    for (let i = 0; i < this.paths.length; i++) {
      const p = points[i]
      const a = this.anchors[i]
      const v = this.portrait || this.short || !p || !p.ok || !a ? 0 : vis[i]
      const path = this.paths[i]
      const node = this.nodes[i]
      if (v <= 0.01 || !Number.isFinite(p.x + p.y + a.x + a.y) || p.x < a.x + 60) {
        path.style.opacity = '0'
        node.style.opacity = '0'
        continue
      }
      const x0 = a.x + 10
      const elbow = Math.max(x0 + 20, p.x - Math.min(90, (p.x - x0) * 0.3))
      path.setAttribute('d', `M${x0.toFixed(1)},${a.y.toFixed(1)} H${elbow.toFixed(1)} L${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      // an elevation triangle sitting on the datum
      const t = 6
      node.setAttribute('d', `M${(p.x - t).toFixed(1)},${(p.y - t * 1.5).toFixed(1)} H${(p.x + t).toFixed(1)} L${p.x.toFixed(1)},${p.y.toFixed(1)} Z`)
      path.style.opacity = v.toFixed(3)
      node.style.opacity = v.toFixed(3)
      path.style.strokeDashoffset = `${((1 - v) * 600).toFixed(1)}`
    }
  }
}
