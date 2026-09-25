import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { Callout, el, reveal, rise, setRise } from '../../core/dom'
import { BRAND, MICROCOPY } from '../../content'
import { clamp, ease, lerp, remap, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { MAST_H } from '../../world/crane'
import { FLOOR_H, FLOORS, Sparks } from '../../kit/steel'
import { applySite } from '../common'
import { TOWER_H } from '../../world/tower'
import { buildVision } from './vision'
import { setDraw } from './pen'
import { LAND, PORT, place, sample, type Shot } from './shots'
import { LAYDOWN, PICK, REST_RY, REST_Y, Site } from './site'
import './hero.css'

/*
 * HERO — "Groundbreaking". Dawn, floors 0 → 3.
 *
 *   0.00–0.10  THE VISION. Across the square at street level. After the loader
 *              the whole tower is DRAFTED in the sky, pen stroke by pen stroke,
 *              from the ground to the Hark crown (time-based, ~2 s) while the
 *              camera tilts up with the pen and the blueprint paper lifts off
 *              the dawn; then the drawing becomes the building: the finished
 *              curtain wall renders up the tower (translucent, the crown dark)
 *              over the crane and the empty lot. That is the rest frame.
 *              Opening copy: the tagline, then the plate (eyebrow, manifesto,
 *              scroll hint).
 *   0.10–0.56  BREAKING GROUND. Over the hoarding and round the site at low
 *              height, one sheet of the drawing set per beat (title block):
 *              A-001 the plan drawn on the earth + mason's lines, S-101 grout
 *              pedestals + base plates, S-201 the first columns landing and
 *              bolted with sparks. Callouts annotate SITE / EL. +000.0 / CORE.
 *              The crane flies a beam bundle over to the laydown and lands it.
 *   0.56–0.93  PAYOFF. Out over the square: the finished glass tower (the
 *              preview again) standing over the first three floors of real
 *              steel. "Make the internet listen." restated, with the CTAs.
 *   0.93–1.00  The camera starts to rise into the blueprint cut.
 */

const REVEAL_S = 2.1
/** local where the payoff has settled (keyboard / anchors land here) */
const PAYOFF = 0.8
/** the riggers unhook the bundle */
const RELEASE = 0.53
/** the rigging above the bundle's centre */
const SPREAD_UP = 3.2
const HOOK_UP = 5.4

/** Floors of steel erected at `local` (the site stays empty until the base plates are in). */
export function builtHero(local: number) {
  if (local < 0.4) return 0
  if (local < 0.62) return 1.35 * ease.inOutQuad((local - 0.4) / 0.22)
  return lerp(1.35, 3, (local - 0.62) / 0.38)
}

/** crane keyframes: local → yaw (rad), reach (0..1), hook height (m; null = keep `drop` m of cable) */
const YAW_P = Math.atan2(PICK.z, PICK.x)
const REACH_P = Math.hypot(PICK.x, PICK.z) / 52
/** the laydown's yaw, unwrapped so the slew runs the short way round (counter-clockwise) */
const YAW_L = Math.atan2(LAYDOWN.z, LAYDOWN.x) + (Math.atan2(LAYDOWN.z, LAYDOWN.x) < YAW_P ? Math.PI * 2 : 0)
const REACH_L = Math.hypot(LAYDOWN.x, LAYDOWN.z) / 52
const CRANE: [number, number, number, number][] = [
  // [local, yaw, reach, hook height]: hooked on over the flatbed, a slow lift,
  // slew round to the laydown, lower, land, slack, unhook, hook up and away
  [0.0, YAW_P, REACH_P, PICK.y + HOOK_UP + 0.3],
  [0.19, YAW_P, REACH_P, PICK.y + HOOK_UP + 0.3],
  [0.3, YAW_P + 0.06, REACH_P + 0.02, 18],
  [0.43, YAW_L, REACH_L, 16],
  [0.5, YAW_L, REACH_L, REST_Y + HOOK_UP],
  [0.53, YAW_L, REACH_L, REST_Y + HOOK_UP - 0.7],
  [0.64, YAW_L + 0.5, 0.36, 20],
  [0.76, Math.PI * 2 - 0.1, 0.42, 22],
  [1.0, Math.PI * 2 + 0.3, 0.46, 24],
]
function craneAt(local: number) {
  let i = 0
  while (i < CRANE.length - 2 && local > CRANE[i + 1][0]) i++
  const a = CRANE[i]
  const b = CRANE[i + 1]
  const t = ease.inOutQuad(clamp((local - a[0]) / (b[0] - a[0])))
  return { yaw: lerp(a[1], b[1], t), reach: lerp(a[2], b[2], t), hookY: lerp(a[3], b[3], t) }
}

/** top of the Hark crown (m) */
const CROWN_TOP = 265
/**
 * The lens for the vision's rest frame: from `d` m out at `h` m, the pitch and
 * vertical field of view that put the crown's top at screen fraction `yt`
 * and the tower's foot at `yb` (0 = top). Bisection, no allocation.
 */
const lensOut = { fov: 70, pitch: 0.5 }
function frameVision(d: number, h: number, yt: number, yb: number) {
  const at = Math.atan((CROWN_TOP - h) / d)
  const ab = Math.atan(-h / Math.max(10, d - 16))
  const kt = (0.5 - clamp(yt, 0.03, 0.3)) * 2
  const kb = (0.5 - clamp(yb, 0.55, 0.97)) * 2
  let lo = ab + 0.02
  let hi = at - 0.02
  for (let i = 0; i < 26; i++) {
    const c = (lo + hi) / 2
    // T from the crown vs T from the foot: the crown's falls as the pitch rises
    if (Math.tan(at - c) / kt > Math.tan(ab - c) / kb) lo = c
    else hi = c
  }
  const c = (lo + hi) / 2
  const T = Math.tan(at - c) / kt
  lensOut.fov = clamp(THREE.MathUtils.radToDeg(2 * Math.atan(T)), 52, 100)
  lensOut.pitch = c
  return lensOut
}

const SHEETS = [
  { no: 'A-001', title: 'Site plan · Set-out' },
  { no: 'S-101', title: 'Foundations · Base plates' },
  { no: 'S-201', title: 'Steel erection · Level 01' },
]

const pad = (n: number, w: number) => String(Math.floor(n)).padStart(w, '0')
const LAMP = new THREE.Color('#ffd7a0')

export default function create(): Chapter {
  const group = new THREE.Group()
  let site: Site
  let vision: ReturnType<typeof buildVision>
  let sparks: Sparks
  let mobile = false
  let reduced = false

  // DOM
  let intro: HTMLElement
  let introTitle: HTMLElement
  let sheet: HTMLElement
  let sheetNo: HTMLElement
  let sheetTitle: HTMLElement
  let sheetEl: HTMLElement
  let sheetCols: HTMLElement
  let payoff: HTMLElement
  let title: HTMLElement
  const callouts: { c: Callout; at: THREE.Vector3; a: number; b: number; core?: boolean }[] = []
  let sheetIdx = -1
  let lastEl = ''
  let lastCols = ''

  // the reveal runs on frame.time (a hidden tab doesn't advance it)
  let revealPending = false
  let revealAt = -1
  let revealDone = false

  // camera, computed in update() so callouts project on the same frame
  const shot: Shot = { ...LAND[0][1] }
  const pos = new THREE.Vector3()
  const tgt = new THREE.Vector3()
  let fov = 60
  const PARALLAX = 0.6
  const projCam = new THREE.PerspectiveCamera()
  const pRight = new THREE.Vector3()
  const pUp = new THREE.Vector3()

  // the load
  const trolley = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const tmp = new THREE.Vector3()
  const qTilt = new THREE.Quaternion()
  const qYaw = new THREE.Quaternion()
  const DOWN = new THREE.Vector3(0, -1, 0)
  const UPY = new THREE.Vector3(0, 1, 0)

  // sparks
  const sparkAt = new THREE.Vector3()
  let sparkDebt: Float32Array

  /** right edge (px) of the payoff headline, measured on resize (0 = unknown) */
  let copyRight = 0
  /** right edge (px) of the opening copy column (0 = unknown) */
  let introRight = 0
  /** the vision's frame (px from the top): the crown's top and the tower's foot */
  let visionTop = 0
  let visionFoot = 0

  const computeShot = (local: number, frame: Frame, rev: number) => {
    const portrait = frame.height >= frame.width
    sample(portrait ? PORT : LAND, local, shot)
    const W = frame.width
    const aspect = W / Math.max(1, frame.height)
    // the vision: the tower stands in the clear column beside the opening copy
    // (landscape: right of the copy; portrait: right of the tagline)
    const w0 = 1 - smoothstep(0.06, 0.1, local)
    if (w0 > 0) {
      // crown just under the chrome, the foot (crane, core, street) just above
      // the plate (portrait) or the readout (landscape), on any screen shape
      const Hh = Math.max(1, frame.height)
      const solved = visionFoot > visionTop && visionTop > 0
      const lens = solved ? frameVision(shot.d, shot.h, visionTop / Hh, visionFoot / Hh) : null
      if (lens) shot.fov = lerp(shot.fov, lens.fov, w0)
      // then stand the tower in the clear column beside the opening copy
      const edge = introRight > 0 ? introRight : W * 0.42
      const xf = portrait ? clamp((edge + W) / 2 / W, 0.5, 0.68) : clamp((edge + W) / 2 / W - 0.12, 0.5, 0.6)
      const tanH = Math.tan(THREE.MathUtils.degToRad(shot.fov / 2)) * aspect
      const run = Math.max(1, shot.d - shot.tin)
      const side = (xf - 0.5) * 2 * tanH * Math.hypot(run, shot.ty - shot.h)
      shot.side = lerp(shot.side, side, w0)
      // (the sideways aim lengthens the sight line: keep the solved pitch)
      if (lens) shot.ty = lerp(shot.ty, shot.h + Math.hypot(run, shot.side) * Math.tan(lens.pitch), w0)
    }
    const w = smoothstep(0.6, 0.74, local)
    if (!portrait && copyRight > 0 && w > 0) {
      // payoff: stand the tower in the clear column between the headline and the
      // chrome's readout (bottom-right, ~560 px), whatever the screen's shape
      // (kept near the centre: a camera looking up leans anything off-centre)
      const xf = clamp((copyRight + W - 560) / 2 / W, Math.max(0.47, Math.min(0.6, (copyRight + 90) / W)), 0.6)
      // very wide, short screens: open the lens so the crown still clears the top
      shot.fov += w * clamp((aspect - 1.8) * 25, 0, 12)
      const tanH = Math.tan(THREE.MathUtils.degToRad(shot.fov / 2)) * aspect
      const dLook = Math.max(1, shot.d - shot.tin)
      const slant = Math.hypot(dLook, shot.ty - shot.h)
      shot.side = lerp(shot.side, (xf - 0.5) * 2 * tanH * slant, w)
    }
    if (rev < 1) {
      // the reveal: the camera starts level on the site (the crane, the core,
      // the project board across the street) and tilts up with the pen
      const k = ease.inOutCubic(clamp(rev))
      shot.ty = lerp(portrait ? 9 : 6, shot.ty, k)
      shot.fov = lerp(shot.fov - 14, shot.fov, k)
      shot.side *= lerp(0.35, 1, k)
    }
    place(shot, pos, tgt)
    fov = shot.fov
  }

  /** mirror of Engine.applyCamera for this frame's pose (pointer parallax included) */
  const syncProjection = (frame: Frame, ctx: ChapterContext) => {
    projCam.aspect = ctx.camera.aspect
    projCam.fov = fov
    projCam.near = ctx.camera.near
    projCam.far = ctx.camera.far
    projCam.position.copy(pos)
    projCam.up.set(0, 1, 0)
    projCam.lookAt(tgt)
    if (!reduced) {
      projCam.updateMatrixWorld()
      pRight.setFromMatrixColumn(projCam.matrixWorld, 0)
      pUp.setFromMatrixColumn(projCam.matrixWorld, 1)
      projCam.position.addScaledVector(pRight, frame.pointer.x * PARALLAX).addScaledVector(pUp, frame.pointer.y * PARALLAX * 0.6)
      projCam.lookAt(tgt)
    }
    projCam.updateProjectionMatrix()
    projCam.updateMatrixWorld()
  }

  /**
   * The beam bundle on the crane: it hangs along the rope (so it swings with
   * the crane's own hook pendulum), sits down on its dunnage when the hook
   * lowers it there, and stays once the riggers unhook it.
   */
  const updateLoad = (local: number, ctx: ChapterContext) => {
    const crane = ctx.world.crane
    const hook = crane.hookWorld
    crane.trolley.getWorldPosition(trolley)
    const yawNow = -crane.slew.rotation.y
    const released = local >= RELEASE
    const bundle = site.bundle
    const spreader = site.spreader
    // the rope's direction (trolley → hook): the load continues along it
    dir.copy(hook).sub(trolley)
    if (dir.lengthSq() < 1e-4) dir.copy(DOWN)
    else dir.normalize()
    qTilt.setFromUnitVectors(DOWN, dir)
    qYaw.setFromAxisAngle(UPY, REST_RY + YAW_L - yawNow)

    if (released) {
      bundle.position.set(LAYDOWN.x, REST_Y, LAYDOWN.z)
      bundle.quaternion.setFromAxisAngle(UPY, REST_RY)
    } else {
      bundle.position.copy(hook).addScaledVector(dir, HOOK_UP)
      // what it would sit on here: the load on the flatbed, or its dunnage at the laydown
      const onTruck = Math.hypot(bundle.position.x - PICK.x, bundle.position.z - PICK.z) < 3
      const floor = onTruck ? PICK.y : REST_Y
      if (bundle.position.y <= floor) {
        // resting: the slings go slack, the bundle sits level
        bundle.position.y = floor
        bundle.quaternion.copy(qYaw)
      } else bundle.quaternion.copy(qTilt).multiply(qYaw)
    }
    // the rigging stays on the hook: spreader below it, slings to the bundle (or hanging free)
    spreader.position.copy(hook).addScaledVector(dir, HOOK_UP - SPREAD_UP)
    spreader.quaternion.copy(qTilt).multiply(qYaw)
    spreader.updateMatrix()
    bundle.updateMatrix()
    const pa = site.slings.geometry.attributes.position as THREE.BufferAttribute
    const l = tmp.set(-2.6, 0, 0).applyMatrix4(spreader.matrix)
    const lx = l.x
    const ly = l.y
    const lz = l.z
    const r = tmp.set(2.6, 0, 0).applyMatrix4(spreader.matrix)
    const rx = r.x
    const ry = r.y
    const rz = r.z
    pa.setXYZ(0, hook.x, hook.y, hook.z)
    pa.setXYZ(1, lx, ly, lz)
    pa.setXYZ(2, hook.x, hook.y, hook.z)
    pa.setXYZ(3, rx, ry, rz)
    pa.setXYZ(4, lx, ly, lz)
    pa.setXYZ(6, rx, ry, rz)
    if (!released) {
      const a = tmp.set(-1.8, 0.45, 0).applyMatrix4(bundle.matrix)
      pa.setXYZ(5, a.x, a.y, a.z)
      const b = tmp.set(1.8, 0.45, 0).applyMatrix4(bundle.matrix)
      pa.setXYZ(7, b.x, b.y, b.z)
    } else {
      pa.setXYZ(5, lx + dir.x * 2.6, ly + dir.y * 2.6, lz + dir.z * 2.6)
      pa.setXYZ(7, rx + dir.x * 2.6, ry + dir.y * 2.6, rz + dir.z * 2.6)
    }
    pa.needsUpdate = true
  }

  return {
    id: 'hero',
    group,
    anchors: [PAYOFF],

    async init(ctx) {
      mobile = ctx.mobile
      reduced = ctx.reducedMotion
      site = new Site(mobile)
      await site.build()
      await nextFrame()
      vision = buildVision()
      sparks = new Sparks(mobile ? 180 : 520, 0.5)
      sparkDebt = new Float32Array(site.spots.length * 2)
      group.add(site.group, vision.group, sparks.points)

      // ---- DOM: the opening line over the dawn sky, then the spec plate
      intro = el('div', 'th-intro', undefined, ctx.stage)
      introTitle = rise(el('p', 'hud-title th-intro-title', undefined, intro), 'Make the internet <em>listen.</em>')
      const plate = el('div', 'th-intro-plate hud-panel', undefined, intro)
      el('p', 'hud-eyebrow', MICROCOPY.signalEyebrow, plate)
      el('p', 'hud-body th-manifesto', BRAND.manifesto, plate)
      const hint = el('p', 'hud-label th-hint', undefined, plate)
      const arrow = el('span', 'th-hint-arrow', undefined, hint)
      arrow.innerHTML =
        '<svg viewBox="0 0 12 18" width="12" height="18" aria-hidden="true" focusable="false"><path d="M6 1v15M1.5 11.5 6 16l4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'
      el('span', '', MICROCOPY.scrollHint, hint)
      if (typeof ResizeObserver !== 'undefined') {
        // the clear column for the vision starts where the opening copy ends
        // (portrait: the tagline's longest line; landscape: the whole column)
        const range = document.createRange()
        const ro = new ResizeObserver(() => {
          const left = ctx.stage.getBoundingClientRect().left
          const top = ctx.stage.getBoundingClientRect().top
          const ir = intro.getBoundingClientRect()
          if (window.innerHeight >= window.innerWidth) {
            range.selectNodeContents(introTitle)
            const r = range.getBoundingClientRect()
            introRight = r.width > 0 ? r.right - left : 0
            visionTop = ir.top - top - 4
            visionFoot = plate.getBoundingClientRect().top - top - 10
          } else {
            introRight = ir.width > 0 ? ir.right - left : 0
            // (the nav can sit right above the tower: keep the crown under the band)
            visionTop = ir.top - top + 6
            // the title block sits on the bottom band: the foot clears it
            visionFoot = sheet ? sheet.getBoundingClientRect().bottom - top - 2 : 0
          }
        })
        ro.observe(intro)
        ro.observe(ctx.stage)
      }

      // ---- DOM: the drawing's title block (decorative site data)
      sheet = el('div', 'th-sheet', undefined, ctx.stage)
      const head = el('div', 'th-sheet-head', undefined, sheet)
      el('span', 'th-sheet-proj', 'Hark Tower', head)
      sheetNo = el('span', 'th-sheet-no', SHEETS[0].no, head)
      sheetTitle = el('div', 'th-sheet-title', SHEETS[0].title, sheet)
      const grid = el('div', 'th-sheet-grid', undefined, sheet)
      const cell = (k: string, v: string) => {
        const c = el('div', 'th-sheet-cell', undefined, grid)
        el('span', '', k, c)
        return el('b', '', v, c)
      }
      cell('Scale', '1:500')
      cell('Grid', '6.000')
      sheetEl = cell('Steel el.', '+000.0')
      sheetCols = cell('Columns', `00/${pad(site.spots.length, 2)}`)
      el('div', 'th-sheet-foot', BRAND.locale, sheet)

      // ---- DOM: payoff
      payoff = el('div', 'th-payoff', undefined, ctx.stage)
      const inner = el('div', 'th-payoff-inner', undefined, payoff)
      el('p', 'hud-label th-locale', BRAND.locale, inner)
      title = rise(el('h1', 'hud-title th-title', undefined, inner), 'Make the internet <em>listen.</em>')
      if (typeof ResizeObserver !== 'undefined') {
        // where the headline's longest line ends (its box is the column's width);
        // read only when the headline reflows
        const range = document.createRange()
        new ResizeObserver(() => {
          range.selectNodeContents(title)
          const r = range.getBoundingClientRect()
          copyRight = r.width > 0 ? r.right - ctx.stage.getBoundingClientRect().left : 0
        }).observe(title)
      }
      const ctas = el('div', 'th-ctas', undefined, inner)
      const see = el('button', 'hud-btn', 'See the work', ctas)
      see.type = 'button'
      see.addEventListener('click', () => window.__hark?.land('work'))
      const start = el('a', 'hud-btn hud-btn--ghost', 'Start a project', ctas)
      start.href = '#contact'
      start.addEventListener('click', e => {
        if (!window.__hark) return
        e.preventDefault()
        window.__hark.land('contact')
      })

      // ---- drawing notes pinned to the site
      const off = mobile ? { x: 40, y: -44 } : { x: 78, y: -56 }
      const add = (text: string, at: THREE.Vector3, a: number, b: number, side: 'left' | 'right', core = false) => {
        const c = new Callout(ctx.stage, { side, offset: { ...off } })
        c.label.textContent = text
        c.root.classList.add('th-callout')
        callouts.push({ c, at, a, b, core })
      }
      add('Site · set-out grid A/1', new THREE.Vector3(-15, 0.2, 15), 0.16, 0.28, 'left')
      add('EL. +000.0 · base plate A/3', new THREE.Vector3(-15, 0.4, 3), 0.31, 0.41, 'right')
      add('Core · jump-formed', new THREE.Vector3(-4.5, 8, 4.5), 0.43, 0.56, 'right', true)

      // the reveal plays once, after the loader, and only if the visitor starts here
      // (the event can beat the engine's first frame, so ask the scroll position too)
      const onReveal = () => {
        const y = window.__hark?.engine.lenis.scroll ?? window.scrollY
        if (ctx.stage.classList.contains('is-active') || y < window.innerHeight * 0.3) revealPending = true
        else revealDone = true
      }
      if (document.documentElement.dataset.ready === '1') onReveal()
      else window.addEventListener('hark:reveal', onReveal, { once: true })
    },

    update(local, frame, ctx) {
      if (!site) return
      const t = frame.time
      const portrait = frame.height >= frame.width

      // ---------------- reveal clock: plays once, only if the visitor starts here
      if (revealPending) {
        revealPending = false
        if (!revealDone && local < 0.12 && !reduced) revealAt = t
        else revealDone = true
      }
      let rev: number
      if (reduced || revealDone) rev = 1.5
      else if (revealAt >= 0) rev = (t - revealAt) / REVEAL_S
      else rev = document.documentElement.dataset.ready === '1' ? 1.5 : 0
      if (rev >= 1.5) revealDone = true
      const draw = clamp(rev, 0, 1.2)

      // ---------------- the site for this moment (applySite first, then override)
      applySite(ctx, 'hero', local)
      // the hero stages its own ground site: hide the world's copy (no double hoarding)
      ctx.world.params.site = 0
      const wp = ctx.world.params
      const built = builtHero(local)
      wp.built = built
      wp.glazed = 0
      wp.fitted = 0
      wp.focus.set(0, 0, 12)
      wp.fog = lerp(1.15, 1, smoothstep(0.1, 0.3, local))
      const actualBuilt = ctx.world.tower.frontier / FLOOR_H

      // the drawing: pen for the reveal, then it becomes the building — the
      // finished curtain wall renders up the tower (the vision's rest frame),
      // steps back to the drawing set for the groundbreaking beats, and
      // returns over the real first steel for the payoff
      const vf = reduced ? 0 : 1 - smoothstep(0.96, 1.2, rev)
      setDraw(vision.ghost, draw, vf)
      setDraw(vision.crown, draw, vf)
      // (the reveal clock only gates the opening: the payoff never waits on it,
      // which also keeps the glass visible for the shader prewarm)
      const glassIn = reduced ? 1 : smoothstep(0.8, 1.2, rev)
      const opening = local < 0.3
      const sweep = reduced || !opening ? TOWER_H + 40 : lerp(-12, TOWER_H + 40, ease.inOutQuad(clamp((rev - 0.8) / 0.5)))
      const pv = opening ? glassIn * (1 - smoothstep(0.07, 0.125, local)) : smoothstep(0.6, 0.72, local) * (1 - smoothstep(0.93, 0.985, local))
      vision.preview.set(pv, ctx.world.tower.frontier + 5, sweep)
      // while the pen is drafting, the world's own ghost waits; then it takes
      // over, and steps back to a faint drawing under the glass
      wp.ghost = opening && draw < 0.97 ? 0 : 1 - 0.8 * pv
      // the dimension strings stay while the vision holds the screen
      setDraw(vision.dims, reduced ? 1 : draw, (1 - smoothstep(0.07, 0.13, local)) * (1 - glassIn))

      // ---------------- set-out, footings
      const planFade = 1 - 0.55 * smoothstep(0.58, 0.7, local) - 0.45 * smoothstep(0.92, 1, local)
      const pd = remap(local, 0.12, 0.27, 0, 0.92)
      setDraw(site.plan, pd, planFade)
      for (let i = 0; i < site.planLabels.length; i++) {
        const k = Math.floor(i / 2)
        const on = smoothstep(0.38 + 0.04 * k, 0.5 + 0.04 * k, pd) * planFade
        const m = site.planLabels[i].material as THREE.MeshBasicMaterial
        m.opacity = on
        site.planLabels[i].visible = on > 0.01
      }
      setDraw(site.strings, remap(local, 0.15, 0.28, 0, 0.62), 1)
      site.batter.visible = local > 0.1
      site.setFootings(remap(local, 0.27, 0.36), remap(local, 0.31, 0.41))
      site.lampMat.color.copy(LAMP).multiplyScalar(lerp(5, 3, smoothstep(0.6, 1, local)))

      // ---------------- the crane flies the bundle to the laydown
      const cr = craneAt(local)
      const baseY = Math.min(FLOORS, built + 2) * FLOOR_H
      wp.crane.yaw = cr.yaw
      wp.crane.reach = cr.reach
      wp.crane.drop = Math.max(4, baseY + MAST_H + 0.3 - cr.hookY)
      updateLoad(local, ctx)

      // ---------------- sparks: bolting each column down as it lands (and the splices above)
      if (!reduced) {
        const spots = site.spots
        for (let k = 0; k < spots.length; k++) {
          const s = spots[k]
          for (let f = 0; f < 2; f++) {
            const w = actualBuilt - (f + s.q * 0.45 + 0.35)
            if (w < 0 || w > 0.3) continue
            const d = k * 2 + f
            sparkDebt[d] += (mobile ? 18 : 40) * (1 - w / 0.3) * frame.dt
            while (sparkDebt[d] >= 1) {
              sparkDebt[d] -= 1
              const corner = Math.floor(Math.random() * 4)
              sparkAt.set(s.x + (corner & 1 ? 0.34 : -0.34), f * FLOOR_H + (f ? 0.15 : 0.46), s.z + (corner & 2 ? 0.34 : -0.34))
              sparks.emit(sparkAt, 4, 3.4)
            }
          }
        }
      }
      sparks.update(Math.min(frame.dt, 1 / 30))

      // ---------------- post
      const pp = ctx.post.params
      pp.bloomStrength = 0.55
      pp.bloomRadius = 0.5
      pp.vignette = 0.36
      // before the reveal and while the pen works the frame is still a drawing
      pp.draft = reduced ? 0 : 0.84 * (1 - smoothstep(0.4, 0.92, draw))

      // ---------------- camera
      computeShot(local, frame, reduced ? 1 : draw)

      // ---------------- DOM
      // the opening line hoists in as the pen reaches the crown; the plate follows
      reveal(intro, (1 - smoothstep(0.075, 0.12, local)) * (reduced ? 1 : smoothstep(0.5, 0.8, draw)), 0)
      setRise(introTitle, (reduced || draw > 0.62) && local < 0.118)
      const sv = smoothstep(0.13, 0.16, local) * (1 - smoothstep(0.55, 0.59, local))
      reveal(sheet, sv)
      if (sv > 0) {
        const idx = local < 0.28 ? 0 : local < 0.405 ? 1 : 2
        if (idx !== sheetIdx) {
          const first = sheetIdx < 0
          sheetIdx = idx
          sheetNo.textContent = SHEETS[idx].no
          sheetTitle.textContent = SHEETS[idx].title
          sheet.classList.remove('is-swap')
          if (!first && !reduced) {
            void sheet.offsetWidth
            sheet.classList.add('is-swap')
          }
        }
        const elv = `+${Math.max(0, ctx.world.tower.frontier - 0.05).toFixed(1).padStart(5, '0')}`
        if (elv !== lastEl) sheetEl.textContent = lastEl = elv
        let n = 0
        for (const s of site.spots) if (s.q * 0.45 + 0.35 <= actualBuilt) n++
        const cols = `${pad(n, 2)}/${pad(site.spots.length, 2)}`
        if (cols !== lastCols) sheetCols.textContent = lastCols = cols
      }
      reveal(payoff, smoothstep(0.63, 0.7, local) * (1 - smoothstep(0.93, 0.97, local)), 0)
      // words go last: the headline stays until its plate has faded
      setRise(title, local > 0.645 && local < 0.965)

      // callouts, projected with this frame's pose
      syncProjection(frame, ctx)
      for (const k of callouts) {
        const v = smoothstep(k.a, k.a + 0.025, local) * (1 - smoothstep(k.b - 0.025, k.b, local))
        if (k.core) k.at.y = Math.min(FLOORS, actualBuilt + 2) * FLOOR_H
        k.c.update(k.at, projCam, frame.width, frame.height, portrait && frame.width < 360 ? 0 : v)
      }
    },

    camera(_local, _frame, out: CameraPose) {
      out.position.copy(pos)
      out.target.copy(tgt)
      out.fov = fov
      out.roll = 0
      out.parallax = PARALLAX
    },
  }
}
