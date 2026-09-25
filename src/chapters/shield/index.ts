import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { Callout, el, reveal, rise, setRise } from '../../core/dom'
import { clamp, lerp, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { SECURITY, STATS } from '../../content'
import { applySite, BANDS, frontierY } from '../common'
import { FLOOR_H } from '../../kit/steel'
import { Damper, TMD } from './damper'
import { Debris, StormSky, WindStreaks } from './storm'
import './shield.css'

/*
 * WIND LOAD — "Hacked? Breathe."  (floors 44 → 50, late afternoon)
 *
 * The attack is a storm on the unfinished top.
 *
 *   0.00–0.30  GUST     a red-grey squall rolls over (the world's time/fog
 *                       pushed toward dusk, a racing overcast on top), wind
 *                       streaks and site debris rake across the frontier, the
 *                       blueprint linework glitches, the top of the tower
 *                       SWAYS (up to 1.8 m) and the crane weathervanes on free
 *                       slew. A drawing annotation warns WIND LOAD EXCEEDED.
 *   0.30–0.60  BREATHE  the camera flies in through the open steel to the
 *                       corner bay of floor 44: the cyan drawing of a TUNED
 *                       MASS DAMPER is filled in by steel (a Ø6 m polished
 *                       sphere on cable bundles, eight hydraulic dampers at
 *                       its equator ring), it counter-swings and the sway
 *                       dies away. 'Hacked? Breathe.' + eyebrow + body.
 *                       (Landing 0.45: all of it settled.)
 *   0.60–0.95  STEADY   the squall breaks into warm late light; a thin signal
 *                       green status stripe draws itself round the damper
 *                       (monitoring). '24/7' + label + the emergency CTA
 *                       (anchor 0.8).
 *
 * Everything derives from `local`; frame.time only drives idle motion (wind,
 * the sway phase, weathervaning, the status sweep). Reduced motion: no sway,
 * no counter-swing, no buffet, no glitch, slow streaks, no debris.
 */

const STAT = STATS.find(s => s.value === '24/7') ?? STATS[STATS.length - 1]
/** callout leader offsets (px): wide screens label to the right, tall ones above */
const CO_WIDE = { x: 70, y: -58 }
const CO_TALL = { x: 34, y: -100 }
const CO_WARN = { x: 78, y: -66 }
const CO_WARN_TALL = { x: 40, y: -74 }
const SWAY_MAX = 1.8

/** Story envelopes — pure functions of local. */
function story(l: number) {
  const storm = lerp(0.55, 1, smoothstep(0, 0.14, l)) * (1 - smoothstep(0.34, 0.7, l))
  const decay = 1 - smoothstep(0.3, 0.6, l)
  return {
    storm,
    sway: SWAY_MAX * lerp(0.35, 1, smoothstep(0, 0.16, l)) * Math.pow(decay, 1.5),
    clear: smoothstep(0.5, 0.82, l),
    draw: smoothstep(0.02, 0.17, l),
    fill: smoothstep(0.31, 0.43, l),
    release: smoothstep(0.38, 0.47, l),
    ring: smoothstep(0.64, 0.77, l),
    warn: smoothstep(0.04, 0.09, l) * (1 - smoothstep(0.24, 0.29, l)),
    tmdCo: smoothstep(0.4, 0.43, l) * (1 - smoothstep(0.57, 0.61, l)),
    okCo: smoothstep(0.72, 0.77, l) * (1 - smoothstep(0.93, 0.965, l)),
    a: smoothstep(0.32, 0.36, l) * (1 - smoothstep(0.6, 0.635, l)),
    b: smoothstep(0.655, 0.69, l) * (1 - smoothstep(0.945, 0.975, l)),
  }
}

// ------------------------------------------------------------------ camera

type Subject = 'top' | 'tmd' | 'wide'
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
  { l: 0.0, s: 'top', a: 0.78, e: -0.3, d: 66, fov: 50, ox: 0.14, oy: -0.18 },
  { l: 0.15, s: 'top', a: 0.92, e: -0.24, d: 60, fov: 48, ox: 0.17, oy: -0.14 },
  { l: 0.28, s: 'top', a: 1.08, e: -0.14, d: 54, fov: 46, ox: 0.2, oy: -0.08 },
  // the damper, framed between two perimeter columns of the +x face
  { l: 0.41, s: 'tmd', a: 1.49, e: 0.1, d: 30, fov: 31, ox: 0.27, oy: -0.02 },
  { l: 0.57, s: 'tmd', a: 1.56, e: 0.085, d: 28, fov: 31, ox: 0.28, oy: 0.0 },
  { l: 0.75, s: 'wide', a: 1.3, e: 0.1, d: 44, fov: 38, ox: 0.24, oy: 0.0 },
  { l: 1.0, s: 'wide', a: 1.18, e: 0.08, d: 54, fov: 38, ox: 0.24, oy: 0.02 },
]
const TALL: Key[] = [
  { l: 0.0, s: 'top', a: 0.78, e: -0.28, d: 96, fov: 56, ox: 0, oy: 0.12 },
  { l: 0.15, s: 'top', a: 0.92, e: -0.22, d: 88, fov: 55, ox: 0, oy: 0.15 },
  { l: 0.28, s: 'top', a: 1.08, e: -0.12, d: 80, fov: 54, ox: 0, oy: 0.2 },
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
  if (s === 'top') return out.set(5, F + 6, 5)
  if (s === 'tmd') return out.set(TMD.x, TMD.y + 0.9, TMD.z)
  // the steady wide: the damper floors and the top of the steel
  return out.set(10, TMD.y + 2.5 + (F - TMD.y) * 0.12, 10)
}

// ------------------------------------------------------------------ chapter

export default function create(): Chapter {
  const group = new THREE.Group()
  group.name = 'shield'
  let damper: Damper
  let sky: StormSky
  let streaks: WindStreaks
  let debris: Debris
  let copyA: HTMLElement, copyB: HTMLElement, title: HTMLElement, stat: HTMLElement, scrim: HTMLElement, probe: HTMLElement
  let warn: Callout, tmdCo: Callout, okCo: Callout, drift: HTMLElement
  let stage: HTMLElement
  const center = new THREE.Vector3()
  const anchor = new THREE.Vector3()
  const fogCol = new THREE.Color()
  /** camera basis from the last pose (for callout anchors on silhouettes) */
  const camRight = new THREE.Vector3(1, 0, 0)
  const camToward = new THREE.Vector3(0, 0, 1)
  let lastDrift = ''
  // layout measured on resize (never per frame)
  const labelW = new Map<Callout, number>()
  const lay = { dirty: true, top: 90, bottom: 90, aRight: 0, aTop: 0, bRight: 0, bTop: 0, w: 0, h: 0 }

  function measure(frame: Frame) {
    lay.dirty = false
    lay.w = frame.width
    lay.h = frame.height
    lay.top = probe.offsetTop
    lay.bottom = frame.height - (probe.offsetTop + probe.offsetHeight)
    const ra = copyA.getBoundingClientRect()
    const rb = copyB.getBoundingClientRect()
    // the copy's real right edge: the plate, the eyebrow chip and the headline's words
    let right = 0
    for (const n of copyA.querySelectorAll<HTMLElement>('.sh-eyebrow, .sh-plate, .rise-w')) right = Math.max(right, n.getBoundingClientRect().right)
    lay.aRight = right || ra.right
    lay.aTop = ra.top
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
      if (portrait) ok = Math.max(y, labelY + 30) < (copyVis === 'a' ? lay.aTop : lay.bTop) - 10
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
      sky = new StormSky(ctx.mobile)
      streaks = new WindStreaks(ctx.mobile ? 140 : 360)
      debris = new Debris(ctx.mobile ? 20 : 64)
      group.add(sky.mesh, streaks.mesh, debris.mesh)
      await nextFrame()

      stage = ctx.stage
      scrim = el('div', 'sh-scrim', undefined, stage)
      probe = el('div', 'sh-probe', undefined, stage)

      copyA = el('div', 'sh-a', undefined, stage)
      el('p', 'hud-eyebrow sh-eyebrow', SECURITY.eyebrow, copyA)
      title = rise(el('h2', 'hud-title sh-title', undefined, copyA), 'Hacked? <em>Breathe.</em>')
      const plate = el('div', 'hud-panel sh-plate', undefined, copyA)
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

      for (const n of [scrim, copyA, copyB]) reveal(n, 0, 0)
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

      // ---- the squall: world time pushed toward dusk, fog thickens, reflections dull
      const band = BANDS.shield.time
      // the squall darkens toward dusk; when it clears the light has gone warm and late
      p.time = lerp(lerp(lerp(band[0], band[1], local), 0.575, st.clear), 0.64, st.storm * 0.82)
      p.fog = 1 + st.storm * 1.25
      p.env = 1 - st.storm * 0.4
      p.sway = rm ? 0 : st.sway
      // site stand-down: no bolting in the squall; the gang is back when it clears
      ;(p as { activity?: number }).activity = 1 - st.storm
      // gusts: slow, irregular pulses (drive the glitch and the ghost flicker)
      const gust = rm ? 0 : clamp(0.5 + 0.5 * Math.sin(t * 2.1) * Math.sin(t * 0.63 + 1.3) + 0.25 * Math.sin(t * 5.3))
      p.ghost = 1 - st.storm * (0.2 + 0.45 * gust)
      // the crane: weathervaning on free slew in the squall, parked once it clears
      const park = 2.45
      p.crane.yaw = park + (rm ? 0 : st.storm * (0.45 * Math.sin(t * 0.37) + 0.12 * Math.sin(t * 1.13 + 0.7)))
      p.crane.reach = lerp(0.92, 0.5, st.clear)
      p.crane.drop = lerp(4, 18, st.clear)

      const post = ctx.post.params
      post.glitch = rm ? 0 : Math.min(0.25, 0.23 * st.storm * (0.45 + 0.55 * gust))
      post.exposure = 1 - 0.15 * st.storm
      post.vignette = 0.32 + 0.22 * st.storm
      post.aberration = 0.0012 + 0.0012 * st.storm
      post.grain = 0.03 + 0.02 * st.storm
      post.bloomStrength = 0.4 + 0.25 * st.ring

      // ---- the damper
      const swayX = ctx.world.tower.swayAt(TMD.y)
      const swing = rm ? 0 : clamp(-0.32 * swayX, -0.24, 0.24) * st.release
      damper.update({
        sway: swayX,
        swing,
        fill: st.fill,
        ghost: 0.95 * st.draw * (1 - smoothstep(0.44, 0.5, local)),
        glitch: st.storm * (0.35 + 0.65 * gust),
        draw: st.draw,
        ring: st.ring,
        built: ctx.world.tower.frontier / FLOOR_H,
        time: t,
        reduced: rm,
      })

      // ---- wind
      ctx.renderer.getClearColor(fogCol)
      sky.update(st.storm, st.clear, rm ? t * 0.25 : t, fogCol, ctx.camera.position)
      center.set(3, F + 2, 3).lerp(ctx.camera.position, 0.42)
      const wind = st.storm * st.storm
      streaks.update(wind * (rm ? 0.45 : 1.15), rm ? t * 0.2 : t, center, 34)
      debris.update(rm ? 0 : wind * (1 - st.clear), t, center, 17)

      // ---- DOM
      if (lay.dirty || lay.w !== frame.width || lay.h !== frame.height) measure(frame)
      reveal(copyA, st.a)
      setRise(title, local > 0.325 && local < 0.62)
      reveal(copyB, st.b)
      setRise(stat, local > 0.66 && local < 0.96)
      reveal(scrim, Math.max(st.a, st.b) * 0.95 + st.warn * 0.4, 0)

      const dm = (rm ? SWAY_MAX * (1 - smoothstep(0.3, 0.6, local)) : st.sway).toFixed(1)
      if (dm !== lastDrift) {
        lastDrift = dm
        drift.textContent = `±${dm} m`
      }
      const tall = frame.height > frame.width
      const sway = ctx.world.tower.swayAt(F)
      place(warn, anchor.set(15 + sway, F, 15), st.warn, ctx, frame, null, tall ? CO_WARN_TALL : CO_WARN)
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
        const k = st.storm * st.storm * (1 - st.fill)
        const tt = frame.time
        out.position.x += (Math.sin(tt * 1.7) * 0.5 + Math.sin(tt * 3.3 + 1.1) * 0.25) * k * 0.45
        out.position.y += (Math.sin(tt * 1.3 + 0.4) * 0.5 + Math.sin(tt * 2.9) * 0.2) * k * 0.35
        out.roll = (Math.sin(tt * 0.9) * 0.7 + Math.sin(tt * 2.3) * 0.3) * 0.006 * k
      }
    },
  }
}
