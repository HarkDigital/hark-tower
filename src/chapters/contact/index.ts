import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { Callout, reveal, setRise } from '../../core/dom'
import { clamp, ease, lerp, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { applySite } from '../common'
import { logoOutlines } from '../../logo/logo'
import { FLOOR_H, FLOORS, Sparks, T } from '../../kit/steel'
import { Crane, JIB_L, MAST_H } from '../../world/crane'
import { CROWN_H, CROWN_Y } from '../../world/tower'
import { BEAM_D, BEAM_L, HANG, buildBeam, type LastBeam } from './beam'
import { buildHud, measureHud, type Hud, type HudLayout } from './hud'
import './contact.css'

/*
 * CONTACT · "Topping Out" — the final chapter (floors 57 → 60, dusk → night).
 *
 * THE TOPPING-OUT CEREMONY. The last beam — painted white, signed by the crew,
 * a little fir and a flag on top — is hoisted up the face of the tower at
 * dusk, trolleyed over the roof and set at the foot of the Hark crown. The crane
 * lets go and swings away, the blueprint of the vision fades (there is
 * nothing left to draw), night falls and the Hark crown lights up green over
 * the city. Then one slow, conclusive pull-back: the finished, lit tower in
 * the night skyline, measured by a single drawing dimension, and stillness.
 *
 *   0.00–0.24  the hoist: the camera rides up the facade beside the beam
 *   0.19–0.27  over the roof: the crane slews + trolleys in, the load settles
 *   0.26–0.335 lowered and set on the penthouse at the crown's foot
 *   0.335–0.47 bolted up (sparks); unhooked; the trolley runs out and the crane
 *              slews round behind the crown (its jib pointing away from us)
 *   0.40–0.55  pull back as night falls; the crane is lowered into the core
 *   0.53–0.62  the Hark crown lights up (only once the mast has gone)
 *   0.64       nav landing: the lit crown over the night city, the plate settled
 *   0.60–1.00  the pull-back into the skyline; the height dimensioned; stillness
 *
 * Before it lights, the sign's LED contour glows faintly on standby, so the
 * dark mark reads as the Hark logo (not an abstract shape) in the close shots.
 *
 * Everything is derived from `local`; frame.time only adds idle motion (the
 * load's sway on its bridle, the flag, the tag lines, bolting sparks), which
 * fades out for the final still. The crane's pose is damped (and swings) in
 * the world, so while it hangs the beam is pinned to the hook's live world
 * matrix at render time (pivot.updateMatrixWorld), never a frame behind.
 */

const HALF = 15
const TOP = FLOORS * FLOOR_H // 240
/**
 * The beam is set on the highest steel the crane can reach: the roof of the
 * mechanical penthouse, at the foot of the Hark crown (World: penthouse box
 * 20 × 2.6 × 14 m on the roof slab, front face at z = +3; the crown sign rises
 * from EL. +243 just behind it). Off the mast by more than the trolley's
 * minimum reach (0.08 · 52 m).
 */
const PENTHOUSE_TOP = TOP + 0.08 + 2.6
const SEAT = new THREE.Vector3(-4.2, PENTHOUSE_TOP + BEAM_D / 2, 1.75)
const SEAT_YAW = Math.atan2(SEAT.z, SEAT.x)
const SEAT_R = Math.hypot(SEAT.x, SEAT.z)
const R_OUT = 22.5 // hook radius while hoisting (clear of the curtain wall)
const Y_START = 176 // beam centre when the chapter opens (≈ floor 44)
const Y_OVER = 249 // clearance height over the deck
const T_LAND = 0.335
/** the crown sign's centre (the world's Hark mark) */
const CROWN_MID = CROWN_Y + CROWN_H / 2
/** the final camera's azimuth around the tower (landscape / portrait) */
const TH_FINAL = { l: 0.66, p: 0.72 }
/** the pull-back camera's azimuth (S4) */
const TH_PULL = 0.42
/**
 * Where the jib points while the crane is lowered into the core: straight
 * away from the pull-back camera, so the tower hides it as it sinks (reached
 * from SEAT_YAW the short way, through π, while the close shot looks below it).
 */
const YAW_AWAY = Math.atan2(-Math.cos(TH_PULL), -Math.sin(TH_PULL)) + Math.PI * 2
/** the trolley runs out this far before the slew (the hook clears the sign) */
const R_AWAY = 30
/** the crown sign's LED contour strip (m) */
const TRIM_W = 0.14
const SIGNAL = new THREE.Color(T.signal)

interface Shot {
  s: THREE.Vector3
  r: number
  th: number
  ph: number
  fov: number
}
const shot = (): Shot => ({ s: new THREE.Vector3(), r: 1, th: 0, ph: 0, fov: 40 })
function mixShot(a: Shot, b: Shot, t: number) {
  if (t <= 0) return
  a.s.lerp(b.s, t)
  a.r = Math.exp(lerp(Math.log(a.r), Math.log(b.r), t))
  a.th = lerp(a.th, b.th, t)
  a.ph = lerp(a.ph, b.ph, t)
  a.fov = lerp(a.fov, b.fov, t)
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** Every instanced box in the city as a world-space footprint + top (for camera clearance). */
function readCity(root: THREE.Object3D) {
  const out: number[] = []
  const m = new THREE.Matrix4()
  const box = new THREE.Box3()
  root.updateWorldMatrix(true, true)
  root.traverse(o => {
    const im = o as THREE.InstancedMesh
    if (!im.isInstancedMesh) return
    const g = im.geometry
    if (!g.boundingBox) g.computeBoundingBox()
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m)
      m.premultiply(im.matrixWorld)
      box.copy(g.boundingBox!).applyMatrix4(m)
      if (box.max.y < 30) continue
      out.push(box.min.x, box.max.x, box.min.z, box.max.z, box.max.y)
    }
  })
  return new Float32Array(out)
}

/**
 * The crown sign's LED contour: a thin flat strip along every edge of the
 * Hark mark (outer boundaries + holes), in the mark's normalized space (1 unit
 * tall, like the world's sign), mitred at the corners.
 */
function trimGeometry(width: number) {
  const pos: number[] = []
  const index: number[] = []
  const hw = width / 2 / CROWN_H
  const n1 = new THREE.Vector2()
  const n2 = new THREE.Vector2()
  const m = new THREE.Vector2()
  for (const raw of logoOutlines(undefined, 240)) {
    const pts = raw.length > 2 && raw[0].distanceTo(raw[raw.length - 1]) < 1e-6 ? raw.slice(0, -1) : raw
    const n = pts.length
    if (n < 3) continue
    const base = pos.length / 3
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n]
      const p1 = pts[i]
      const p2 = pts[(i + 1) % n]
      n1.set(p0.y - p1.y, p1.x - p0.x).normalize()
      n2.set(p1.y - p2.y, p2.x - p1.x).normalize()
      m.addVectors(n1, n2)
      if (m.lengthSq() < 1e-10) m.copy(n1)
      else m.normalize()
      const k = hw / Math.max(0.4, m.dot(n1))
      pos.push(p1.x + m.x * k, p1.y + m.y * k, 0, p1.x - m.x * k, p1.y - m.y * k, 0)
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2
      const b = base + ((i + 1) % n) * 2
      index.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(index)
  return g
}

export default function create(): Chapter {
  const group = new THREE.Group()
  group.name = 'contact'
  let hud: Hud
  let lay: HudLayout | null = null
  let lastW = 0
  let lastH = 0
  let beam: LastBeam
  let sparks: Sparks
  let key: THREE.SpotLight | null = null
  let crownLight: THREE.PointLight | null = null
  let callout: Callout
  let dimLabel: HTMLElement
  let dim: THREE.Group
  let dimLine: THREE.LineSegments
  let dimTop: THREE.LineSegments
  /** the dimension figure's length on screen (px, measured on relayout) */
  let dimLen = 154
  let trim: THREE.Mesh
  let trimMat: THREE.MeshBasicMaterial
  /** set on entry: the next frame snaps the crane's pose (the cut hides it) */
  let entered = false
  let rm = false
  let mobile = false
  /** the city's building boxes: minX, maxX, minZ, maxZ, top (read once from the world) */
  let blocks: Float32Array = new Float32Array(0)

  // the hanging rig: pivot at the hook, the load hangs HANG below it
  const pivot = new THREE.Group()
  const hook = new THREE.Vector3()
  const hookPrev = new THREE.Vector3()
  const hookNow = new THREE.Vector3()
  let hookPrevOk = false
  let prevDt = 1 / 60
  let seatW = 0
  /** the seat's drop below the finished roof (m, ≤ 0) while a jump's build catches up */
  let seatDrop = 0
  let hookObj: THREE.Object3D | null = null
  const hookSeat = SEAT.clone().add(new THREE.Vector3(0, HANG, 0))
  const beamPos = new THREE.Vector3()
  const tmp = new THREE.Vector3()
  const anchor = new THREE.Vector3()
  const dimA = new THREE.Vector3()
  const dimB = new THREE.Vector3()
  const probe = new THREE.PerspectiveCamera(40, 1, 0.1, 3000)
  let annotLocal = 0
  let prevLocal = -1
  let sparkClock = 0

  // camera shots (evaluated each frame; the hoist shots follow the beam)
  const S = [shot(), shot(), shot(), shot(), shot(), shot()]
  const cur = shot()
  const fwd = new THREE.Vector3()
  const right = new THREE.Vector3()
  const upv = new THREE.Vector3()
  const UP = new THREE.Vector3(0, 1, 0)

  const relayout = (W: number, H: number) => {
    lay = measureHud(hud, W, H)
    dimLen = dimLabel.offsetWidth || dimLen
    hud.dirty = false
    lastW = W
    lastH = H
  }

  /** The crane's pose targets for this local (the world damps toward them). */
  function craneTargets(local: number, built: number) {
    const base = Math.min(FLOORS, built + 2) * FLOOR_H
    const jib = base + MAST_H + 0.3
    // hoisting up the front face, then slewing + trolleying in over the roof
    const over = smoothstep(0.19, 0.265, local)
    let yaw = lerp(Math.PI / 2 - 0.42 * (1 - smoothstep(0.02, 0.22, local)), SEAT_YAW, over)
    let r = lerp(R_OUT, SEAT_R, over)
    // the beam's centre height: hoist (fast out of the cut, easing at the top), then lower and set
    let y = lerp(Y_START, Y_OVER, smoothstep(-0.1, 0.235, local))
    y = lerp(y, SEAT.y, ease.inOutCubic(clamp((local - 0.255) / (T_LAND - 0.255))))
    let hy = y + HANG
    if (local > T_LAND) {
      // slack, unhooked; the hook climbs to the trolley as the trolley runs out
      // along the jib (front-left, in front of the sign), then the crane slews
      // round behind the crown while the close shot looks at the beam below it:
      // its jib ends up pointing straight away from the pull-back camera, and
      // the world lowers it into the core from there (update: crane.away)
      const up = ease.inOutCubic(smoothstep(0.355, 0.43, local))
      hy = lerp(SEAT.y + HANG - 0.12 * smoothstep(T_LAND, 0.35, local), jib - 3.5, up)
      r = lerp(SEAT_R, R_AWAY, smoothstep(0.37, 0.42, local))
      yaw = lerp(SEAT_YAW, YAW_AWAY, ease.inOutCubic(smoothstep(0.405, 0.455, local)))
    }
    hy = Math.min(hy, jib - 2)
    return { yaw, reach: r / JIB_L, drop: jib - hy }
  }

  /**
   * The hook's position THIS frame, for the camera (the load itself is pinned
   * to the live hook at render time): world.crane.hookWorld is last frame's,
   * so step it forward by its own last velocity (not across jumps).
   */
  function estimateHook(ctx: ChapterContext, frame: Frame, exact: boolean) {
    const hw = ctx.world.crane.hookWorld
    if (exact) {
      // (a snapped pose: `hook` already holds this frame's position)
    } else if (!hookPrevOk || hw.distanceTo(hookPrev) > 6 || frame.dt <= 0) hook.copy(hw)
    else hook.copy(hw).add(tmp.subVectors(hw, hookPrev).multiplyScalar(Math.min(2, frame.dt / Math.max(1e-3, prevDt))))
    hookPrev.copy(hw)
    hookPrevOk = !exact
    prevDt = frame.dt
  }

  /** Place the camera so a sphere (s, r) fills the free art rect, seen from (th, ph). */
  function place(out: CameraPose, frame: Frame, sh: Shot) {
    const W = frame.width
    const H = frame.height
    const a = lay?.art ?? { x0: W * 0.42, x1: W - 40, y0: 100, y1: H - 100 }
    const aspect = W / H
    const t = Math.tan(THREE.MathUtils.degToRad(sh.fov / 2))
    const hw = Math.max(0.08, (a.x1 - a.x0) / W)
    const hh = Math.max(0.08, (a.y1 - a.y0) / H)
    const cx = (a.x0 + a.x1) / W - 1
    const cy = 1 - (a.y0 + a.y1) / H
    const ext = Math.min(hh * t, hw * t * aspect)
    const dist = sh.r / Math.max(0.02, ext)
    // never fly through a building: rise over any tower under the camera
    let ph = sh.ph
    const cp0 = Math.cos(ph)
    const minY = clearY(sh.s.x + Math.sin(sh.th) * cp0 * dist, sh.s.z + Math.cos(sh.th) * cp0 * dist)
    if (sh.s.y + dist * Math.sin(ph) < minY) ph = Math.asin(clamp((minY - sh.s.y) / dist, -1, 1))
    const cp = Math.cos(ph)
    out.position.set(Math.sin(sh.th) * cp, Math.sin(ph), Math.cos(sh.th) * cp).multiplyScalar(dist).add(sh.s)
    fwd.subVectors(sh.s, out.position).normalize()
    right.crossVectors(fwd, UP).normalize()
    upv.crossVectors(right, fwd)
    out.target
      .copy(sh.s)
      .addScaledVector(right, -cx * t * aspect * dist)
      .addScaledVector(upv, -cy * t * dist)
    out.fov = sh.fov
  }

  /** Height the camera must clear at (x, z): the tallest city block within a margin, + headroom. */
  function clearY(x: number, z: number) {
    let top = -Infinity
    const m = 10
    for (let i = 0; i < blocks.length; i += 5) {
      if (x > blocks[i] - m && x < blocks[i + 1] + m && z > blocks[i + 2] - m && z < blocks[i + 3] + m) top = Math.max(top, blocks[i + 4])
    }
    return top + 12
  }

  /** Is a projected point inside the free art rect (so annotations never sit on the plate)? */
  function inArt(p: THREE.Vector3, cam: THREE.Camera, W: number, H: number, above = 0) {
    if (!lay) return 0
    tmp.copy(p).project(cam)
    if (tmp.z > 1 || !Number.isFinite(tmp.x)) return 0
    const x = (tmp.x * 0.5 + 0.5) * W
    const y = (-tmp.y * 0.5 + 0.5) * H
    const a = lay.art
    const m = 30
    const top = lay.portrait ? Math.max(a.y0, lay.H * 0.12) : a.y0
    return x > a.x0 + m && x < a.x1 - m && y > top + m + above && y < a.y1 - m ? 1 : 0
  }

  return {
    id: 'contact',
    group,

    async init(ctx) {
      rm = ctx.reducedMotion
      mobile = ctx.mobile
      hud = buildHud(ctx.stage)
      blocks = readCity(ctx.world.city.root)
      callout = new Callout(ctx.stage, { side: 'right', offset: { x: 70, y: -54 } })
      callout.root.classList.add('ct-callout')
      // the dimension's figure, written along the line like a drawing's (decorative)
      dimLabel = document.createElement('div')
      dimLabel.className = 'ct-dim'
      dimLabel.setAttribute('aria-hidden', 'true')
      dimLabel.textContent = `${TOP.toFixed(1)} m · ${FLOORS} floors`
      ctx.stage.appendChild(dimLabel)
      reveal(dimLabel, 0, 0)
      await nextFrame()

      beam = buildBeam(ctx.renderer, ctx.mobile)
      pivot.add(beam.load)
      beam.load.position.y = -HANG
      group.add(pivot)
      // while it hangs, the rig follows the crane hook's live world position
      // (the crane updates before the chapters in the scene graph, so this is
      // the same frame's hook, pendulum and all)
      hookObj = ctx.world.crane.hook
      const baseUpdate = pivot.updateMatrixWorld.bind(pivot)
      pivot.updateMatrixWorld = (force?: boolean) => {
        if (hookObj && seatW < 1) {
          hookNow.setFromMatrixPosition(hookObj.matrixWorld)
          pivot.position.lerpVectors(hookNow, hookSeat, seatW)
        } else pivot.position.copy(hookSeat)
        baseUpdate(force)
      }

      sparks = new Sparks(ctx.mobile ? 140 : 320, 0.28, 2.6)
      group.add(sparks.points)

      if (!ctx.mobile) {
        // a work light on the crew's side: the floodlit beam at dusk
        key = new THREE.SpotLight('#ffe4c4', 0, 60, 0.42, 0.7, 1.6)
        group.add(key, key.target)
      }
      if (!ctx.mobile) {
        // the crown's green spill on the deck, the beam and the fir (phones: the
        // world's own crown glow carries it; no extra light on every fragment)
        crownLight = new THREE.PointLight(T.signal, 0, 48, 1.6)
        crownLight.position.set(-2, CROWN_Y + 4, 4.5)
        group.add(crownLight)
      }
      // (both lights stay in the scene for the whole chapter: only their
      // intensity moves — adding, removing or hiding a light relinks every lit
      // material's program)

      // the crown sign's LED contour, on standby before the sign lights: it
      // keeps the dark mark readable as the Hark logo in the close shots
      // (sits just proud of the world's sign face: same place, same scale)
      trimMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, side: THREE.DoubleSide })
      trim = new THREE.Mesh(trimGeometry(TRIM_W), trimMat)
      trim.scale.setScalar(CROWN_H)
      trim.position.set(0, CROWN_MID, 0.2 + 0.09)
      trim.visible = false
      group.add(trim)

      // one drawing dimension: the height of the finished frame, beside the tower
      dim = new THREE.Group()
      const lm = new THREE.LineBasicMaterial({ color: T.line, transparent: true, opacity: 0.9, toneMapped: false, fog: false, depthTest: false, depthWrite: false })
      const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)])
      dimLine = new THREE.LineSegments(lineGeo, lm)
      dimLine.renderOrder = 20
      dim.add(dimLine)
      const tick = (y: number) => [new THREE.Vector3(-4, y, 0), new THREE.Vector3(4, y, 0), new THREE.Vector3(-2.4, y - 2.4, 0), new THREE.Vector3(2.4, y + 2.4, 0)]
      const baseTick = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tick(0)), lm)
      baseTick.renderOrder = 20
      dim.add(baseTick)
      dimTop = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tick(TOP)), lm)
      dimTop.renderOrder = 20
      dim.add(dimTop)
      dim.visible = false
      group.add(dim)
      await nextFrame()
    },

    onEnter() {
      entered = true
    },

    update(local, frame, ctx) {
      const W = frame.width
      const H = frame.height
      if (hud.dirty || W !== lastW || H !== lastH || !lay) relayout(W, H)
      const t = frame.time
      const still = smoothstep(0.62, 0.9, local)
      // arriving (a cut in, a nav jump): no slewing across the scene to catch up
      const jumped = entered || prevLocal < 0 || Math.abs(local - prevLocal) > 0.04
      entered = false

      // ---- the site: the last three floors of steel, then glass and lights to the top
      applySite(ctx, 'contact', local)
      const wp = ctx.world.params
      // (the target overshoots FLOORS a little: the world clamps the steel at 60,
      // but its damped value then crosses the crown's "topped out" test quickly)
      const built = Math.min(FLOORS, lerp(57, FLOORS + 0.4, smoothstep(0.0, 0.3, local)))
      wp.built = local > 0.2 ? Math.max(built, lerp(FLOORS - 0.3, FLOORS + 0.4, smoothstep(0.2, 0.3, local))) : built
      // the curtain wall closes up to the roof by the landing (the lit crown's
      // green in the glass), the offices light up behind it
      wp.glazed = lerp(Math.max(0, built - 6), FLOORS, smoothstep(0.36, 0.62, local))
      wp.fitted = lerp(Math.max(0, built - 12), FLOORS, smoothstep(0.44, 0.84, local))
      wp.time = 0.72 + 0.08 * smoothstep(0, 0.33, local) + 0.13 * smoothstep(0.33, 0.6, local) + 0.03 * smoothstep(0.6, 1, local)
      wp.ghost = 1 - smoothstep(0.42, 0.56, local)
      // the sign lights only once the crane has been lowered out of it: by
      // scroll, and never while the (damped) crane still stands in the crown —
      // a fast scroll or a nav jump waits for its slewing ring to drop below
      // the roof (last frame's pose; hidden = gone)
      // (and only on a topped-out tower: after a nav jump the world builds the
      // last floors first, then the sign fades up instead of popping on lit)
      const crane = ctx.world.crane.root
      const ringY = crane.position.y + MAST_H
      const clear = crane.visible ? 1 - smoothstep(226, 238, ringY) : 1
      const frontier = ctx.world.tower.frontier
      const toppedOut = frontier >= TOP - 0.05
      wp.crown = toppedOut ? smoothstep(0.53, 0.62, local) * clear : 0
      wp.fog = lerp(1, 0.8, smoothstep(0.55, 0.9, local))
      wp.sway = 0

      // ---- the crane and the hanging beam
      const ct = craneTargets(local, built)
      wp.crane.yaw = ct.yaw
      wp.crane.reach = ct.reach
      wp.crane.drop = ct.drop
      // job done: the world lowers the crane down through the core (it hides at 1)
      wp.crane.away = smoothstep(0.44, 0.535, local)
      wp.crane.snap = jumped
      if (jumped) {
        // this frame's hook, exactly (world.crane.hookWorld is last frame's pose)
        Crane.hookPosition(hook, Math.min(FLOORS, built + 2) * FLOOR_H, ct.yaw, ct.reach, ct.drop)
      }
      estimateHook(ctx, frame, jumped)
      seatW = local >= T_LAND ? 1 : smoothstep(0.3, T_LAND, local)
      // set on the roof as it stands: while a nav jump's build catches up, the
      // beam rides the top of the steel (never floating over a lower tower)
      seatDrop = Math.min(0, frontier - TOP)
      hookSeat.y = SEAT.y + HANG + seatDrop
      // the camera's (estimated) hook; the render pins the rig to the real one
      pivot.position.lerpVectors(hook, hookSeat, seatW)
      // the load: turned on the hook at first (the tag lines bring it square),
      // a slow sway on its bridle (the crane swings the hook itself)
      const hang = 1 - seatW
      const idle = rm ? 0 : 1
      pivot.rotation.set((0.016 * Math.sin(t * 1.55) * idle) * hang, 0, (0.013 * Math.sin(t * 1.21 + 1.3) * idle) * hang)
      beam.load.rotation.y = (0.5 * (1 - smoothstep(0.03, 0.25, local)) + 0.03 * Math.sin(t * 0.37) * idle) * hang
      beam.setSlings(local < 0.352)
      beam.setTags(1 - smoothstep(0.29, T_LAND, local))
      // (the flag and tag lines hang still for reduced motion and in the final still)
      beam.update(t, rm ? 0 : 1 - still)
      pivot.updateMatrix()
      pivot.updateWorldMatrix(false, false)
      beam.load.updateWorldMatrix(false, false)
      beamPos.setFromMatrixPosition(beam.load.matrixWorld)
      wp.focus.copy(beamPos).lerp(tmp.set(0, TOP, 0), smoothstep(0.36, 0.52, local))

      // ---- sparks: a burst as it lands, then bolting at both ends
      if (!rm) {
        if (prevLocal >= 0 && prevLocal < T_LAND && local >= T_LAND && local < T_LAND + 0.05) {
          for (const s of [-1, 1]) sparks.emit(tmp.set(SEAT.x + s * (BEAM_L / 2 - 0.1), SEAT.y + seatDrop + BEAM_D / 2, SEAT.z + 0.25), mobile ? 16 : 34, 3.2)
        }
        if (local > T_LAND && local < 0.47) {
          sparkClock -= frame.dt
          if (sparkClock <= 0) {
            // an ironworker's impact wrench / tack weld at one end of the top flange
            sparkClock = 0.12 + Math.random() * 0.3
            const s = Math.random() < 0.5 ? -1 : 1
            sparks.emit(tmp.set(SEAT.x + s * (BEAM_L / 2 - 0.15), SEAT.y + seatDrop + BEAM_D / 2 - 0.05, SEAT.z + 0.2), mobile ? 8 : 18, 2.6)
          }
        }
      }
      sparks.update(frame.dt)
      prevLocal = local

      // ---- lights: the work light on the load, the crown's green spill
      // (intensity only: both stay in the scene, see init)
      const crown = wp.crown
      if (key) {
        key.position.copy(beamPos).add(tmp.set(9, 7, 13))
        key.target.position.copy(beamPos)
        key.target.updateMatrixWorld()
        key.intensity = 140 * (1 - smoothstep(0.42, 0.54, local))
      }
      if (crownLight) crownLight.intensity = 80 * crown

      // ---- the sign's LED contour: standby green from topping out, then the
      // lit face takes over (the world shows the sign once the steel tops out)
      const topped = frontier >= (FLOORS - 0.3) * FLOOR_H - 1e-3
      const trimK = topped ? 0.4 * smoothstep(0.22, 0.32, local) * (1 - smoothstep(0.55, 0.61, local)) * (1 - smoothstep(0.05, 0.4, crown)) : 0
      trim.visible = trimK > 0.002
      if (trim.visible) trimMat.color.copy(SIGNAL).multiplyScalar(trimK)

      // ---- post: dusk glow; the crown ignites (a soft bloom swell, never a flash)
      const pp = ctx.post.params
      const swell = smoothstep(0.3, 0.9, crown) * (1 - smoothstep(0.62, 0.72, local))
      pp.bloomStrength = 0.32 + 0.04 * crown + (rm ? 0.04 : 0.12) * swell
      pp.bloomRadius = 0.4 + 0.08 * crown
      pp.bloomThreshold = 1
      pp.exposure = 1 + 0.08 * smoothstep(0.35, 0.7, local)
      pp.vignette = 0.32 + 0.1 * still

      // ---- dimension: the finished height, drawn up beside the tower
      const draw = smoothstep(0.7, 0.86, local)
      dim.visible = draw > 0.001
      if (dim.visible) {
        // beside the tower's right-hand silhouette as seen from the final camera
        const th = lay?.portrait ? TH_FINAL.p : TH_FINAL.l
        const rx = Math.cos(th)
        const rz = -Math.sin(th)
        const cx = HALF * Math.sign(rx || 1)
        const cz = HALF * Math.sign(rz || 1)
        dim.position.set(cx + rx * 16, 0, cz + rz * 16)
        dim.rotation.y = th
        dimLine.scale.y = Math.max(0.001, TOP * ease.inOutCubic(draw))
        dimTop.visible = draw > 0.98
      }

      // ---- copy
      reveal(hud.panel, smoothstep(0.05, 0.13, local))
      setRise(hud.title, local > 0.08)

      // annotation anchors (drawn in camera(), against this frame's pose)
      anchor.set(BEAM_L / 2 - 0.2, BEAM_D / 2, 0).applyMatrix4(beam.load.matrixWorld)
      annotLocal = local
    },

    camera(local, frame, out) {
      const portrait = lay?.portrait ?? frame.height > frame.width
      const rmK = rm ? 0 : 1
      // S0: cut-in — low, looking up as the beam rises into frame
      S[0].s.copy(beamPos)
      S[0].r = 4.2
      S[0].th = 0.62
      S[0].ph = -0.32
      S[0].fov = 38
      // S1: the hoist — riding up beside the beam, the whole signed web in frame
      S[1].s.copy(beamPos).add(tmp.set(0.1, 0.35, 0))
      S[1].r = portrait ? 3.5 : 3.4
      S[1].th = 0.22
      S[1].ph = 0.04
      S[1].fov = 36
      // S2: over the top — the deck, the seat and the beam coming down onto it
      S[2].s.lerpVectors(beamPos, SEAT, 0.4).add(tmp.set(0.3, 0.9, 0))
      S[2].r = portrait ? 5.8 : 5.4
      S[2].th = 0.34
      S[2].ph = 0.2
      S[2].fov = 38
      // S3: set — the signed beam at the foot of the (still dark) crown, tree and flag up
      S[3].s.copy(SEAT).add(tmp.set(0.3, 1.3, 0))
      S[3].r = portrait ? 6.4 : 5.6
      S[3].th = 0.24
      S[3].ph = 0.1
      S[3].fov = 38
      // S4: pull back — the crane is lowered away and the Hark crown lights over the city
      S[4].s.set(0, lerp(TOP, CROWN_Y + CROWN_H, 0.3), 0)
      S[4].r = portrait ? 36 : 33
      S[4].th = TH_PULL
      S[4].ph = 0.1
      S[4].fov = 38
      // S5: the final still — the finished tower in the night skyline
      if (portrait) S[5].s.set(0, 196, 0)
      else S[5].s.set(0, 178, 0)
      S[5].r = portrait ? 76 : 92
      S[5].th = portrait ? TH_FINAL.p : TH_FINAL.l
      S[5].ph = 0.08
      S[5].fov = 32

      cur.s.copy(S[0].s)
      cur.r = S[0].r
      cur.th = S[0].th
      cur.ph = S[0].ph
      cur.fov = S[0].fov
      mixShot(cur, S[1], smoothstep(0.0, 0.12, local))
      mixShot(cur, S[2], smoothstep(0.17, 0.28, local))
      mixShot(cur, S[3], smoothstep(0.3, 0.38, local))
      mixShot(cur, S[4], smoothstep(0.4, 0.55, local))
      mixShot(cur, S[5], ease.inOutCubic(smoothstep(0.6, 0.97, local)))
      // a drone's breath while flying; none from the landing frame (0.64) on
      const breathe = rmK * (1 - smoothstep(0.5, 0.6, local))
      cur.th += 0.006 * Math.sin(frame.time * 0.31) * breathe
      cur.ph += 0.004 * Math.sin(frame.time * 0.23 + 1) * breathe
      place(out, frame, cur)
      out.roll = 0
      out.parallax = lerp(0.35, 0.8, smoothstep(0.6, 0.9, local))

      // ---- drawing annotations, projected with this frame's pose
      const W = frame.width
      const H = frame.height
      probe.fov = out.fov
      probe.aspect = W / H
      probe.updateProjectionMatrix()
      probe.position.copy(out.position)
      probe.lookAt(out.target)
      probe.updateMatrixWorld()
      const l = annotLocal
      const text = l < T_LAND ? 'Last beam · W36 × 6.0 m' : `Topped out · level ${FLOORS}`
      if (callout.label.textContent !== text) callout.label.textContent = text
      callout.offset.y = lay?.portrait ? -40 : -54
      const cv = (smoothstep(0.13, 0.17, l) * (1 - smoothstep(0.26, 0.29, l)) + smoothstep(0.345, 0.37, l) * (1 - smoothstep(0.43, 0.46, l))) * inArt(anchor, probe, W, H, 60)
      callout.update(anchor, probe, W, H, cv)
      // the dimension's figure rides its line (about 58% up), but its whole
      // rotated length stays inside the free art rect: never over the plate
      let dv = smoothstep(0.84, 0.9, l)
      if (dv > 0 && lay) {
        dimA.set(dim.position.x, 0, dim.position.z).project(probe)
        dimB.set(dim.position.x, TOP, dim.position.z).project(probe)
        const a = lay.art
        const x0 = (dimA.x * 0.5 + 0.5) * W
        const y0 = (-dimA.y * 0.5 + 0.5) * H
        const x1 = (dimB.x * 0.5 + 0.5) * W
        const y1 = (-dimB.y * 0.5 + 0.5) * H
        const half = dimLen / 2 + 10
        const lo = (lay.portrait ? Math.max(a.y0, lay.H * 0.12) : a.y0) + half
        const hi = a.y1 - half
        const span = y0 - y1
        const y = clamp(lerp(y0, y1, 0.58), lo, hi)
        const k = span > 1 ? (y0 - y) / span : -1
        const x = lerp(x0, x1, k)
        const ok = dimA.z < 1 && dimB.z < 1 && Number.isFinite(x) && lo <= hi && k > 0.06 && k < 0.97 && x > a.x0 + 30 && x < a.x1 - 30
        if (ok) dimLabel.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) rotate(-90deg)`
        else dv = 0
      }
      reveal(dimLabel, dv, 0)
    },
  }
}
