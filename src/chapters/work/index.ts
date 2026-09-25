import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { Callout, el, reveal, rise, setRise } from '../../core/dom'
import { clamp, ease, lerp, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { SECTIONS, WORK, workImage, type WorkItem } from '../../content'
import { FLOOR_H, FLOORS, MAT, Sparks } from '../../kit/steel'
import { loadScreenshot, placeholderTexture, whenRevealed } from '../../kit/images'
import { JIB_L, MAST_H } from '../../world/crane'
import { applySite } from '../common'
import {
  BOLT_POINTS,
  HANG,
  PD,
  PH,
  PW,
  UNIT_Z,
  boltGeometry,
  buildRig,
  buildUnit,
  frameGeometry,
  rackGeometry,
  rackPose,
  slotMark,
  type Unit,
} from './units'
import './work.css'

/*
 * STEEL (Selected work) — the client sites go up as curtain wall.
 *
 * Each featured project is a unitised curtain-wall unit: a 6 x 4 m aluminium
 * frame whose vision glass carries the site's screenshot. The six units wait
 * in an A-frame stillage on the ground; the tower crane picks one, hoists it
 * up beside the facade (the camera rides alongside like a hoist cage), slews
 * it over its slot — drawn on the facade in cyan as a blueprint opening —
 * sets it down and the fixers bolt it up (sparks, hot bolts). Installed units
 * stay: a column of client work climbing the face of the tower, two floors
 * apart, right under the steel being erected.
 *
 *   0.000–0.080  intro: a site sign — "Built to be heard." — low on the ground
 *                by the stillage; unit 01 leaves the rack at 0.035
 *   0.080–0.820  six units (~0.123 each): ride 0–22%, hoist top 36%, over the
 *                slot 52%, set 60% (bolt-up), hook free 66%, rest → 100%
 *   0.820–0.955  "Nine more, all live." — a lobby directory board; the camera
 *                looks down the facade at the installed units
 *   0.955–1.000  out: pull up and away (the blueprint cut follows)
 *
 * The crane is driven through world.params.crane. World damps those values;
 * a load has to hang exactly under the hook, so each frame the request is
 * pre-compensated against the damping (driveCrane) — the damped crane lands
 * on the hook position this chapter asked for in the same frame.
 *
 * Everything derives from `local`; frame.time only drives the load's swing on
 * the cable, the glint on the glass and the spark physics.
 */

const FEATURED = WORK.filter(w => w.featured)
const REST = WORK.filter(w => !w.featured)
const NF = FEATURED.length
const NR = REST.length

const F0 = 0.08
const F1 = 0.82
const SPAN = (F1 - F0) / NF
const itemStart = (k: number) => F0 + k * SPAN
/* inside an item (phase p) */
const P_RIDE = 0.22
const P_TOP = 0.36
const P_OVER = 0.52
const P_LAND = 0.6
const P_FREE = 0.66
const P_PICK = 0.8
const P_REST = 0.8
/* unit 01 leaves the stillage during the intro */
const LIFT0 = 0.035
const INTRO_HOLD = 0.05
/* the directory */
const DIR_A = 0.83
const ROW0 = 0.85
const ROW1 = 0.94
const DIR_B = 0.955
const rowAt = (j: number) => ROW0 + ((j + 0.5) * (ROW1 - ROW0)) / NR

const pickT = (k: number) => (k === 0 ? LIFT0 : itemStart(k - 1) + P_PICK * SPAN)
const topT = (k: number) => itemStart(k) + P_TOP * SPAN
const overT = (k: number) => itemStart(k) + P_OVER * SPAN
const landT = (k: number) => itemStart(k) + P_LAND * SPAN
const freeT = (k: number) => itemStart(k) + P_FREE * SPAN

/* the slots: one bay (x 3..9) of the +z face, every other floor from level 3 */
const SLOT_X = 6
const slotFloor = (k: number) => 3 + 2 * k
const slotY = (k: number) => slotFloor(k) * FLOOR_H + FLOOR_H / 2
/** the settled three-quarter view of each installed unit (yaw, pitch) */
const REST_YAW = [0.3, 0.2, 0.36, 0.24, 0.34, 0.22]
const REST_PITCH = [-0.14, -0.1, -0.16, -0.08, -0.13, -0.11]
/** the unit clears its slot by this much before it is swung in over it */
const CLEAR = 1.6
/* the stillage, on the ground in front of the main face, one bay east of the slots */
const RACK = new THREE.Vector3(14, 0, 25)

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const isPreview = (url: string) => {
  try {
    return /(^|\.)harktest\.com$/i.test(new URL(url).hostname)
  } catch {
    return false
  }
}
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
const elev = (m: number) => `EL. +${pad(Math.floor(Math.max(0, m)), 3)}.${Math.floor((Math.max(0, m) % 1) * 10)}`
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/* rack poses (constant) */
const RACK_POS: THREE.Vector3[] = []
const RACK_QUAT: THREE.Quaternion[] = []
for (let k = 0; k < NF; k++) {
  const p = new THREE.Vector3()
  const q = new THREE.Quaternion()
  rackPose(k, RACK, p, q)
  RACK_POS.push(p)
  RACK_QUAT.push(q)
}
/** hook eye above unit k on the stillage */
const pickHook = (k: number, out: THREE.Vector3) => out.set(RACK.x, RACK_POS[k].y + HANG + 0.4, RACK_POS[k].z)
const slotCentre = (k: number, out: THREE.Vector3) => out.set(SLOT_X, slotY(k), UNIT_Z)

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _c = new THREE.Vector3()
const _d = new THREE.Vector3()
const _r = new THREE.Vector3()
const _u = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const UP = new THREE.Vector3(0, 1, 0)
const DEG = Math.PI / 180

/** Move around the crane's mast: interpolate yaw + radius (a slew), y separately. */
function slewLerp(out: THREE.Vector3, ax: number, az: number, bx: number, bz: number, t: number, y: number) {
  const ya = Math.atan2(az, ax)
  const yb = Math.atan2(bz, bx)
  const yaw = ya + wrapAngle(yb - ya) * t
  const r = lerp(Math.hypot(ax, az), Math.hypot(bx, bz), t)
  return out.set(Math.cos(yaw) * r, y, Math.sin(yaw) * r)
}

/* ------------------------------------------------------------------ the hook path */

/** Hook eye while carrying unit k (pickT ≤ l ≤ landT). */
function carryHook(k: number, l: number, out: THREE.Vector3) {
  const a = pickT(k)
  const b = topT(k)
  const c = overT(k)
  const d = landT(k)
  const top = slotY(k) + CLEAR + HANG
  const P = pickHook(k, _a)
  if (l < b) {
    const u = clamp((l - a) / (b - a))
    // take the weight slowly, run, and slow to a stop at the top
    const s = u * u * (3 - 2 * u)
    return out.set(P.x, lerp(P.y, top, s), P.z)
  }
  if (l < c) {
    const v = ease.inOutCubic(clamp((l - b) / (c - b)))
    return slewLerp(out, P.x, P.z, SLOT_X, UNIT_Z, v, top)
  }
  const w = clamp((l - c) / (d - c))
  return out.set(SLOT_X, top - CLEAR * ease.outCubic(w), UNIT_Z)
}

/** Hook eye at local l, over the whole chapter. */
function hookAt(l: number, out: THREE.Vector3) {
  if (l < pickT(0)) {
    const P = pickHook(0, out)
    // the hook comes down to the stillage during the intro
    return out.set(P.x, P.y + 12 * (1 - smoothstep(0, pickT(0), l)), P.z)
  }
  for (let k = 0; k < NF; k++) {
    if (l < landT(k)) return carryHook(k, l, out)
    const sy = slotY(k) + HANG
    if (l < freeT(k)) return out.set(SLOT_X, sy, UNIT_Z)
    const lift = freeT(k) + 0.06 * SPAN
    if (l < lift) return out.set(SLOT_X, sy + 2.5 * smoothstep(freeT(k), lift, l), UNIT_Z)
    if (k < NF - 1) {
      if (l < pickT(k + 1)) {
        const P = pickHook(k + 1, _b)
        const v = ease.inOutCubic(clamp((l - lift) / (pickT(k + 1) - lift)))
        return slewLerp(out, SLOT_X, UNIT_Z, P.x, P.z, v, lerp(sy + 2.5, P.y, v))
      }
    } else {
      // the last one is in: the hook parks high and out of the way
      const v = ease.inOutCubic(clamp((l - lift) / (0.9 - lift)))
      return slewLerp(out, SLOT_X, UNIT_Z, SLOT_X + 14, UNIT_Z + 12, v, sy + 2.5 + 10 * v)
    }
  }
  return out
}

/** Swing on the cable while carrying unit k (0..1; 0 on the rack and once set). */
function swingAmp(k: number, l: number) {
  const a = pickT(k)
  const inn = smoothstep(a, a + 0.2 * (topT(k) - a), l)
  const out = 1 - smoothstep(overT(k) - 0.08 * SPAN, landT(k) - 0.02 * SPAN, l)
  return inn * out
}

/* ------------------------------------------------------------------ framing */

interface Region {
  x0: number
  y0: number
  x1: number
  y1: number
}
interface Shot {
  pos: THREE.Vector3
  tgt: THREE.Vector3
  fov: number
}
const shot = (): Shot => ({ pos: new THREE.Vector3(), tgt: new THREE.Vector3(), fov: 36 })

/**
 * Aim a camera (yaw around y, pitch; yaw 0 = looking toward -z at the main
 * face, pitch > 0 looks down) so a w x h subject centred at C fills the
 * screen region `reg` (CSS px).
 */
function frameTo(out: Shot, C: THREE.Vector3, w: number, h: number, yaw: number, pitch: number, fov: number, reg: Region, W: number, H: number) {
  _d.set(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
  const aspect = W / Math.max(1, H)
  const tanH = Math.tan((fov * DEG) / 2)
  const fw = Math.max(0.1, (reg.x1 - reg.x0) / W)
  const fh = Math.max(0.1, (reg.y1 - reg.y0) / H)
  const cx = ((reg.x0 + reg.x1) / 2 / W) * 2 - 1
  const cy = 1 - ((reg.y0 + reg.y1) / 2 / H) * 2
  const dist = Math.max(w / 2 / (fw * tanH * aspect), h / 2 / (fh * tanH))
  const hh = dist * tanH
  const hw = hh * aspect
  _r.crossVectors(_d, UP).normalize()
  _u.crossVectors(_r, _d).normalize()
  out.pos.copy(C).addScaledVector(_d, -dist).addScaledVector(_r, -cx * hw).addScaledVector(_u, -cy * hh)
  out.tgt.copy(out.pos).addScaledVector(_d, dist)
  out.fov = fov
  return out
}

function blendShot(out: Shot, a: Shot, b: Shot, t: number, pull = 0, lift = 0) {
  const e = ease.inOutCubic(clamp(t))
  out.pos.lerpVectors(a.pos, b.pos, e)
  out.tgt.lerpVectors(a.tgt, b.tgt, e)
  out.fov = lerp(a.fov, b.fov, e)
  if (pull) {
    // a slight pull back mid-move (a crane-camera arc rather than a straight dolly)
    const bump = Math.sin(Math.PI * clamp(t)) * pull
    _d.subVectors(out.pos, out.tgt).normalize()
    out.pos.addScaledVector(_d, bump)
  }
  if (lift) {
    // …and a rise, like the hoist cage climbing to meet the next load
    const up = Math.sin(Math.PI * clamp(t)) * lift
    out.pos.y += up
    out.tgt.y += up * 0.7
  }
  return out
}

interface Layout {
  key: string
  W: number
  H: number
  portrait: boolean
  top: number
  bottom: number
  right: number
  dockR: number
  cardTop: number[]
  boardR: number
  boardTop: number
}

interface Card {
  root: HTMLElement
  name: HTMLElement
}

class Work implements Chapter {
  id = 'work'
  group = new THREE.Group()
  anchors = [...FEATURED.map((_, k) => itemStart(k) + P_REST * SPAN), ...REST.map((_, j) => rowAt(j))]

  private ctx!: ChapterContext
  private mobile = false
  private reduced = false
  private units: Unit[] = []
  private rig!: THREE.Group
  private rack!: THREE.Mesh
  private mark!: ReturnType<typeof slotMark>
  private bolts!: THREE.Mesh
  private boltMat!: THREE.MeshBasicMaterial
  private sparks!: Sparks

  // DOM
  private safe!: HTMLElement
  private sign!: HTMLElement
  private signTitle!: HTMLElement
  private dock!: HTMLElement
  private cards: Card[] = []
  private board!: HTMLElement
  private boardTitle!: HTMLElement
  private rows: HTMLAnchorElement[] = []
  private hoverRow = -1
  private curRow = -2
  private callout!: Callout
  private calloutText = ''

  // layout + camera
  private lay: Layout | null = null
  private layDirty = true
  private cur = shot()
  private sa = shot()
  private sb = shot()
  private hook = new THREE.Vector3()
  private prevL = -1

  async init(ctx: ChapterContext) {
    this.ctx = ctx
    this.mobile = ctx.mobile
    this.reduced = ctx.reducedMotion
    this.buildDom(ctx.stage)
    await nextFrame()

    // the units, with placeholder glass until the screenshots arrive
    const fg = frameGeometry(this.mobile)
    for (let k = 0; k < NF; k++) {
      const u = buildUnit(fg, placeholderTexture('#20262d'), this.mobile)
      this.units.push(u)
      this.group.add(u.root)
    }
    this.rig = buildRig(this.mobile)
    this.group.add(this.rig)
    this.rack = new THREE.Mesh(rackGeometry(), MAT.primer())
    this.rack.position.copy(RACK)
    this.rack.castShadow = !this.mobile
    this.rack.receiveShadow = !this.mobile
    this.group.add(this.rack)
    this.mark = slotMark()
    this.group.add(this.mark.lines)
    this.boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a2a'), toneMapped: false })
    this.bolts = new THREE.Mesh(boltGeometry(), this.boltMat)
    this.bolts.visible = false
    this.group.add(this.bolts)
    this.sparks = new Sparks(this.mobile ? 80 : 200, 0.1)
    this.group.add(this.sparks.points)
    await nextFrame()

    window.addEventListener('resize', () => (this.layDirty = true))
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => (this.layDirty = true))
      for (const c of this.cards) ro.observe(c.root)
      ro.observe(this.board)
      ro.observe(this.sign)
      ro.observe(this.safe)
    }
    document.fonts?.ready.then(() => (this.layDirty = true))

    // screenshots: unit 01 now (it's on screen first), the rest once the site is revealed
    const load = (k: number) =>
      loadScreenshot(workImage(FEATURED[k].id), { width: 960 })
        .then(tex => {
          tex.anisotropy = 8
          try {
            this.ctx.renderer.initTexture(tex)
          } catch {
            /* uploads on first use instead */
          }
          const m = this.units[k].shotMat
          const old = m.map
          m.map = tex
          old?.dispose()
        })
        .catch(err => console.warn(`[work] missing screenshot for ${FEATURED[k].id}`, err))
    load(0)
    whenRevealed().then(async () => {
      for (let k = 1; k < NF; k++) {
        await load(k)
        await nextFrame()
      }
    })
  }

  // ------------------------------------------------------------------ DOM

  private buildDom(stage: HTMLElement) {
    this.safe = el('div', 'wk-safe', undefined, stage)

    // intro: the site sign
    this.sign = el('div', 'wk-sign hud-panel', undefined, stage)
    const head = el('div', 'wk-sign-head', undefined, this.sign)
    el('p', 'hud-eyebrow', SECTIONS.work.eyebrow, head)
    el('span', 'wk-sheet', 'Sheet A-201', head)
    const title = SECTIONS.work.title
    const cut = title.lastIndexOf(' ')
    this.signTitle = rise(
      el('h2', 'hud-h2 wk-title', undefined, this.sign),
      cut > 0 ? `${esc(title.slice(0, cut))} <em>${esc(title.slice(cut + 1))}</em>` : `<em>${esc(title)}</em>`,
    )
    el('hr', 'hud-rule wk-rule', undefined, this.sign)
    const count = el('p', 'wk-count', undefined, this.sign)
    count.innerHTML = [`${WORK.length} sites`, `${NF} featured`, `${NR} more`].map(s => `<span>${esc(s)}</span>`).join('<i aria-hidden="true">·</i>')

    // one spec plate per unit
    this.dock = el('div', 'wk-dock', undefined, stage)
    FEATURED.forEach((w, k) => this.cards.push(this.buildCard(this.dock, w, k)))

    // the lobby directory
    this.board = el('section', 'wk-board', undefined, stage)
    const frame = el('div', 'wk-board-frame', undefined, this.board)
    const felt = el('div', 'wk-felt', undefined, frame)
    const bhead = el('div', 'wk-board-head', undefined, felt)
    el('span', '', 'Directory', bhead)
    el('span', '', `${pad(NF + 1)}–${pad(NF + NR)} / ${pad(WORK.length)}`, bhead)
    const allLive = REST.every(w => !isPreview(w.url))
    this.boardTitle = rise(el('h3', 'hud-h2 wk-board-title', undefined, felt), allLive ? 'Nine more, <em>all live.</em>' : 'Nine <em>more.</em>')
    const ol = el('ol', 'wk-rows', undefined, felt)
    REST.forEach((w, j) => {
      const li = el('li', '', undefined, ol)
      const a = el('a', 'wk-row', undefined, li)
      a.href = w.url
      a.target = '_blank'
      a.rel = 'noopener'
      const pre = isPreview(w.url)
      a.innerHTML = `<span class="wk-rname">${esc(w.name)}${pre ? ' <small class="wk-pre">Preview</small>' : ''}</span><span class="wk-dots" aria-hidden="true"></span><span class="wk-rind">${esc(
        w.industry,
      )}</span><span class="wk-arrow" aria-hidden="true">↗</span>`
      const on = () => (this.hoverRow = j)
      const off = () => {
        if (this.hoverRow === j) this.hoverRow = -1
      }
      a.addEventListener('pointerenter', on)
      a.addEventListener('pointerleave', off)
      a.addEventListener('focus', on)
      a.addEventListener('blur', off)
      this.rows.push(a)
    })
    const cta = el('div', 'wk-board-cta', undefined, this.board)
    const hello = el('button', 'hud-btn', 'Say hello', cta)
    hello.type = 'button'
    hello.addEventListener('click', () => window.__hark?.land('contact'))

    // a drawing annotation that rides on the unit in view
    this.callout = new Callout(stage, { side: 'right', offset: { x: 64, y: -46 } })
    this.callout.root.classList.add('wk-callout')
  }

  private buildCard(parent: HTMLElement, w: WorkItem, k: number): Card {
    const root = el('article', 'wk-card hud-panel', undefined, parent)
    const pre = isPreview(w.url)
    const meta = el('div', 'wk-meta', undefined, root)
    el('span', 'wk-unit', `Unit ${pad(k + 1)} / ${pad(NF)}`, meta)
    el('span', 'hud-label wk-ind', w.industry, meta)
    if (pre) el('span', 'wk-badge', 'Preview', meta)
    const name = rise(el('h3', 'hud-h2 wk-name', undefined, root), esc(w.name))
    el('p', 'hud-body wk-blurb', w.blurb, root)
    const tags = el('ul', 'hud-tags wk-tags', undefined, root)
    for (const t of w.tags) el('li', 'hud-tag', t, tags)
    const cta = el('div', 'wk-cta', undefined, root)
    const a = el('a', 'hud-btn hud-btn--ghost wk-visit', pre ? 'Preview site ↗' : 'Visit site ↗', cta)
    a.href = w.url
    a.target = '_blank'
    a.rel = 'noopener'
    el('span', 'hud-label wk-host', pre ? 'Pre-launch build' : hostOf(w.url), cta)
    // a drawing title block along the foot of the plate (decorative)
    const tb = el('div', 'wk-titleblock', undefined, root)
    tb.setAttribute('aria-hidden', 'true')
    for (const s of [`CW-${pad(k + 1)}`, `Level ${pad(slotFloor(k) + 1)}`, elev(slotFloor(k) * FLOOR_H), '6000 × 4000']) el('span', '', s, tb)
    return { root, name }
  }

  // ------------------------------------------------------------------ layout

  private ensureLayout(f: Frame): Layout {
    const key = `${f.width}x${f.height}`
    if (this.lay && this.lay.key === key && !this.layDirty) return this.lay
    this.layDirty = false
    const W = f.width
    const H = f.height
    const portrait = typeof matchMedia === 'function' ? matchMedia('(max-aspect-ratio: 10/9)').matches : W / H < 1.1
    const s = this.safe.getBoundingClientRect()
    const measured = s.width > 0
    const dock = this.dock
    const board = this.board
    this.lay = {
      key,
      W,
      H,
      portrait,
      top: measured ? s.top : 90,
      bottom: measured ? s.bottom : H - 90,
      right: measured ? s.right : W - 24,
      dockR: dock.offsetWidth > 0 ? dock.offsetLeft + dock.offsetWidth : W * 0.38,
      cardTop: this.cards.map(c => (c.root.offsetHeight > 0 ? dock.offsetTop + c.root.offsetTop : H * 0.55)),
      boardR: board.offsetWidth > 0 ? board.offsetLeft + board.offsetWidth : W * 0.42,
      boardTop: board.offsetHeight > 0 ? board.offsetTop : H * 0.4,
    }
    return this.lay
  }

  private region(kind: 'item' | 'dir', k = 0): Region {
    const L = this.lay!
    if (L.portrait) {
      const lim = kind === 'item' ? L.cardTop[k] : L.boardTop
      return { x0: 6, x1: L.W - 6, y0: L.top + 4, y1: Math.max(L.top + 110, lim - 12) }
    }
    const r = kind === 'item' ? L.dockR : L.boardR
    return { x0: r + L.W * 0.03, x1: L.right + L.W * 0.01, y0: L.top, y1: L.bottom }
  }

  // ------------------------------------------------------------------ shots

  private introShot(u: number, out: Shot) {
    const L = this.lay!
    // eye height inside the hoarding, off the south-east corner: the stillage and
    // the hook coming down in front, the steel and the crane climbing behind
    if (L.portrait) {
      out.pos.set(lerp(36, 35, u), 1.7, lerp(39, 38, u))
      // the sign covers the lower third: keep the stillage above it
      out.tgt.set(-4, lerp(7, 8, u), 16)
      out.fov = 60
    } else {
      // closer in: the tower right of centre, the stillage low right, the sign bottom-left
      out.pos.set(lerp(30, 29, u), 1.7, lerp(42, 40.8, u))
      out.tgt.set(-18, lerp(17, 18, u), 14)
      out.fov = 52
    }
    return out
  }

  /** Riding up beside unit k as it's hoisted (the camera trails it a little). */
  private rideShot(k: number, l: number, out: Shot) {
    const L = this.lay!
    // the camera trails the load a little (at most a metre and a half)
    const lag = this.reduced ? 0 : 0.006
    carryHook(k, Math.max(pickT(k), Math.min(landT(k), l)), _b)
    carryHook(k, Math.max(pickT(k), Math.min(landT(k), l - lag)), _c)
    // (only in height: sideways the camera keeps the load centred)
    _c.set(_b.x, Math.max(_c.y, _b.y - 1.5) - HANG, _b.z)
    frameTo(out, _c, PW / (L.portrait ? 0.82 : 0.58), PH / 0.5, 0.3, -0.08, 40, this.region('item', k), L.W, L.H)
    return out
  }

  /** Unit k set in its slot: a slightly low three-quarter view, the steel above. */
  private restShot(k: number, drift: number, out: Shot) {
    const L = this.lay!
    slotCentre(k, _c)
    _c.y += 0.4
    // each unit gets its own angle, so six installs don't read as one repeated shot
    const yaw = REST_YAW[k % REST_YAW.length]
    const pitch = REST_PITCH[k % REST_PITCH.length]
    frameTo(out, _c, PW / (L.portrait ? 0.8 : 0.56), PH / 0.46, yaw + drift * 0.07, pitch - drift * 0.02, 38, this.region('item', k), L.W, L.H)
    out.pos.lerp(out.tgt, drift * 0.06)
    return out
  }

  /** Looking down the face of the tower at the column of installed units. */
  private dirShot(u: number, out: Shot) {
    const L = this.lay!
    _c.set(SLOT_X - 1, lerp(36, 33, u), UNIT_Z)
    frameTo(out, _c, L.portrait ? 16 : 22, 48, lerp(0.42, 0.5, u), lerp(0.58, 0.62, u), 40, this.region('dir'), L.W, L.H)
    return out
  }

  private outShot(out: Shot) {
    this.dirShot(1, out)
    _d.subVectors(out.pos, out.tgt)
    out.pos.copy(out.tgt).addScaledVector(_d, 1.35)
    out.pos.y += 14
    out.tgt.y += 10
    return out
  }

  private shotAt(l: number, out: Shot) {
    const join0 = itemStart(0) + P_RIDE * SPAN
    if (l < INTRO_HOLD) return this.introShot(l / INTRO_HOLD, out)
    if (l < join0) return blendShot(out, this.introShot(1, this.sa), this.rideShot(0, l, this.sb), (l - INTRO_HOLD) / (join0 - INTRO_HOLD), 2)
    if (l < F1) {
      const k = Math.min(NF - 1, Math.floor((l - F0) / SPAN))
      const p = clamp((l - itemStart(k)) / SPAN)
      if (k > 0 && p < P_RIDE) return blendShot(out, this.restShot(k - 1, 1, this.sa), this.rideShot(k, l, this.sb), p / P_RIDE, 3, 3)
      if (p < P_TOP) return this.rideShot(k, l, out)
      if (p < P_LAND) return blendShot(out, this.rideShot(k, l, this.sa), this.restShot(k, 0, this.sb), (p - P_TOP) / (P_LAND - P_TOP))
      return this.restShot(k, (p - P_LAND) / (1 - P_LAND), out)
    }
    const dIn = DIR_A + 0.012
    if (l < dIn) return blendShot(out, this.restShot(NF - 1, 1, this.sa), this.dirShot(0, this.sb), (l - F1) / (dIn - F1), 4)
    if (l < DIR_B) return this.dirShot((l - dIn) / (DIR_B - dIn), out)
    return blendShot(out, this.dirShot(1, this.sa), this.outShot(this.sb), (l - DIR_B) / (1 - DIR_B))
  }

  // ------------------------------------------------------------------ crane

  /**
   * Ask the crane to put its hook at H this frame. World damps the crane
   * (yaw/reach/drop at 3.2/s, the mast base with the steel at 2.2/s); predict
   * the base and pre-compensate the request so the damped value lands on H.
   */
  private driveCrane(ctx: ChapterContext, frame: Frame, H: THREE.Vector3) {
    const w = ctx.world
    const p = w.params
    const cr = w.crane
    const dt = frame.dt
    const k = 1 - Math.exp(-3.2 * dt)
    const kb = 1 - Math.exp(-2.2 * dt)
    const prevBuilt = w.tower.frontier / FLOOR_H
    const built = prevBuilt + (p.built - prevBuilt) * kb
    const baseY = Math.min(FLOORS, built + 2) * FLOOR_H
    const yaw = Math.atan2(H.z, H.x)
    const reach = Math.hypot(H.x, H.z) / JIB_L
    const drop = baseY + MAST_H + 0.3 - H.y
    // before the world's first damped update (and in prewarm) just ask for the pose
    if (frame.time < 0.2 || k < 0.004) {
      p.crane.yaw = yaw
      p.crane.reach = reach
      p.crane.drop = drop
      return
    }
    const curYaw = -cr.slew.rotation.y
    const curReach = cr.trolley.position.x / JIB_L
    const curDrop = -cr.hook.position.y
    const ay = wrapAngle(yaw - curYaw) / k
    p.crane.yaw = Math.abs(ay) < 3 ? curYaw + ay : yaw
    p.crane.reach = curReach + (reach - curReach) / k
    p.crane.drop = curDrop + (drop - curDrop) / k
  }

  // ------------------------------------------------------------------ frame

  update(local: number, frame: Frame, ctx: ChapterContext) {
    const l = clamp(local)
    const t = frame.time
    const reduced = this.reduced || frame.reducedMotion
    this.ensureLayout(frame)
    applySite(ctx, 'work', l)
    // a little morning haze: depth between the steel, the far city recedes
    ctx.world.params.fog = 1.5

    // ---- the hook, the crane, the rig
    const H = hookAt(l, this.hook)
    this.driveCrane(ctx, frame, H)
    let carrying = -1
    for (let k = 0; k < NF; k++) if (l >= pickT(k) && l < landT(k)) carrying = k
    // reduced motion: the load hangs still (no swing, no twist)
    const swingK = reduced ? 0 : 1
    const amp = (carrying >= 0 ? swingAmp(carrying, l) : 0.6) * swingK
    const ph = carrying >= 0 ? carrying * 1.7 : 5.1
    _e.set(amp * 0.035 * Math.sin(t * 1.05 + ph), amp * 0.07 * Math.sin(t * 0.33 + ph * 2), amp * 0.045 * Math.sin(t * 0.8 + 1 + ph))
    _q.setFromEuler(_e)
    this.rig.position.copy(H)
    this.rig.quaternion.copy(_q)

    // ---- units
    const sky = ctx.world.hemi.color
    for (let k = 0; k < NF; k++) {
      const u = this.units[k]
      const root = u.root
      if (l < pickT(k)) {
        root.position.copy(RACK_POS[k])
        root.quaternion.copy(RACK_QUAT[k])
      } else if (l < landT(k)) {
        // hanging under the hook (swinging), eased off the stillage at the pick
        _a.set(0, -HANG, 0).applyQuaternion(_q).add(H)
        const pw = smoothstep(pickT(k), pickT(k) + 0.12 * (topT(k) - pickT(k)), l)
        root.position.lerpVectors(RACK_POS[k], _a, pw)
        root.quaternion.slerpQuaternions(RACK_QUAT[k], _q, pw)
      } else {
        slotCentre(k, root.position)
        root.quaternion.identity()
      }
      // the glass: a sky sheen, and a glint that runs across it as it turns / is set
      u.u.uSky.value.copy(sky).multiplyScalar(0.9)
      const setSweep = smoothstep(landT(k) - 0.22 * SPAN, landT(k) + 0.3 * SPAN, l)
      const twist = carrying === k ? _e.y * 9 : 0
      u.u.uGlint.value = setSweep > 0 && setSweep < 1 ? lerp(-0.5, 1.9, setSweep) : 0.55 + twist
      u.u.uSheen.value = carrying === k ? 1 : 0.7
    }

    // ---- the slot being filled: a cyan blueprint opening, drawn on before the unit arrives
    const kk = l < F0 ? 0 : Math.min(NF - 1, Math.floor((l - F0) / SPAN))
    const pk = clamp((l - itemStart(kk)) / SPAN)
    const inItems = l >= F0 - 0.01 && l < F1
    slotCentre(kk, this.mark.lines.position)
    this.mark.lines.position.z += PD / 2 + 0.2
    this.mark.u.uDraw.value = smoothstep(0.24, 0.48, pk)
    this.mark.u.uOpacity.value = inItems ? smoothstep(0.22, 0.3, pk) * (1 - smoothstep(P_LAND - 0.02, P_LAND + 0.1, pk)) : 0
    this.mark.lines.visible = this.mark.u.uOpacity.value > 0.003

    // ---- bolt-up: hot bolts after the set, sparks as it lands
    let hot = -1
    for (let k = 0; k < NF; k++) if (l >= landT(k)) hot = k
    const glow = hot >= 0 ? Math.exp(-(l - landT(hot)) / (0.07 * SPAN)) : 0
    this.bolts.visible = glow > 0.04
    if (this.bolts.visible) {
      slotCentre(hot, this.bolts.position)
      this.boltMat.color.set('#ff7a2a').multiplyScalar((reduced ? 1.1 : 4) * glow)
    }
    if (!reduced && this.prevL >= 0 && Math.abs(l - this.prevL) < 0.03) {
      for (let k = 0; k < NF; k++) {
        const lt = landT(k)
        if (this.prevL < lt && l >= lt) {
          for (const [bx, by] of BOLT_POINTS) {
            _b.set(SLOT_X + bx, slotY(k) + by, UNIT_Z + PD / 2 + 0.1)
            this.sparks.emit(_b, this.mobile ? 6 : 14, 3)
          }
        }
      }
    }
    this.prevL = l
    this.sparks.update(frame.dt)

    // ---- camera shot (camera() copies it)
    this.shotAt(l, this.cur)

    // ---- post: screenshots never bloom; the sparks and hot bolts do
    const pp = ctx.post.params
    pp.bloomThreshold = 1.0
    pp.bloomStrength = 0.45

    // ---- DOM
    const L = this.lay!
    reveal(this.sign, 1 - smoothstep(0.064, 0.078, l), 12)
    setRise(this.signTitle, l > 0.004 && l < 0.074)
    for (let k = 0; k < NF; k++) {
      const s = itemStart(k)
      const p = (l - s) / SPAN
      const v = p >= 0 && p <= 1 ? smoothstep(0.05, 0.15, p) * (1 - smoothstep(0.955, 0.995, p)) : 0
      reveal(this.cards[k].root, v, 10)
      setRise(this.cards[k].name, v > 0.3)
    }
    const boardV = smoothstep(DIR_A - 0.004, DIR_A + 0.012, l) * (1 - smoothstep(DIR_B - 0.002, DIR_B + 0.008, l))
    reveal(this.board, boardV, 12)
    setRise(this.boardTitle, boardV > 0.3)
    if (boardV <= 0.01) this.hoverRow = -1
    const inRows = l >= ROW0 - 0.006 && l <= DIR_B
    const scrollRow = clamp(Math.floor(((l - ROW0) / (ROW1 - ROW0)) * NR), 0, NR - 1)
    const sel = this.hoverRow >= 0 ? this.hoverRow : inRows ? scrollRow : -1
    if (sel !== this.curRow) {
      this.rows.forEach((r, j) => r.classList.toggle('is-cur', j === sel))
      this.curRow = sel
    }

    // ---- the annotation: follows the unit in view (live elevation while hoisting)
    this.updateCallout(l, kk, pk, inItems, carrying, L, frame)
  }

  private updateCallout(l: number, k: number, p: number, inItems: boolean, carrying: number, L: Layout, frame: Frame) {
    const cam = this.ctx.camera
    let vis = 0
    let text = this.calloutText
    if (inItems) {
      const u = this.units[k]
      if (carrying === k && p > 0.2 && p < P_LAND) {
        vis = smoothstep(0.2, 0.26, p)
        text = `CW-${pad(k + 1)} · Hoisting · ${elev(u.root.position.y - PH / 2)}`
      } else if (p >= P_LAND) {
        vis = smoothstep(P_LAND, P_LAND + 0.05, p) * (1 - smoothstep(0.93, 0.98, p))
        text = `CW-${pad(k + 1)} · Set · Level ${pad(slotFloor(k) + 1)} · ${elev(slotFloor(k) * FLOOR_H)}`
      }
      _a.set(PW / 2 - 0.1, PH / 2 - 0.1, PD / 2).applyQuaternion(u.root.quaternion).add(u.root.position)
    }
    if (text !== this.calloutText) {
      this.calloutText = text
      this.callout.label.textContent = text
    }
    // keep the annotation off the chrome bands and (on portrait) off the plate
    if (vis > 0) {
      _b.copy(_a).project(cam)
      const y = (-_b.y * 0.5 + 0.5) * L.H
      const floor = L.portrait ? L.cardTop[k] - 16 : L.bottom
      if (y + this.callout.offset.y - 14 < L.top || y > floor) vis = 0
    }
    this.callout.update(_a, cam, frame.width, frame.height, vis)
  }

  camera(_local: number, _frame: Frame, out: CameraPose) {
    out.position.copy(this.cur.pos)
    out.target.copy(this.cur.tgt)
    out.fov = this.cur.fov
    out.parallax = this.reduced ? 0 : 0.35
  }

  onLeave() {
    this.hoverRow = -1
  }
}

export default function create(): Chapter {
  return new Work()
}
