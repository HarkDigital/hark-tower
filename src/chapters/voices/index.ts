import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { Callout, el, rise, setRise } from '../../core/dom'
import { clamp, lerp, remap, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { SECTIONS, TESTIMONIALS } from '../../content'
import { FLOOR_H } from '../../kit/steel'
import type { World } from '../../world/World'
import { applySite, builtAt } from '../common'
import { TENANT_SPOTS, bayOrigin, faceAxes, makeOffices, type Offices } from './offices'
import { SIGN_H, SIGN_W, SIGN_Y, makeSign, signFontsReady, type Sign } from './signs'
import './voices.css'

/*
 * TENANTS (voices) — the tenants move in.
 *
 * Floors 34 → 44 of steel go up above us through the afternoon, but this
 * chapter lives lower down, on the finished, glazed floors: the offices light
 * up floor by floor (./offices.ts — interior-mapped rooms behind the curtain
 * wall) and a drone flies close along the glass, around the corner of the
 * tower, from one client's office to the next. Each client's company is on
 * the painted-glass band over their window (./signs.ts); inside, a warm office
 * and a silhouette or two. The quote is on a spec plate.
 *
 *   0.000–0.085  intro: from above the frontier the camera looks down the
 *                facade at the lit floors; "We listen. They talk."
 *   0.085–0.920  eight voices (~0.104 each). The drone glides to each tenant's
 *                window (the glide is centred on the card switch, so the
 *                office on screen always matches the quote), then drifts
 *                slowly along the glass while the quote is read.
 *   0.895–1.000  pull back on a long lens: the rest of the glazed floors
 *                light up, floor by floor.
 *
 * Everything is derived from `local`; frame.time only drives idle motion.
 */

const N = TESTIMONIALS.length
const B0 = 0.085
const B1 = 0.92
const SPAN = (B1 - B0) / N
/** scroll hysteresis around every card boundary */
const HYST = 0.005
/** camera glide windows: intro → tenant 0, tenant i-1 → i (centred on the switch), tenant 7 → out */
const G0: [number, number] = [0.07, 0.13]
const GW = 0.5 * SPAN
const GOUT: [number, number] = [0.895, 0.962]
/** floors light up to the glazing during the pull-back */
const CASCADE: [number, number] = [0.905, 0.968]

const smoother = (t: number) => {
  const x = clamp(t)
  return x * x * x * (x * (x * 6 - 15) + 10)
}
/** fast away, long settle */
const easeOut = (t: number) => {
  const u = 1 - clamp(t)
  return 1 - u * u * u * u
}

function glideWin(i: number): [number, number] {
  if (i === 0) return G0
  if (i === N) return GOUT
  const b = B0 + i * SPAN
  return [b - GW / 2, b + GW / 2]
}

/** continuous track position: -1 intro … 0..N-1 tenants … N out, plus the glide phase */
function trackAt(local: number) {
  let s = -1
  let g = 0
  for (let i = 0; i <= N; i++) {
    const [a, b] = glideWin(i)
    if (local < a) break
    const raw = clamp((local - a) / (b - a))
    s = i - 1 + (i === N ? easeOut(raw) : smoother(raw))
    g = raw > 0 && raw < 1 ? Math.sin(Math.PI * raw) : 0
    if (local < b) break
  }
  return { s, g }
}

/**
 * Each tenant gets its own drone framing (landscape): lateral offset along the
 * glass (− = camera to the left), height vs the window, distance, lens, and
 * where the window sits vertically on screen. The glides between them make
 * the drone rise, dip and swing like a real aerial unit.
 */
const CAM = [
  { lat: -6.0, up: -1.2, d: 13.5, fov: 40, ny: 0.02 }, // from the west corner, the city beyond
  { lat: 4.4, up: -0.5, d: 12.0, fov: 40, ny: 0.02 }, // from the other side
  { lat: -3.6, up: -2.2, d: 14.5, fov: 46, ny: -0.13 }, // a little low and wide: glass stacked above
  { lat: -2.8, up: 4.6, d: 12.0, fov: 42, ny: 0.1 }, // from above, looking down the facade
  { lat: -6.5, up: -1.6, d: 15.5, fov: 40, ny: 0.02 }, // wide: the corner and the city
  { lat: -6.0, up: -0.8, d: 13.0, fov: 40, ny: 0.02 }, // round the corner, the south face at left
  { lat: -3.2, up: -2.6, d: 14.0, fov: 48, ny: -0.15 }, // low and wide again
  { lat: -4.0, up: 0.4, d: 18.0, fov: 30, ny: 0.02 }, // long lens, compressed
]

/** 0 = landscape layout, 1 = portrait (mirrors voices.css) */
const portraitK = (f: Frame) => clamp(remap(f.width / Math.max(1, f.height), 1.02, 0.86))

/**
 * The neighbouring tenants' signs never sit under the chrome's plates, the
 * quote plate or the headline, nor half out of frame: a sign that comes
 * within a few px of one (or loses more than a sliver to the frame edge)
 * fades out over SIGN_FADE s, and back once it's clear. Hysteresis on both
 * tests keeps the drone's hover from toggling it. Only the sign of the tenant
 * on screen is exempt (its framing keeps it clear).
 */
const SIGN_GAP: [number, number] = [6, 18] // px: hide below the first once shown, show above the second
const SIGN_OFF: [number, number] = [0.2, 0.1] // fraction outside the frame: hide above / show below
const SIGN_FADE = 0.3
const _sc = new THREE.Vector3()
const _sr = new THREE.Vector3()
const _sn = new THREE.Vector3()

/** separation of two boxes in px (negative = overlapping) */
function gapTo(ax0: number, ay0: number, ax1: number, ay1: number, bx0: number, by0: number, bx1: number, by1: number) {
  return Math.max(bx0 - ax1, ax0 - bx1, by0 - ay1, ay0 - by1)
}
function overlap(ax0: number, ay0: number, ax1: number, ay1: number, bx0: number, by0: number, bx1: number, by1: number) {
  const w = Math.min(ax1, bx1) - Math.max(ax0, bx0)
  const h = Math.min(ay1, by1) - Math.max(ay0, by0)
  return w > 0 && h > 0 ? w * h : 0
}

const UP = new THREE.Vector3(0, 1, 0)
const _f = new THREE.Vector3()
const _r = new THREE.Vector3()
const _u = new THREE.Vector3()

/** A look target that puts world point W at screen NDC (x, y) from camera C. */
function aim(out: THREE.Vector3, C: THREE.Vector3, W: THREE.Vector3, ndcX: number, ndcY: number, fovDeg: number, aspect: number) {
  _f.copy(W).sub(C)
  const D = Math.max(0.1, _f.length())
  _f.divideScalar(D)
  _r.copy(_f).cross(UP).normalize()
  _u.copy(_r).cross(_f)
  const halfH = D * Math.tan(THREE.MathUtils.degToRad(fovDeg / 2))
  return out
    .copy(W)
    .addScaledVector(_r, -ndcX * halfH * aspect)
    .addScaledVector(_u, -ndcY * halfH)
}

/** Interpolate camera positions around the tower's axis (the drone arcs round the corner). */
function cylLerp(out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, t: number) {
  const ra = Math.hypot(a.x, a.z)
  const rb = Math.hypot(b.x, b.z)
  const aa = Math.atan2(a.x, a.z)
  let d = Math.atan2(b.x, b.z) - aa
  d = Math.atan2(Math.sin(d), Math.cos(d))
  const ang = aa + d * t
  const r = lerp(ra, rb, t)
  return out.set(Math.sin(ang) * r, lerp(a.y, b.y, t), Math.cos(ang) * r)
}

interface Pose {
  pos: THREE.Vector3
  tgt: THREE.Vector3
  fov: number
}
const mkPose = (): Pose => ({ pos: new THREE.Vector3(), tgt: new THREE.Vector3(), fov: 40 })

/** Collision-free long-lens positions for the pull-back, chosen against the real city at init. */
interface OutShot {
  pos: THREE.Vector3
  look: THREE.Vector3
}

function cityBoxes(world: World): THREE.Box3[] {
  const boxes: THREE.Box3[] = []
  const m = new THREE.Matrix4()
  world.city.root.traverse(o => {
    const im = o as THREE.InstancedMesh
    if (!im.isInstancedMesh) return
    if (!im.geometry.boundingBox) im.geometry.computeBoundingBox()
    const gb = im.geometry.boundingBox!
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m)
      boxes.push(gb.clone().applyMatrix4(m))
    }
  })
  return boxes
}

function pickOutShot(world: World): OutShot {
  const boxes = cityBoxes(world)
  const ray = new THREE.Ray()
  const hit = new THREE.Vector3()
  const C = new THREE.Vector3()
  const pts = [new THREE.Vector3(10, 150, 10), new THREE.Vector3(10, 110, 10), new THREE.Vector3(10, 70, 10)]
  const inside = (p: THREE.Vector3, pad: number) => boxes.some(b => p.x > b.min.x - pad && p.x < b.max.x + pad && p.z > b.min.z - pad && p.z < b.max.z + pad && p.y < b.max.y + pad)
  const blocked = (a: THREE.Vector3, b: THREE.Vector3) => {
    const len = a.distanceTo(b)
    ray.origin.copy(a)
    ray.direction.copy(b).sub(a).normalize()
    return boxes.some(bx => ray.intersectBox(bx, hit) !== null && hit.distanceTo(a) < len - 25)
  }
  let best: { score: number; pos: THREE.Vector3 } | null = null
  for (const ang of [0.62, 0.52, 0.72, 0.42, 0.82, 0.32, 0.95]) {
    for (const D of [235, 205, 265, 180, 300]) {
      for (const H of [62, 78, 48, 96, 118]) {
        C.set(Math.sin(ang) * D, H, Math.cos(ang) * D)
        if (inside(C, 7)) continue
        const vis = pts.reduce((n, p) => n + (blocked(C, p) ? 0 : 1), 0)
        if (vis < 2) continue
        // prefer: all three visible, the nominal lens, the nominal angle
        const score = vis * 10 - Math.abs(D - 235) / 30 - Math.abs(H - 62) / 25 - Math.abs(ang - 0.62) * 4
        if (!best || score > best.score) best = { score, pos: C.clone() }
      }
    }
  }
  // fallback: inside the site, high and wide (always clear)
  const pos = best?.pos ?? new THREE.Vector3(48, 120, 58)
  return { pos, look: new THREE.Vector3(0, 104, 0) }
}

/* ------------------------------------------------------------------ chapter */

export default function create(): Chapter {
  const group = new THREE.Group()
  let offices: Offices | null = null
  const signs: Sign[] = []
  let out: OutShot = { pos: new THREE.Vector3(150, 62, 180), look: new THREE.Vector3(0, 104, 0) }
  let world: World | null = null

  // DOM
  let intro: HTMLElement
  let introTitle: HTMLElement
  let plate: HTMLElement
  let stack: HTMLElement
  let count: HTMLElement
  let lift: HTMLElement[] = []
  const cards: { root: HTMLElement; parts: HTMLElement[]; h: number }[] = []
  let callout: Callout | null = null
  let shown = -2 // -2 fresh, -1 intro, 0..N-1 card, N out
  let introOn = false
  let stackH = -1
  let deferShow = 0
  const lay = { safeTop: 90, plateLeft: 24, plateRight: 520, plateBottom: 600, plateChrome: 80, plateTopMax: 500, w: 0, h: 0 }
  /** the chrome's plates, flat x0 y0 x1 y1 (measured on resize and entry) */
  const chromeRects: number[] = []
  /** the headline plate while it is up */
  const introRect = [0, 0, 0, 0]
  /** each neighbour sign's fade (0..1); snapped for the first frames after entry */
  const signVis = new Float32Array(N)
  let signSnap = 0

  const pa = mkPose()
  const pb = mkPose()
  const pl = mkPose()
  const pp = mkPose()
  const W = new THREE.Vector3()
  const n = new THREE.Vector3()
  const rgt = new THREE.Vector3()
  const tmp = new THREE.Vector3()
  const anchorPt = new THREE.Vector3()

  const anchors = TESTIMONIALS.map((_, i) => B0 + SPAN * (i + 0.55))

  /* ------------------------------------------------------------ poses */

  /** landscape (portrait = false) or portrait pose k (-1 intro, 0..N-1 tenant, N out) */
  function poseFor(k: number, drift: number, f: Frame, portrait: boolean, o: Pose) {
    const aspect = f.width / Math.max(1, f.height)
    if (k < 0) {
      // intro: a low angle up the tower from the edge of the site — the lit
      // floors, the mirror glass above them, the steel and the crane on top
      if (!portrait) {
        o.pos.set(-24 + drift * 3, 56 + drift * 5, 62)
        o.fov = 56
        W.set(6, 126, 0)
        aim(o.tgt, o.pos, W, 0.26, 0.1, o.fov, aspect)
      } else {
        // portrait: from the south-east corner, clear of the sun's glint in the glass
        o.pos.set(34 + drift * 2, 60 + drift * 5, 62)
        o.fov = 62
        W.set(6, 122, 6)
        aim(o.tgt, o.pos, W, 0, 0.04, o.fov, aspect)
      }
      return o
    }
    if (k >= N) {
      o.pos.copy(out.pos)
      if (!portrait) {
        o.fov = 44
        aim(o.tgt, o.pos, out.look, 0.2, 0.02, o.fov, aspect)
      } else {
        o.fov = 60
        aim(o.tgt, o.pos, out.look, 0, 0.12, o.fov, aspect)
      }
      return o
    }
    const s = TENANT_SPOTS[k]
    faceAxes(s.face, n, rgt)
    bayOrigin(s.face, s.bay, s.floor, W)
    if (!portrait) {
      // a slow drone close to the glass, each tenant from its own angle
      const c = CAM[k]
      W.y += 2.3
      o.fov = c.fov
      o.pos.copy(W).addScaledVector(n, c.d).addScaledVector(rgt, c.lat + drift * 1.9).addScaledVector(UP, c.up + drift * 0.35)
      const w = f.width
      const freeCentre = (lay.plateRight + w) / 2
      const ndcX = clamp((freeCentre / w) * 2 - 1, 0.16, 0.5)
      tmp.copy(W).addScaledVector(rgt, drift * 0.5)
      aim(o.tgt, o.pos, tmp, ndcX, c.ny, o.fov, aspect)
    } else {
      // square on, pulled back so the bay spans ~80% of the width, and the
      // office + its fascia (0.6 → 4.6 m) centred in the free window between
      // the chrome and the (tallest) quote plate
      W.y += 2.62
      o.fov = 52
      const tanH = Math.tan(THREE.MathUtils.degToRad(o.fov / 2))
      const H = f.height
      const top = lay.safeTop
      const bot = Math.max(top + 120, lay.plateTopMax - 14)
      const regionH = bot - top
      const dW = 3.7 / (tanH * aspect)
      const dH = (4.5 * H) / (regionH * 2 * tanH)
      const d = Math.max(9, dW, dH)
      const c = CAM[k]
      o.pos.copy(W).addScaledVector(n, d).addScaledVector(rgt, c.lat * 0.3 + drift * 1.1).addScaledVector(UP, c.up * 0.35 + 0.2 + drift * 0.25)
      const cy = 1 - (top + bot) / H
      aim(o.tgt, o.pos, W, 0, cy, o.fov, aspect)
    }
    return o
  }

  /** blended landscape/portrait pose */
  function pose(k: number, drift: number, f: Frame, o: Pose) {
    const pk = portraitK(f)
    if (pk <= 0) return poseFor(k, drift, f, false, o)
    if (pk >= 1) return poseFor(k, drift, f, true, o)
    poseFor(k, drift, f, false, pl)
    poseFor(k, drift, f, true, pp)
    o.pos.lerpVectors(pl.pos, pp.pos, pk)
    o.tgt.lerpVectors(pl.tgt, pp.tgt, pk)
    o.fov = lerp(pl.fov, pp.fov, pk)
    return o
  }

  /* -------------------------------------------------------------- DOM */

  function buildDom(stage: HTMLElement) {
    intro = el('div', 'vc-intro hud-panel', undefined, stage)
    el('p', 'hud-eyebrow vc-eyebrow', SECTIONS.voices.eyebrow, intro)
    const m = SECTIONS.voices.title.match(/^(.*?\.)\s+(.*)$/)
    const html = m ? `${m[1]} <em>${m[2]}</em>` : SECTIONS.voices.title
    introTitle = rise(el('h2', 'hud-h2 vc-title', undefined, intro), html)

    plate = el('figure', 'vc-plate hud-panel', undefined, stage)
    const head = el('div', 'vc-head', undefined, plate)
    count = el('p', 'vc-count', '', head)
    const liftWrap = el('div', 'vc-lift', undefined, head)
    lift = TESTIMONIALS.map((t, i) => {
      const b = el('button', 'vc-lift-b', String(i + 1), liftWrap)
      b.type = 'button'
      b.setAttribute('aria-label', `${t.name}, ${t.company}`)
      b.addEventListener('click', () => window.__hark?.land('voices', true, anchors[i]))
      return b
    })
    stack = el('div', 'vc-stack', undefined, plate)
    TESTIMONIALS.forEach(t => {
      const root = el('div', 'vc-card', undefined, stack)
      if (t.quote.length > 170) root.classList.add('vc-card--long')
      const q = rise(el('blockquote', 'hud-quote vc-quote', undefined, root), `“${t.quote}”`)
      const who = el('p', 'vc-who', undefined, root)
      const name = rise(el('span', 'hud-label vc-name', undefined, who), t.name)
      const co = rise(el('span', 'hud-label vc-co', undefined, who), t.company)
      cards.push({ root, parts: [q, name, co], h: 0 })
    })

    callout = new Callout(stage, { side: 'right', offset: { x: 64, y: -46 } })
    callout.root.classList.add('vc-callout')

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(entries => {
        for (const e of entries) {
          const c = cards.find(k => k.root === e.target)
          if (c) c.h = (e.target as HTMLElement).offsetHeight
        }
        applyStackHeight()
        measure()
      })
      cards.forEach(c => ro.observe(c.root))
      ro.observe(head)
    }
    window.addEventListener('resize', measure)
    measure()
  }

  function measure() {
    if (!plate) return
    const cs = getComputedStyle(plate)
    const gap = parseFloat(cs.rowGap) || 0
    const head = plate.firstElementChild as HTMLElement
    const chrome = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) + gap + (head?.offsetHeight ?? 0) + 4
    let tallest = 0
    for (const c of cards) tallest = Math.max(tallest, c.h || c.root.offsetHeight)
    const bottom = plate.offsetTop + plate.offsetHeight
    lay.safeTop = intro.offsetTop
    lay.plateLeft = plate.offsetLeft
    lay.plateRight = plate.offsetLeft + plate.offsetWidth
    lay.plateBottom = bottom
    lay.plateChrome = chrome
    lay.plateTopMax = bottom - (chrome + tallest)
    lay.w = window.innerWidth
    lay.h = window.innerHeight
    introRect[0] = intro.offsetLeft
    introRect[1] = intro.offsetTop
    introRect[2] = intro.offsetLeft + intro.offsetWidth
    introRect[3] = intro.offsetTop + intro.offsetHeight
    measureChrome()
  }

  function measureChrome() {
    chromeRects.length = 0
    document.querySelectorAll<HTMLElement>('.chr .ch-plate, .chr .ch-cta').forEach(e => {
      if (e.closest('.ch-menu')) return
      const r = e.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) chromeRects.push(r.left, r.top, r.right, r.bottom)
    })
  }

  /**
   * Whether sign `i` may show: clear of every plate by a few px and (nearly)
   * whole in frame. `was` = its current state (the thresholds have hysteresis).
   */
  function signClear(i: number, was: boolean, cam: THREE.Camera, W: number, H: number) {
    const sg = signs[i]
    faceAxes(TENANT_SPOTS[i].face, _sn, _sr)
    // seen nearly edge-on round the corner it's a squeezed, unreadable word
    _sc.copy(cam.position).sub(sg.mesh.position).normalize()
    if (_sc.dot(_sn) < (was ? 0.3 : 0.4)) return false
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (let c = 0; c < 4; c++) {
      _sc.copy(sg.mesh.position)
        .addScaledVector(_sr, (c & 1 ? 0.5 : -0.5) * SIGN_W)
        .addScaledVector(UP, (c & 2 ? 0.5 : -0.5) * SIGN_H)
        .project(cam)
      if (_sc.z > 1 || _sc.z < -1) return false // behind the camera / clipped
      const x = (_sc.x * 0.5 + 0.5) * W
      const y = (-_sc.y * 0.5 + 0.5) * H
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    const area = Math.max(1, (x1 - x0) * (y1 - y0))
    if (1 - overlap(x0, y0, x1, y1, 0, 0, W, H) / area > SIGN_OFF[was ? 0 : 1]) return false
    let gap = Infinity
    for (let k = 0; k < chromeRects.length; k += 4) {
      gap = Math.min(gap, gapTo(x0, y0, x1, y1, chromeRects[k], chromeRects[k + 1], chromeRects[k + 2], chromeRects[k + 3]))
    }
    if (shown >= 0 && shown < N) {
      const top = lay.plateBottom - lay.plateChrome - (cards[shown].h || lay.plateBottom - lay.plateTopMax - lay.plateChrome)
      gap = Math.min(gap, gapTo(x0, y0, x1, y1, lay.plateLeft, top, lay.plateRight, lay.plateBottom))
    }
    if (introOn) gap = Math.min(gap, gapTo(x0, y0, x1, y1, introRect[0], introRect[1], introRect[2], introRect[3]))
    return gap > SIGN_GAP[was ? 0 : 1]
  }

  function applyStackHeight(snap = false) {
    if (shown < 0 || shown >= N) return
    const c = cards[shown]
    const h = c.h || (c.h = c.root.offsetHeight)
    if (h && h !== stackH) {
      stackH = h
      if (snap) stack.style.transition = 'none'
      stack.style.height = `${h}px`
      if (snap) {
        void stack.offsetHeight
        stack.style.transition = ''
      }
    }
  }

  function setCard(i: number, on: boolean) {
    const c = cards[i]
    if (!c) return
    c.root.classList.toggle('is-on', on)
    for (const p of c.parts) setRise(p, on)
  }

  function sinkAll() {
    for (let i = 0; i < N; i++) setCard(i, false)
    setRise(introTitle, false)
    intro.classList.remove('is-on')
    plate.classList.remove('is-on')
    introOn = false
    shown = -2
    stackH = -1
  }

  function wantAt(local: number) {
    let want = local < B0 ? -1 : local >= B1 ? N : Math.min(N - 1, Math.floor((local - B0) / SPAN))
    if (shown >= -1 && want !== shown && Math.abs(want - shown) === 1) {
      const hi = Math.max(want, shown)
      const boundary = hi >= N ? B1 : B0 + hi * SPAN
      if (Math.abs(local - boundary) < HYST) want = shown
    }
    return want
  }

  function show(next: number) {
    if (next === shown) return
    const wasCard = shown >= 0 && shown < N
    if (wasCard) setCard(shown, false)
    shown = next
    const isCard = next >= 0 && next < N
    plate.classList.toggle('is-on', isCard)
    if (isCard) {
      setCard(next, true)
      count.innerHTML = `<span class="vc-count-k">Tenant </span><b>${String(next + 1).padStart(2, '0')}</b> / ${String(N).padStart(2, '0')}`
      lift.forEach((d, i) => {
        d.classList.toggle('is-on', i === next)
        d.classList.toggle('is-past', i < next)
      })
      applyStackHeight(!wasCard)
      const s = TENANT_SPOTS[next]
      if (callout) callout.label.textContent = `Level ${s.floor} · El. +${(s.floor * FLOOR_H).toFixed(1).padStart(5, '0')}`
    }
  }

  /* ----------------------------------------------------------- chapter */

  return {
    id: 'voices',
    group,
    anchors,

    async init(ctx: ChapterContext) {
      world = ctx.world
      buildDom(ctx.stage)
      await nextFrame()
      offices = makeOffices(ctx.mobile)
      group.add(offices.mesh)
      await nextFrame()
      out = pickOutShot(ctx.world)
      const fontsOk = await signFontsReady()
      for (let i = 0; i < N; i++) {
        const t = TESTIMONIALS[i]
        const sg = makeSign(t.company, t.name, ctx.mobile)
        const s = TENANT_SPOTS[i]
        faceAxes(s.face, n, rgt)
        bayOrigin(s.face, s.bay, s.floor, tmp)
        sg.mesh.position.copy(tmp).addScaledVector(UP, SIGN_Y).addScaledVector(n, 0.04)
        sg.mesh.rotation.y = s.face === 0 ? 0 : Math.PI / 2
        sg.mesh.userData.x0 = sg.mesh.position.x
        group.add(sg.mesh)
        signs.push(sg)
        if (i % 3 === 2) await nextFrame()
      }
      if (!fontsOk) document.fonts?.ready.then(() => signs.forEach(sg => sg.redraw()))
    },

    onEnter() {
      sinkAll()
      measure()
      deferShow = 1
      // the first frame still projects through the last chapter's camera
      signSnap = 3
    },

    onLeave() {
      sinkAll()
    },

    update(local, frame, ctx) {
      applySite(ctx, 'voices', local)
      const pk = portraitK(frame)
      const { s } = trackAt(local)
      const wp = ctx.world.params

      /* ---- the site ---- */
      // the crane slews slowly across the afternoon; the hook works a load
      wp.crane.yaw = 0.85 + local * 1.5
      wp.crane.reach = 0.42 + 0.3 * Math.sin(local * Math.PI)
      wp.crane.drop = 12 + 10 * local
      wp.fog = 1

      /* ---- the offices: lit floor by floor ---- */
      if (signSnap > 0) signSnap--
      if (offices) {
        const glazedNow = ctx.world.tower.frontier / FLOOR_H - 6
        const cascade = smoothstep(CASCADE[0], CASCADE[1], local)
        const maxLit = builtAt('voices', local) - 6.3
        let lit = 23 + s + 0.9
        lit += cascade * Math.max(0, maxLit - 31.9)
        // only floors whose curtain wall has fully landed (units swing in from outboard)
        lit = Math.min(lit, glazedNow - 1.2)
        const u = offices.uniforms
        u.uLit.value = lit
        u.uSwayTop.value = ctx.world.tower.swayAt(240)
        // the rooms read brighter as the afternoon warms
        u.uInterior.value = lerp(0.44, 0.54, local) * (1 + 0.45 * cascade)
        for (let i = 0; i < signs.length; i++) {
          const sp = TENANT_SPOTS[i]
          const sg = signs[i]
          sg.mesh.position.x = sg.mesh.userData.x0 + ctx.world.tower.swayAt(sg.mesh.position.y)
          let on = smoothstep(sp.floor + 0.02, sp.floor + 0.14, lit)
          // the tenant on screen keeps its sign; a neighbour's shows only
          // where it sits whole and clear of the plates (never a cut word)
          const want = on > 0 && signClear(i, signVis[i] > 0.5, ctx.camera, frame.width, frame.height) ? 1 : 0
          signVis[i] = signSnap > 0 ? want : signVis[i] + clamp(want - signVis[i], -frame.dt / SIGN_FADE, frame.dt / SIGN_FADE)
          // (exempt only as the drone settles on it: mid-glide it obeys the guard too)
          const focus = 1 - clamp((Math.abs(s - i) - 0.04) * 8)
          on *= Math.max(focus, signVis[i])
          sg.setOpacity(Math.round(on * 100) / 100)
        }
      }

      /* ---- post ---- */
      const post = ctx.post.params
      post.bloomStrength = 0.42
      post.vignette = 0.3

      /* ---- DOM ---- */
      if (deferShow > 0) {
        deferShow--
        return
      }
      const want = wantAt(local)
      show(want)
      // landscape keeps the headline over the first voice while the camera dives
      const introEnd = pk < 0.5 ? 0.125 : B0
      const wantIntro = local > 0.012 && local < introEnd
      if (wantIntro !== introOn) {
        introOn = wantIntro
        setRise(introTitle, introOn)
        intro.classList.toggle('is-on', introOn)
      }

      /* ---- the drawing annotation on the tenant's window ---- */
      if (callout) {
        const i = shown
        const settled = i >= 0 && i < N ? 1 - clamp(Math.abs(s - i) * 7) : 0
        let vis = settled
        if (vis > 0) {
          const sp = TENANT_SPOTS[i]
          faceAxes(sp.face, n, rgt)
          bayOrigin(sp.face, sp.bay, sp.floor, anchorPt)
          anchorPt.addScaledVector(rgt, SIGN_W / 2).addScaledVector(UP, SIGN_Y + 0.5)
          // keep the label clear of the chrome and the plate (portrait)
          tmp.copy(anchorPt).project(ctx.camera)
          const y = (-tmp.y * 0.5 + 0.5) * frame.height
          const x = (tmp.x * 0.5 + 0.5) * frame.width
          if (y - 60 < lay.safeTop || y > lay.plateTopMax - 10 || (pk < 0.5 && x < lay.plateRight + 20)) vis = 0
        }
        callout.root.classList.toggle('is-drawn', vis > 0.5)
        callout.update(anchorPt, ctx.camera, frame.width, frame.height, vis)
      }
    },

    camera(local, frame, o: CameraPose) {
      const rm = frame.reducedMotion
      const { s, g } = trackAt(local)
      const k0 = Math.floor(s)
      const k1 = Math.min(N, k0 + 1)
      const t = s - k0
      // a slow drift along the glass while each quote is read
      const r = (local - B0) / SPAN - 0.55
      let drift = clamp(r - s, -0.5, 0.5)
      if (s < 0) drift = clamp(local / B0, 0, 1) * 0.8 - 0.4
      if (s > N - 1) drift = clamp(drift, -0.5, 0.5) * (1 - (s - (N - 1)))
      if (rm) drift = 0
      pose(k0, drift, frame, pa)
      if (t > 1e-4 && k1 !== k0) {
        pose(k1, drift, frame, pb)
        cylLerp(o.position, pa.pos, pb.pos, t)
        o.target.lerpVectors(pa.tgt, pb.tgt, t)
        o.fov = lerp(pa.fov, pb.fov, t)
      } else {
        o.position.copy(pa.pos)
        o.target.copy(pa.tgt)
        o.fov = pa.fov
      }
      // idle: the faintest hover (a drone holding station)
      if (!rm) {
        o.position.y += Math.sin(frame.time * 0.6) * 0.06
        o.position.x += Math.sin(frame.time * 0.43 + 1.3) * 0.05
        // bank into each glide
        o.roll = -0.025 * g * (1 - 0.5 * portraitK(frame))
      }
      o.parallax = rm ? 0 : 0.35
    },
  }
}
