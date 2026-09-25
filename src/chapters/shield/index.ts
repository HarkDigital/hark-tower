import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { Callout, el, reveal, rise, setRise } from '../../core/dom'
import { clamp, lerp, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { SECURITY, STATS } from '../../content'
import { applySite, BANDS, frontierY } from '../common'
import { FLOOR_H } from '../../kit/steel'
import { Damper, TMD } from './damper'
import { Overcast } from './overcast'
import { BANDS as CP_BANDS, CP_MAX, CP_MIN, PressureSkin, RAMP, Streamlines, TOWER_TOP, WIND, WIND_YAW } from './cfd'
import './shield.css'

/*
 * WIND LOAD — "Hacked? Breathe."  (floors 44 → 50, late afternoon)
 *
 * The attack is a wind load the analysis says the unfinished top can't take.
 * Engineering, not weather:
 *
 *   0.00–0.34  LOAD     a thin cool overcast flattens the light; the wind-load
 *                       analysis is drawn over the tower like a CFD result —
 *                       a scan paints the design envelope with a banded Cp
 *                       pressure map (hazard orange on the windward face,
 *                       blueprint cyan where the flow tears off the corners),
 *                       and streamlines wrap the tower and shed a flapping
 *                       wake. The top SWAYS (up to 1.8 m), the crane
 *                       weathervanes downwind on free slew, the raising gang
 *                       stands down. 'Hacked?' + the eyebrow from 0.06; the
 *                       annotation WIND LOAD EXCEEDED and the Cp colour key.
 *   0.34–0.60  BREATHE  the overlay hands over as the camera flies in through
 *                       the open steel to the corner bay of floor 44: the cyan
 *                       drawing of a TUNED MASS DAMPER is filled in by steel
 *                       (a Ø5.4 m polished sphere on cable bundles, eight
 *                       hydraulic dampers at its band), it counter-swings and
 *                       the sway dies away. '<em>Breathe.</em>' rises with the
 *                       body plate as the damper engages (0.38).
 *                       (Landing / intro 0.45: headline + body settled.)
 *   0.60–1.00  STEADY   the overcast breaks into warm late light; a thin signal
 *                       green status stripe draws itself round the damper
 *                       (monitoring). '24/7' + label + the emergency CTA
 *                       (anchor 0.8).
 *
 * Everything derives from `local`; frame.time only adds idle motion (the flow
 * clock, the sway phase, weathervaning, the status sweep). Reduced motion: no
 * sway, no counter-swing, no drone shake, and the flow only moves with scroll.
 */

const STAT = STATS.find(s => s.value === '24/7') ?? STATS[STATS.length - 1]
/** callout leader offsets (px): wide screens label to the right, tall ones above */
const CO_WIDE = { x: 70, y: -58 }
const CO_TALL = { x: 34, y: -100 }
const CO_WARN = { x: 78, y: -66 }
/** portrait: the Cp key sits up top, so the warning hangs below its anchor, over the steel */
const CO_WARN_TALL = { x: 36, y: 64 }
const SWAY_MAX = 1.8

/** Story envelopes — pure functions of local. */
function story(l: number) {
  const load = lerp(0.55, 1, smoothstep(0, 0.14, l)) * (1 - smoothstep(0.34, 0.66, l))
  const decay = 1 - smoothstep(0.3, 0.6, l)
  return {
    load,
    sway: SWAY_MAX * lerp(0.35, 1, smoothstep(0, 0.16, l)) * Math.pow(decay, 1.5),
    clear: smoothstep(0.5, 0.82, l),
    draw: smoothstep(0.02, 0.17, l),
    /** the analysis overlay: painted in by the scan, handed over before the fly-in */
    cfd: smoothstep(0.0, 0.05, l) * (1 - smoothstep(0.27, 0.34, l)),
    scan: smoothstep(0.02, 0.15, l),
    flow: smoothstep(0.03, 0.19, l),
    lines: 1 - smoothstep(0.29, 0.37, l),
    fill: smoothstep(0.31, 0.43, l),
    release: smoothstep(0.38, 0.47, l),
    ring: smoothstep(0.64, 0.77, l),
    warn: smoothstep(0.1, 0.15, l) * (1 - smoothstep(0.25, 0.29, l)),
    key: smoothstep(0.08, 0.13, l) * (1 - smoothstep(0.26, 0.31, l)),
    tmdCo: smoothstep(0.4, 0.43, l) * (1 - smoothstep(0.57, 0.61, l)),
    okCo: smoothstep(0.72, 0.77, l) * (1 - smoothstep(0.93, 0.965, l)),
    /** eyebrow + 'Hacked?' over the load, then 'Breathe.' + the body when the damper engages */
    a: smoothstep(0.045, 0.075, l) * (1 - smoothstep(0.6, 0.635, l)),
    /** portrait: copy A lifts to make room, then the body plate fades in */
    lift: smoothstep(0.365, 0.395, l),
    plate: smoothstep(0.385, 0.415, l),
    b: smoothstep(0.655, 0.69, l) * (1 - smoothstep(0.945, 0.975, l)),
  }
}

/** the Cp key's bar: the shader's banded ramp, sampled the same way (linear), as CSS */
function keyGradient() {
  const cols = RAMP.map(h => new THREE.Color(h))
  const c = new THREE.Color()
  const at = (x: number) => {
    const f = clamp(x) * 5
    const i = Math.min(4, Math.floor(f))
    return c.copy(cols[i]).lerp(cols[i + 1], f - i)
  }
  const stops: string[] = []
  for (let i = 0; i < CP_BANDS; i++) {
    const hex = `#${at((i + 0.5) / CP_BANDS).getHexString()}`
    stops.push(`${hex} ${((i / CP_BANDS) * 100).toFixed(1)}% ${(((i + 1) / CP_BANDS) * 100).toFixed(1)}%`)
  }
  // isobars between the bands, over the colours
  const w = 100 / CP_BANDS
  const iso = `repeating-linear-gradient(90deg, transparent 0 calc(${w}% - 1px), rgba(8, 10, 14, 0.45) calc(${w}% - 1px) ${w}%)`
  return `${iso}, linear-gradient(90deg, ${stops.join(', ')})`
}

// ------------------------------------------------------------------ camera

type Subject = 'load' | 'tmd' | 'wide'
interface Key {
  l: number
  s: Subject
  /** orbit angle around the subject (rad, 0 = from +z, + toward +x) */
  a: number
  /** elevation of the camera above the subject (rad; negative = looking up) */
  e: number
  d: number
  fov: number
  /** where the subject sits on screen (NDC) */
  ox: number
  oy: number
}

const LAND: Key[] = [
  // the analysis: a 3/4 view over the curtain wall and the open steel, the
  // streamlines seen a little from above so they read as flow round the body
  { l: 0.0, s: 'load', a: 0.6, e: 0.26, d: 104, fov: 42, ox: 0.2, oy: 0.0 },
  { l: 0.15, s: 'load', a: 0.76, e: 0.32, d: 96, fov: 40, ox: 0.22, oy: 0.02 },
  { l: 0.28, s: 'load', a: 0.98, e: 0.3, d: 84, fov: 40, ox: 0.22, oy: 0.04 },
  // the damper, framed between two perimeter columns of the +x face
  { l: 0.41, s: 'tmd', a: 1.49, e: 0.1, d: 30, fov: 31, ox: 0.27, oy: -0.02 },
  { l: 0.57, s: 'tmd', a: 1.56, e: 0.085, d: 28, fov: 31, ox: 0.28, oy: 0.0 },
  { l: 0.75, s: 'wide', a: 1.3, e: 0.1, d: 44, fov: 38, ox: 0.24, oy: 0.0 },
  { l: 1.0, s: 'wide', a: 1.18, e: 0.08, d: 54, fov: 38, ox: 0.24, oy: 0.02 },
]
const TALL: Key[] = [
  { l: 0.0, s: 'load', a: 0.6, e: 0.26, d: 150, fov: 50, ox: 0, oy: 0.2 },
  { l: 0.15, s: 'load', a: 0.76, e: 0.32, d: 140, fov: 50, ox: 0, oy: 0.22 },
  { l: 0.28, s: 'load', a: 0.98, e: 0.3, d: 124, fov: 50, ox: 0, oy: 0.24 },
  { l: 0.41, s: 'tmd', a: 1.5, e: 0.12, d: 44, fov: 44, ox: 0.02, oy: 0.36 },
  { l: 0.57, s: 'tmd', a: 1.56, e: 0.1, d: 41, fov: 44, ox: 0.02, oy: 0.36 },
  { l: 0.75, s: 'wide', a: 1.3, e: 0.1, d: 70, fov: 48, ox: 0, oy: 0.34 },
  { l: 1.0, s: 'wide', a: 1.18, e: 0.08, d: 78, fov: 48, ox: 0, oy: 0.34 },
]

const _S0 = new THREE.Vector3()
const _S1 = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _v = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

function subject(s: Subject, F: number, out: THREE.Vector3) {
  // the curtain wall's top (6 floors under the frontier) and the steel above it
  if (s === 'load') return out.set(4, F - 19, 4)
  if (s === 'tmd') return out.set(TMD.x, TMD.y + 0.9, TMD.z)
  // the steady wide: the damper floors and the top of the steel
  return out.set(10, TMD.y + 2.5 + (F - TMD.y) * 0.12, 10)
}

// ------------------------------------------------------------------ chapter

export default function create(): Chapter {
  const group = new THREE.Group()
  group.name = 'shield'
  let damper: Damper
  let sky: Overcast
  let skin: PressureSkin
  let lines: Streamlines
  let copyA: HTMLElement, plate: HTMLElement, copyB: HTMLElement, scrim: HTMLElement, probe: HTMLElement, key: HTMLElement
  let titleA: HTMLElement, titleB: HTMLElement, stat: HTMLElement
  let warn: Callout, tmdCo: Callout, okCo: Callout, drift: HTMLElement
  let stage: HTMLElement
  const fogCol = new THREE.Color()
  const swayTop = new THREE.Vector3()
  const anchor = new THREE.Vector3()
  /** camera basis from the last pose (for callout anchors on silhouettes) */
  const camRight = new THREE.Vector3(1, 0, 0)
  const camToward = new THREE.Vector3(0, 0, 1)
  let lastDrift = ''
  let lastShift = -1
  // layout measured on resize (never per frame)
  const labelW = new Map<Callout, number>()
  const lay = { dirty: true, top: 90, bottom: 90, aRight: 0, aTop: 0, aHidden: 0, bRight: 0, bTop: 0, w: 0, h: 0 }
  /** portrait: how far copy A sits lowered while only 'Hacked?' shows (px, this frame) */
  let shiftA = 0

  function measure(frame: Frame) {
    lay.dirty = false
    lay.w = frame.width
    lay.h = frame.height
    lay.top = probe.offsetTop
    lay.bottom = frame.height - (probe.offsetTop + probe.offsetHeight)
    const rb = copyB.getBoundingClientRect()
    // the copy's real right edge: the plate, the eyebrow chip and the headline's
    // words (every scroll-driven transform here is vertical, so x is stable)
    let right = 0
    for (const n of copyA.querySelectorAll<HTMLElement>('.sh-eyebrow, .sh-plate, .rise-w')) right = Math.max(right, n.getBoundingClientRect().right)
    lay.aRight = right || copyA.getBoundingClientRect().right
    // untransformed (the portrait lowering is added per frame)
    lay.aTop = copyA.offsetTop
    // portrait: copy A is bottom-anchored; while 'Breathe.' and the body are
    // still to come, 'Hacked?' is lowered onto the bottom edge
    // (a rect difference inside copy A: its own transform cancels out)
    lay.aHidden = frame.height > frame.width ? Math.max(0, copyA.getBoundingClientRect().bottom - titleB.getBoundingClientRect().top) : 0
    lay.bRight = rb.right
    lay.bTop = rb.top
    for (const c of [warn, tmdCo, okCo]) labelW.set(c, c.label.offsetWidth)
  }

  /**
   * Place a callout, keeping its label off the chrome bands and the copy: on a
   * narrow landscape screen the leader shortens so the label still fits on the
   * right; if it would have to flip left onto the copy, it hides instead.
   */
  function place(c: Callout, at: THREE.Vector3, vis: number, ctx: ChapterContext, frame: Frame, copyVis: 'a' | 'b' | null, base: { x: number; y: number }) {
    if (vis <= 0.001) {
      c.update(at, ctx.camera, frame.width, frame.height, 0)
      return
    }
    _v.copy(at).project(ctx.camera)
    const w = frame.width
    const x = (_v.x * 0.5 + 0.5) * w
    const y = (-_v.y * 0.5 + 0.5) * frame.height
    const lw = labelW.get(c) || 240
    c.offset.y = base.y
    c.offset.x = base.x
    const room = w - 12 - 8 - lw - x
    if (room < base.x) c.offset.x = Math.max(14, room)
    const labelY = y + c.offset.y
    let ok = _v.z < 1 && Math.min(y, labelY) > lay.top + 12 && Math.max(y, labelY + 24) < frame.height - lay.bottom - 8
    const portrait = frame.height > frame.width
    if (ok && copyVis) {
      const copyRight = copyVis === 'a' ? lay.aRight : lay.bRight
      if (portrait) ok = Math.max(y, labelY + 30) < (copyVis === 'a' ? lay.aTop + shiftA : lay.bTop) - 10
      else {
        const flips = room < 14
        const labelLeft = flips ? x - c.offset.x - 8 - lw : x
        ok = x > copyRight + 28 && labelLeft > copyRight + 12
      }
    }
    c.update(at, ctx.camera, frame.width, frame.height, ok ? vis : 0)
  }

  return {
    id: 'shield',
    group,
    anchors: [0.8],

    async init(ctx) {
      damper = new Damper(ctx.mobile)
      group.add(damper.root)
      await nextFrame()
      sky = new Overcast(ctx.mobile)
      skin = new PressureSkin()
      lines = new Streamlines(ctx.mobile)
      group.add(sky.mesh, skin.mesh, lines.mesh)
      await nextFrame()

      stage = ctx.stage
      scrim = el('div', 'sh-scrim', undefined, stage)
      probe = el('div', 'sh-probe', undefined, stage)

      // the Cp colour key (the analysis legend)
      key = el('div', 'sh-key', undefined, stage)
      const kh = el('div', 'sh-key-head', undefined, key)
      el('span', 'hud-label sh-key-k', 'CFD · Wind pressure', kh)
      el('span', 'hud-label sh-key-u', 'Cp', kh)
      const bar = el('div', 'sh-key-bar', undefined, key)
      bar.style.backgroundImage = keyGradient()
      const ticks = el('div', 'sh-key-ticks', undefined, key)
      for (let i = 0; i <= 5; i++) {
        const v = CP_MIN + ((CP_MAX - CP_MIN) * i) / 5
        const tk = el('span', '', v === 0 ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`, ticks)
        tk.style.left = `${i * 20}%`
      }
      const ends = el('div', 'sh-key-ends', undefined, key)
      el('span', '', 'Suction', ends)
      el('span', '', 'Pressure', ends)

      copyA = el('div', 'sh-a', undefined, stage)
      el('p', 'hud-eyebrow sh-eyebrow', SECURITY.eyebrow, copyA)
      // the headline in two beats: 'Hacked?' over the load, 'Breathe.' when the damper engages
      const title = el('h2', 'hud-title sh-title', undefined, copyA)
      title.setAttribute('aria-label', SECURITY.title)
      const [wordA, wordB] = SECURITY.title.split(/\s+(?=\S+$)/)
      titleA = rise(el('span', 'sh-t sh-t1', undefined, title), wordA)
      title.append(' ')
      titleB = rise(el('span', 'sh-t sh-t2', undefined, title), `<em>${wordB}</em>`)
      plate = el('div', 'hud-panel sh-plate', undefined, copyA)
      el('p', 'hud-body', SECURITY.body, plate)

      copyB = el('div', 'hud-panel sh-b', undefined, stage)
      const head = el('div', 'sh-b-head', undefined, copyB)
      el('span', 'hud-label', 'S-501 · Wind load', head)
      el('span', 'hud-label sh-live', 'Monitoring', head)
      stat = rise(el('p', 'hud-title sh-stat', undefined, copyB), STAT.value)
      el('hr', 'hud-rule sh-rule', undefined, copyB)
      el('p', 'hud-body sh-stat-label', STAT.label, copyB)
      const cta = el('a', 'hud-btn sh-cta', SECURITY.cta, copyB)
      cta.href = SECURITY.href

      warn = new Callout(stage, { side: 'right', offset: { x: 78, y: -66 } })
      warn.root.classList.add('sh-co', 'sh-co--warn')
      el('span', 'sh-co-k', 'Wind load exceeded', warn.label)
      const v = el('span', 'sh-co-v', undefined, warn.label)
      v.append('Top drift ')
      drift = el('b', '', '±1.8 m', v)
      v.append(' · crane on free slew')

      tmdCo = new Callout(stage, { side: 'right', offset: { x: 70, y: -58 } })
      tmdCo.root.classList.add('sh-co')
      el('span', 'sh-co-k', 'Tuned mass damper', tmdCo.label)
      el('span', 'sh-co-v', 'TMD-01 · Ø5.4 m steel · EL. +180.0', tmdCo.label)

      okCo = new Callout(stage, { side: 'right', offset: { x: 70, y: -56 } })
      okCo.root.classList.add('sh-co', 'sh-co--ok')
      el('span', 'sh-co-k', 'Status: monitoring', okCo.label)
      el('span', 'sh-co-v', '8 hydraulic dampers · sway nominal', okCo.label)

      for (const n of [scrim, copyA, copyB, key]) reveal(n, 0, 0)
      reveal(plate, 0)
      const mark = () => (lay.dirty = true)
      window.addEventListener('resize', mark)
      document.fonts?.ready.then(mark)
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(mark).observe(stage)
    },

    onEnter() {
      lay.dirty = true
    },

    update(local, frame, ctx) {
      applySite(ctx, 'shield', local)
      const st = story(local)
      const rm = ctx.reducedMotion
      const t = frame.time
      const p = ctx.world.params
      const F = frontierY('shield', local)
      // one flow clock (metres of flow) for the streamlines, the pressure ripple
      // and the overcast: scroll always drives it; time only outside reduced motion
      const clock = local * 260 + (rm ? 0 : t * 9)

      // ---- the light: a thin cool overcast, clearing into warm late light
      const band = BANDS.shield.time
      p.time = lerp(lerp(band[0], band[1], local), 0.575, st.clear)
      p.fog = 1 + st.load * 0.45
      p.env = 1 - st.load * 0.25
      p.sway = rm ? 0 : st.sway
      // site stand-down: no steel is raised in this wind; the gang is back when it clears
      ;(p as { activity?: number }).activity = 1 - st.load
      p.ghost = 1 - 0.2 * st.cfd
      // the crane: weathervaning downwind on free slew, parked (downwind) once it clears
      p.crane.yaw = WIND_YAW + (rm ? 0 : st.load * (0.3 * Math.sin(t * 0.37) + 0.08 * Math.sin(t * 1.13 + 0.7)))
      p.crane.reach = lerp(0.92, 0.5, st.clear)
      p.crane.drop = lerp(4, 18, st.clear)

      const post = ctx.post.params
      post.glitch = 0
      post.exposure = 1 - 0.08 * st.load
      post.vignette = 0.32 + 0.12 * st.load
      post.bloomStrength = 0.4 + 0.25 * st.ring

      // ---- the analysis overlay
      ctx.world.tower.swayOffset(TOWER_TOP, swayTop)
      const front = ctx.world.tower.frontier
      skin.update(st.cfd, st.scan, clock, front, front - 6 * FLOOR_H, swayTop)
      lines.update(st.cfd * st.lines, st.flow, clock)

      // ---- the damper
      const swayX = ctx.world.tower.swayAt(TMD.y)
      const swing = rm ? 0 : clamp(-0.32 * swayX, -0.24, 0.24) * st.release
      damper.update({
        sway: swayX,
        swing,
        fill: st.fill,
        ghost: 0.95 * st.draw * (1 - smoothstep(0.44, 0.5, local)),
        glitch: 0,
        draw: st.draw,
        ring: st.ring,
        built: ctx.world.tower.frontier / FLOOR_H,
        time: t,
        reduced: rm,
      })

      // ---- the overcast
      ctx.renderer.getClearColor(fogCol)
      sky.update(st.load * 0.8, st.clear, clock, WIND, fogCol, ctx.camera.position)

      // ---- DOM
      if (lay.dirty || lay.w !== frame.width || lay.h !== frame.height) measure(frame)
      shiftA = lay.aHidden * (1 - st.lift)
      const ty = shiftA + (1 - st.a) * 14
      if (Math.abs(ty - lastShift) > 0.05) {
        lastShift = ty
        copyA.style.transform = `translate3d(0, ${ty.toFixed(1)}px, 0)`
      }
      reveal(copyA, st.a, 0)
      setRise(titleA, local > 0.06 && local < 0.62)
      setRise(titleB, local > 0.38 && local < 0.62)
      reveal(plate, st.plate)
      reveal(key, st.key, 0)
      reveal(copyB, st.b)
      setRise(stat, local > 0.66 && local < 0.96)
      reveal(scrim, Math.max(st.a, st.b) * 0.95, 0)

      const dm = (rm ? SWAY_MAX * (1 - smoothstep(0.3, 0.6, local)) : st.sway).toFixed(1)
      if (dm !== lastDrift) {
        lastDrift = dm
        drift.textContent = `±${dm} m`
      }
      const tall = frame.height > frame.width
      const sway = ctx.world.tower.swayAt(F)
      place(warn, anchor.set(15 + sway, F, 15), st.warn, ctx, frame, 'a', tall ? CO_WARN_TALL : CO_WARN)
      // damper callout: on the sphere's shoulder, on the side away from the copy
      anchor
        .set(TMD.x + swayX + swing, TMD.y + TMD.r * 0.66, TMD.z)
        .addScaledVector(camRight, TMD.r * 0.66)
        .addScaledVector(camToward, TMD.r * 0.3)
      place(tmdCo, anchor, st.tmdCo, ctx, frame, 'a', tall ? CO_TALL : CO_WIDE)
      // status callout: the front of the ring frame's green stripe
      damper.stripeAt(anchor, camToward)
      place(okCo, anchor, st.okCo, ctx, frame, 'b', tall ? CO_TALL : CO_WIDE)
    },

    camera(local, frame, out) {
      const tall = frame.height > frame.width
      const keys = tall ? TALL : LAND
      const F = frontierY('shield', local)
      let i = 0
      while (i < keys.length - 2 && local > keys[i + 1].l) i++
      const A = keys[i]
      const B = keys[i + 1]
      const t0 = clamp((local - A.l) / (B.l - A.l))
      const u = lerp(t0, t0 * t0 * (3 - 2 * t0), 0.8)
      subject(A.s, F, _S0)
      subject(B.s, F, _S1)
      _S0.lerp(_S1, u)
      const a = lerp(A.a, B.a, u)
      const e = lerp(A.e, B.e, u)
      const d = lerp(A.d, B.d, u)
      const fov = lerp(A.fov, B.fov, u)
      const ox = lerp(A.ox, B.ox, u)
      const oy = lerp(A.oy, B.oy, u)
      const ce = Math.cos(e)
      out.position.set(_S0.x + Math.sin(a) * ce * d, _S0.y + Math.sin(e) * d, _S0.z + Math.cos(a) * ce * d)
      // shift the aim so the subject lands at (ox, oy) on screen
      _fwd.copy(_S0).sub(out.position).normalize()
      _right.crossVectors(_fwd, UP).normalize()
      _up.crossVectors(_right, _fwd)
      const hh = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * d
      const hw = hh * (frame.width / Math.max(1, frame.height))
      out.target.copy(_S0).addScaledVector(_right, -ox * hw).addScaledVector(_up, -oy * hh)
      camRight.copy(_right)
      camToward.set(Math.sin(a), 0, Math.cos(a))
      out.fov = fov
      out.roll = 0
      out.parallax = 0.5
      // a drone fighting the gusts (never under reduced motion)
      if (!frame.reducedMotion) {
        const st = story(local)
        const k = st.load * st.load * (1 - st.fill)
        const tt = frame.time
        out.position.x += (Math.sin(tt * 1.7) * 0.5 + Math.sin(tt * 3.3 + 1.1) * 0.25) * k * 0.45
        out.position.y += (Math.sin(tt * 1.3 + 0.4) * 0.5 + Math.sin(tt * 2.9) * 0.2) * k * 0.35
        out.roll = (Math.sin(tt * 0.9) * 0.7 + Math.sin(tt * 2.3) * 0.3) * 0.006 * k
      }
    },
  }
}
