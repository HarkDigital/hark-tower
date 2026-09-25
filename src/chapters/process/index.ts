import * as THREE from 'three'
import type { Chapter, ChapterContext } from '../../core/types'
import { Callout } from '../../core/dom'
import { clamp, lerp, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { applySite, beat, builtAt } from '../common'
import { FLOOR_H, FLOORS, MAT, Sparks, T, TOWER_W, etchLabel } from '../../kit/steel'
import { Crane, JIB_L, MAST_H } from '../../world/crane'
import { DATUM_FLOORS, ProcessHud, type DatumPoint } from './hud'
import * as P from './props'
import './process.css'

/*
 * PROCESS — "Blueprint". Floors 50 → 57 at golden hour. The four steps are
 * four sheets of a drawing set, each a vignette at the construction frontier:
 *
 *   A-501 LISTEN     a total station on the core top; its laser sweeps the
 *                    city's rooftops (measure before you build) and lands on
 *                    the tower's own steel
 *   A-502 PROTOTYPE  the frame goes blueprint (post draft held) while a cyan
 *                    model of the next floors is drawn ahead of the steel
 *   A-503 BUILD      the crane hoists a brace up the +x face and homes it
 *                    into the ghost's diagonal; it's bolted with sparks
 *   A-504 SUPPORT    a BMU cradle works along the finished glass below
 *   RESULTS          three elevation-datum plates (10 years, $1M+, 15)
 *
 * Everything derives from `local` (and the tower's live, damped build height
 * so props ride exactly with the steel); frame.time only drives idle motion.
 */

const ID = 'process'
const STEP_A = 0.18
const STEP_B = 0.8
const SPAN = (STEP_B - STEP_A) / 4
const W_LISTEN: [number, number] = [0.065, STEP_A + SPAN]
const W_PROTO: [number, number] = [STEP_A + SPAN, STEP_A + 2 * SPAN]
const W_BUILD: [number, number] = [STEP_A + 2 * SPAN, STEP_A + 3 * SPAN]
const W_SUPPORT: [number, number] = [STEP_A + 3 * SPAN, STEP_B]
const STATS_IN = 0.815

const HALF = TOWER_W / 2
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const seg = (v: number, w: [number, number]) => clamp((v - w[0]) / (w[1] - w[0]))
const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

/** the hero brace: segment 2 of the +x face diagonal (floor 52) */
const HERO = 2
const HANG = 3.2
/** the total station stands on the core top near its +z edge; the prism on the +z face's middle column */
const INSTRUMENT = new THREE.Vector3(2.2, 0, 3.55)
const PRISM = new THREE.Vector3(0.35, 0, HALF + 0.25)
/** the five brace segments of the +x face diagonal (floors 50–54), precomputed */
const BRACES = [0, 1, 2, 3, 4].map(k => {
  const { a, b } = P.braceEnds(k)
  const dir = b.clone().sub(a).normalize()
  return { a, b, dir, mid: a.clone().add(b).multiplyScalar(0.5), q: P.braceQuaternion(dir) }
})
const LINE_COL = new THREE.Color(T.line)

type Pose = { a: number; r: number; y: number; t: THREE.Vector3; fov: number; side: number; drop: number; pside?: number }

export default function create(): Chapter {
  const group = new THREE.Group()
  group.name = 'process'
  let hud: ProcessHud
  let mobile = false
  let reduced = false

  // live state shared by update() → camera()
  const S = {
    built: 50,
    F: 200,
    coreTop: 208,
    gondola: new THREE.Vector3(),
    portrait: false,
    W: 1440,
    H: 900,
  }

  // --- LISTEN
  let station: ReturnType<typeof P.totalStation>
  let deck: THREE.Mesh
  const surveyor = new THREE.Group()
  const targets: THREE.Vector3[] = []
  let laser: THREE.Line
  let fan: THREE.LineSegments
  let marks: THREE.Points
  let hitDot: THREE.Mesh
  let prism: THREE.Group
  const aim = new THREE.Vector3()
  const towerPt = new THREE.Vector3()
  const muzzle = new THREE.Vector3()

  // --- PROTOTYPE
  let model: THREE.LineSegments
  let modelMat: THREE.ShaderMaterial
  const levelLabels: { mesh: THREE.Mesh; y: number }[] = []

  // --- BUILD
  const load = new THREE.Group()
  let slings: THREE.LineSegments
  const braces: THREE.Mesh[] = []
  const braceLen: number[] = []
  const workers: THREE.Mesh[] = []
  let sparks: Sparks
  const glows: THREE.Mesh[] = []
  let sparkClock = 0
  let sparkSide = 0

  // --- SUPPORT
  const cradle = new THREE.Group()
  let ropes: THREE.LineSegments
  const davits: THREE.Mesh[] = []

  // --- RESULTS
  const rings: THREE.LineLoop[] = []

  // annotations
  let cStation: Callout, cHit: Callout, cModel: Callout, cBrace: Callout, cBolt: Callout, cCradle: Callout
  let hitShown = -1

  const tmp = new THREE.Vector3()
  const tmp2 = new THREE.Vector3()
  const hook = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const qSwing = new THREE.Quaternion()
  const proj = new THREE.Vector3()
  const pend = new THREE.Vector3(0, -1, 0)
  const DOWN = new THREE.Vector3(0, -1, 0)

  /** Screen position (px) of a world point via the (last frame's) camera. */
  function screen(ctx: ChapterContext, p: THREE.Vector3) {
    proj.copy(p).project(ctx.camera)
    return { x: (proj.x * 0.5 + 0.5) * S.W, y: (-proj.y * 0.5 + 0.5) * S.H, ok: proj.z < 1 && Number.isFinite(proj.x + proj.y) }
  }

  /** Visible band for 3D annotations (keeps labels out of the chrome and off the plate). */
  function annotate(c: Callout, ctx: ChapterContext, p: THREE.Vector3, vis: number) {
    const s = screen(ctx, p)
    const short = S.H <= 500 && S.W > S.H
    const top = short ? 60 : clamp(S.H * 0.105, 80, 112) + 12
    const bottom = S.H - (short ? 56 : clamp(S.H * 0.105, 82, 110)) - 12
    let v = vis
    if (!s.ok || s.y < top + 20 || s.y > bottom) v = 0
    if (v > 0 && hud) {
      const b = hud.plateBox()
      if (s.x < b.right + 30 && s.y > b.top - 50) v = 0
      // the label sits above-beside its point: keep it off the headline block while that shows
      const h = hud.headBox()
      if (hud.headVis > 0.02 && s.y + c.offset.y - 16 < h.bottom + 10 && s.x - 340 < h.right) v = 0
    }
    c.update(p, ctx.camera, S.W, S.H, v)
  }

  /** The city's towers as boxes (read once from the world's instanced city). */
  function cityBoxes(ctx: ChapterContext, within: number) {
    const city = ctx.world.city.root.children.find(c => (c as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh | undefined
    const out: THREE.Box3[] = []
    if (!city) return out
    const m = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    const scl = new THREE.Vector3()
    const rot = new THREE.Quaternion()
    for (let i = 0; i < city.count; i++) {
      city.getMatrixAt(i, m)
      m.decompose(pos, rot, scl)
      if (Math.hypot(pos.x, pos.z) > within) continue
      out.push(new THREE.Box3().setFromCenterAndSize(pos.clone(), scl.clone()))
    }
    return out
  }

  function pickTargets(ctx: ChapterContext) {
    // rooftop corners across the city ahead of the surveyor (toward +z), in clear sight of the instrument
    const boxes = cityBoxes(ctx, 560)
    const heading = -0.18
    const from = new THREE.Vector3(INSTRUMENT.x, 214, INSTRUMENT.z)
    const bins: ({ p: THREE.Vector3; score: number } | null)[] = [null, null, null, null]
    const ray = new THREE.Ray()
    const hit = new THREE.Vector3()
    const c = new THREE.Vector3()
    const sz = new THREE.Vector3()
    for (const bx of boxes) {
      bx.getCenter(c)
      bx.getSize(sz)
      // the roof of this box (the city stacks podiums, shafts, setbacks and plant)
      const h = c.y + sz.y / 2
      if (sz.x < 8 || sz.z < 8) continue
      const dx = c.x - from.x
      const dz = c.z - from.z
      const d = Math.hypot(dx, dz)
      if (d < 130 || d > 520 || h < 50 || h > 190) continue
      const rel = wrap(Math.atan2(dx, dz) - heading)
      if (Math.abs(rel) > 0.5) continue
      // the rooftop corner nearest the instrument
      const p = new THREE.Vector3(c.x - Math.sign(dx) * sz.x * 0.5, h, c.z - Math.sign(dz) * sz.z * 0.5)
      const probe = p.clone().add(new THREE.Vector3(Math.sign(dx) * 0.8, 0.6, Math.sign(dz) * 0.8))
      const dist = from.distanceTo(probe)
      ray.set(from, probe.clone().sub(from).normalize())
      let clear = true
      for (const o of boxes) {
        if (o === bx) continue
        if (ray.intersectBox(o, hit) && hit.distanceTo(from) < dist) {
          clear = false
          break
        }
      }
      if (!clear) continue
      const bin = Math.min(3, Math.floor(((rel + 0.5) / 1.0) * 4))
      const score = h * 0.6 - Math.abs(d - 300) * 0.1
      const cur = bins[bin]
      if (!cur || score > cur.score) bins[bin] = { p, score }
    }
    // left → right on screen (facing +z, bearing grows toward screen-left)
    for (let i = 3; i >= 0; i--) {
      const b = bins[i]
      if (b) targets.push(b.p)
    }
    while (targets.length < 3) {
      const a = heading + 0.4 - targets.length * 0.3
      targets.push(new THREE.Vector3(from.x + Math.sin(a) * 260, 110, from.z + Math.cos(a) * 260))
    }
  }

  function info(i: number, from: THREE.Vector3, p: THREE.Vector3, tower: boolean) {
    const dx = p.x - from.x
    const dz = p.z - from.z
    // survey bearing clockwise from grid north (−z)
    let hz = (Math.atan2(dx, -dz) * 180) / Math.PI
    if (hz < 0) hz += 360
    const deg = Math.floor(hz)
    const min = Math.floor((hz - deg) * 60)
    const sd = from.distanceTo(p)
    const id = `PT ${String(i + 1).padStart(2, '0')}`
    if (tower) return `${id} · Tower C/5 · SD ${sd.toFixed(2)} m`
    return `${id} · HZ ${String(deg).padStart(3, '0')}°${String(min).padStart(2, '0')}′ · SD ${sd.toFixed(2)} m`
  }

  // ------------------------------------------------------------------ camera
  const keys: { at: number; pose: () => Pose }[] = []
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  function buildKeys() {
    const F = () => S.F
    const g = () => S.gondola
    // cylindrical helpers: position from an absolute point
    const cyl = (x: number, z: number) => ({ a: Math.atan2(x, z), r: Math.hypot(x, z) })
    const LA = cyl(7.2, -7.5)
    const LB = cyl(8.6, -9.4)
    const BA = cyl(36, 4.5)
    const BB = cyl(34, 5)
    const BC = cyl(34, 9)
    keys.push(
      // cut in: riding up the -z face from the glass to the top deck
      { at: 0.0, pose: () => ({ a: -2.62, r: 36, y: F() - 26, t: V(2, F() - 8, -2), fov: 46, side: 6, drop: 2 }) },
      // (rise clear of the steel, outside the -z face, then glide in over the deck)
      { at: 0.05, pose: () => ({ a: -2.72, r: 31, y: F() + 13, t: V(1.5, F() + 5, 12), fov: 44, side: 6, drop: 4 }) },
      // LISTEN: over the surveyor's shoulder, the city ahead
      { at: 0.085, pose: () => ({ ...LA, y: F() + 16.5, t: V(0.5, F() + 2.5, 30), fov: 42, side: 7, drop: 6, pside: -6 }) },
      { at: 0.3, pose: () => ({ ...LB, y: F() + 18, t: V(-0.5, F() - 1, 24), fov: 42, side: 6, drop: 6, pside: -5 }) },
      // PROTOTYPE: drone orbit above the frontier, the drawing ahead of the steel
      { at: 0.37, pose: () => ({ a: 2.52, r: 80, y: F() + 27, t: V(0, F() + 8, 0), fov: 40, side: 15, drop: 8 }) },
      { at: 0.465, pose: () => ({ a: 2.24, r: 76, y: F() + 22, t: V(0, F() + 7, 0), fov: 40, side: 15, drop: 8 }) },
      // BUILD: low on the +x face, looking up the cable to the crane; then in to the bolts
      { at: 0.525, pose: () => ({ ...BA, y: 193, t: V(18, 222, 0.5), fov: 56, side: 5, drop: 6 }) },
      { at: 0.585, pose: () => ({ ...BB, y: 198, t: V(17, 216, 0.5), fov: 52, side: 5, drop: 5 }) },
      { at: 0.635, pose: () => ({ ...BC, y: 206, t: V(15, 210.5, -0.5), fov: 40, side: 5, drop: 4 }) },
      // (swing wide round the -z side)
      { at: 0.668, pose: () => ({ a: 2.75, r: 66, y: g().y + 9, t: V(-4, g().y + 10, -12), fov: 44, side: 8, drop: 7 }) },
      // SUPPORT: a three-quarter on the (-x, -z) corner, level with the cradle on the finished glass
      { at: 0.7, pose: () => ({ a: -2.52, r: 46, y: g().y + 1.5, t: V(g().x * 0.5 - 4, g().y + 7.5, -12), fov: 42, side: 6, drop: 8 }) },
      { at: 0.785, pose: () => ({ a: -2.4, r: 43, y: g().y + 2.5, t: V(g().x * 0.5 - 4, g().y + 7, -12), fov: 41, side: 6, drop: 8 }) },
      // RESULTS: the long lens on the whole top of the tower, crane and all
      { at: 0.845, pose: () => ({ a: statsA, r: 240, y: 168, t: V(0, 199, 0), fov: 29, side: 36, drop: 34 }) },
      { at: 0.945, pose: () => ({ a: statsA - 0.07, r: 230, y: 174, t: V(0, 202, 0), fov: 28, side: 36, drop: 34 }) },
      // cut out: push in and rise toward the top
      { at: 1.0, pose: () => ({ a: statsA - 0.13, r: 180, y: 200, t: V(0, 216, 0), fov: 31, side: 28, drop: 26 }) },
    )
  }
  let statsA = 2.3

  /** Pick an orbit angle for the long lens with a clear line of sight over the city. */
  function pickStatsAngle(ctx: ChapterContext) {
    const boxes = cityBoxes(ctx, 320).map(b => b.expandByScalar(2))
    if (!boxes.length) return
    const ray = new THREE.Ray()
    const hit = new THREE.Vector3()
    let best = 2.3
    let bestScore = -Infinity
    for (let a = 1.95; a <= 2.75; a += 0.05) {
      let score = -Math.abs(a - 2.3) * 4
      for (const r of [235, 225, 175]) {
        const cam = new THREE.Vector3(Math.sin(a) * r, 170, Math.cos(a) * r)
        for (const ty of [150, 196, 228]) {
          const tgt = new THREE.Vector3(0, ty, 0)
          const dist = cam.distanceTo(tgt)
          ray.set(cam, tgt.clone().sub(cam).normalize())
          for (const b of boxes) {
            if (b.containsPoint(cam)) score -= 40
            else if (ray.intersectBox(b, hit) && hit.distanceTo(cam) < dist - 20) score -= 10
          }
        }
      }
      if (score > bestScore) {
        bestScore = score
        best = a
      }
    }
    statsA = best
  }

  function poseAt(local: number): Pose {
    let i = 0
    while (i < keys.length - 2 && local > keys[i + 1].at) i++
    const k0 = keys[i]
    const k1 = keys[i + 1]
    const t = smoother(clamp((local - k0.at) / (k1.at - k0.at)))
    const a = k0.pose()
    const b = k1.pose()
    return {
      a: a.a + wrap(b.a - a.a) * t,
      r: lerp(a.r, b.r, t),
      y: lerp(a.y, b.y, t),
      t: a.t.lerp(b.t, t),
      fov: lerp(a.fov, b.fov, t),
      side: lerp(a.side, b.side, t),
      drop: lerp(a.drop, b.drop, t),
      pside: lerp(a.pside ?? 0, b.pside ?? 0, t),
    }
  }

  // ------------------------------------------------------------------ crane
  /** Where this chapter wants the crane: yaw, reach and absolute hook height. */
  function craneTarget(local: number, out: { yaw: number; reach: number; hookY: number }) {
    const F = S.F
    const slot = braceMid(HERO)
    const PARK = { yaw: 3.55, reach: 0.5, hookY: F + 22 }
    const PICK = { yaw: 0.14, reach: (HALF + 6.5) / JIB_L, hookY: slot.y + HANG - 42 }
    const lp = seg(local, W_PROTO)
    if (local < W_PROTO[0]) {
      Object.assign(out, PARK)
      return out
    }
    if (local < W_BUILD[0]) {
      // slew round to the pick while the frame is a drawing, cable paying out
      const e = smoothstep(0.1, 0.95, lp)
      out.yaw = PARK.yaw + wrap(PICK.yaw - PARK.yaw) * e
      out.reach = lerp(PARK.reach, PICK.reach, e)
      out.hookY = lerp(PARK.hookY, PICK.hookY, smoothstep(0.3, 1, lp))
      return out
    }
    const p = seg(local, W_BUILD)
    const home = HALF / JIB_L
    if (p < 0.4) {
      // hoist: the brace rises up the face, slowing as it arrives
      const e = 1 - Math.pow(1 - p / 0.4, 2.2)
      out.yaw = lerp(PICK.yaw, 0, e)
      out.reach = PICK.reach
      out.hookY = lerp(PICK.hookY, slot.y + HANG + 0.35, e)
    } else if (p < 0.64) {
      // trolley in: home it into the bay
      const e = smoothstep(0.52, 0.64, p)
      out.yaw = 0
      out.reach = lerp(PICK.reach, home, e)
      out.hookY = slot.y + HANG + 0.35 * (1 - smoothstep(0.58, 0.64, p))
    } else {
      // landed; bolted; the slings come off and the hook climbs away
      const e = smoothstep(0.84, 1, p)
      out.yaw = lerp(0, 0.35, e)
      out.reach = lerp(home, 0.55, e)
      out.hookY = lerp(slot.y + HANG, F + 20, e)
    }
    if (local > W_BUILD[1]) {
      const e = smoothstep(W_SUPPORT[0], 0.9, local)
      out.yaw = lerp(0.35, 0.62, e)
      out.reach = 0.55
      out.hookY = F + 20
    }
    return out
  }

  function braceMid(k: number) {
    const { a, b } = P.braceEnds(k)
    return a.clone().add(b).multiplyScalar(0.5)
  }

  return {
    id: ID,
    group,
    // the four steps (sheet centres), then the results
    anchors: [...beat(0, 4, STEP_A, STEP_B).centers, 0.885],

    async init(ctx) {
      mobile = ctx.mobile
      reduced = ctx.reducedMotion
      hud = new ProcessHud(ctx.stage)
      buildKeys()

      // LISTEN ------------------------------------------------------------
      station = P.totalStation()
      group.add(station.root)
      deck = new THREE.Mesh(P.deckGeometry(), P.paintedMat())
      deck.castShadow = !mobile
      deck.receiveShadow = !mobile
      group.add(deck)
      const wGeo = P.workerGeometry({ reach: 0.9, reachL: 0.5 })
      const man = new THREE.Mesh(wGeo, P.paintedMat())
      man.castShadow = !mobile
      surveyor.add(man)
      group.add(surveyor)
      pickTargets(ctx)
      const lg = new THREE.BufferGeometry()
      lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage))
      laser = new THREE.Line(
        lg,
        new THREE.LineBasicMaterial({ color: new THREE.Color(T.signal).multiplyScalar(3.2), transparent: true, toneMapped: false, depthWrite: false, fog: false }),
      )
      laser.frustumCulled = false
      group.add(laser)
      const n = targets.length + 1
      const fg = new THREE.BufferGeometry()
      fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3).setUsage(THREE.DynamicDrawUsage))
      fg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 6), 3).setUsage(THREE.DynamicDrawUsage))
      fan = new THREE.LineSegments(
        fg,
        new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }),
      )
      fan.frustumCulled = false
      group.add(fan)
      marks = P.diamondPoints(n, T.line, mobile ? 26 : 17)
      group.add(marks)
      hitDot = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(T.signal).multiplyScalar(5), toneMapped: false, fog: false }))
      group.add(hitDot)
      // a survey prism on the tower's corner column
      prism = new THREE.Group()
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), MAT.safety())
      pole.position.y = 0.7
      const glassPrism = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 16), new THREE.MeshStandardMaterial({ color: '#f4f1ea', metalness: 0.2, roughness: 0.3 }))
      glassPrism.rotation.x = Math.PI / 2
      glassPrism.position.y = 1.45
      glassPrism.rotation.z = Math.PI / 4
      prism.add(pole, glassPrism)
      group.add(prism)
      await nextFrame()

      // PROTOTYPE ---------------------------------------------------------
      const g = P.modelLines(53, 57, { mullions: !mobile })
      modelMat = P.draftMaterial(53 * FLOOR_H - 0.3, 57 * FLOOR_H + 0.5)
      model = new THREE.LineSegments(g, modelMat)
      model.frustumCulled = false
      group.add(model)
      for (let f = 53; f <= 57; f++) {
        const lab = etchLabel(`L${f} · EL. +${(f * FLOOR_H).toFixed(3)}`, { height: 1.0, color: T.line, glow: 1.5, font: "'IBM Plex Mono', ui-monospace, monospace", weight: 500 })
        const mat = lab.material as THREE.MeshBasicMaterial
        mat.fog = false
        mat.blending = THREE.AdditiveBlending
        mat.depthWrite = false
        // right-aligned just left of the dimension string, facing the orbit
        const w = (lab.geometry as THREE.PlaneGeometry).parameters.width
        lab.geometry.translate(-w / 2 - 0.8, 0.6, 0)
        lab.position.set(HALF + 4.5, f * FLOOR_H, HALF + 4.5)
        lab.rotation.y = 2.35
        group.add(lab)
        levelLabels.push({ mesh: lab, y: f * FLOOR_H })
      }
      await nextFrame()

      // BUILD -------------------------------------------------------------
      // the bracing is galvanised: a distinct, lighter system against the primer-red beams
      const galv = new THREE.MeshStandardMaterial({ color: '#aab2b9', metalness: 0.45, roughness: 0.55 })
      for (let k = 0; k < 5; k++) {
        const { a, b } = P.braceEnds(k)
        const len = a.distanceTo(b) - 0.72
        braceLen.push(len)
        const mesh = new THREE.Mesh(P.braceGeometry(len), galv)
        mesh.quaternion.copy(P.braceQuaternion(b.clone().sub(a)))
        mesh.position.copy(a).add(b).multiplyScalar(0.5)
        mesh.castShadow = !mobile
        mesh.receiveShadow = !mobile
        braces.push(mesh)
        if (k === HERO) {
          mesh.position.set(0, 0, 0)
          mesh.quaternion.identity()
          load.add(mesh)
        } else group.add(mesh)
      }
      group.add(load)
      const sg = new THREE.BufferGeometry()
      sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3).setUsage(THREE.DynamicDrawUsage))
      slings = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: '#1a1d21' }))
      slings.frustumCulled = false
      group.add(slings)
      const wA = new THREE.Mesh(P.workerGeometry({ reach: 1.1, reachL: 0.7 }), P.paintedMat())
      wA.position.set(13.75, 2 * 0 + 52 * FLOOR_H, 2.4)
      wA.rotation.y = Math.PI / 2
      const wB = new THREE.Mesh(P.workerGeometry({ reach: 1.25, reachL: 0.3, hat: T.craneYellow }), P.paintedMat())
      wB.position.set(14.92, 53 * FLOOR_H - 0.25 + 0.28, -4.25)
      wB.rotation.y = 0.2
      for (const w of [wA, wB]) {
        w.castShadow = !mobile
        workers.push(w)
        group.add(w)
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      sparks = new Sparks(mobile ? 160 : 320, 0.55 * dpr, mobile ? 2.5 : 2)
      group.add(sparks.points)
      for (let i = 0; i < 2; i++) {
        const gl = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(T.safety).multiplyScalar(3), toneMapped: false }))
        gl.visible = false
        glows.push(gl)
        group.add(gl)
      }
      await nextFrame()

      // SUPPORT -----------------------------------------------------------
      const body = new THREE.Mesh(P.gondolaGeometry(), P.paintedMat())
      body.castShadow = !mobile
      cradle.add(body)
      const c1 = new THREE.Mesh(P.workerGeometry({ reach: 1.45, reachL: 0.4, hat: '#f4f1ea', vest: T.craneYellow }), P.paintedMat())
      c1.position.set(-1.1, 0.08, 0.05)
      c1.rotation.y = 0.25
      const c2 = new THREE.Mesh(P.workerGeometry({ reach: 0.5, reachL: 1.2 }), P.paintedMat())
      c2.position.set(1.3, 0.08, 0)
      c2.rotation.y = -0.5
      cradle.add(c1, c2)
      group.add(cradle)
      const rg = new THREE.BufferGeometry()
      rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3).setUsage(THREE.DynamicDrawUsage))
      ropes = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: '#23272c' }))
      ropes.frustumCulled = false
      group.add(ropes)
      const davitGeo = P.braceGeometry(2.6)
      for (let i = 0; i < 2; i++) {
        const d = new THREE.Mesh(davitGeo, MAT.steel())
        d.rotation.y = Math.PI / 2
        davits.push(d)
        group.add(d)
      }

      // RESULTS -----------------------------------------------------------
      for (const f of DATUM_FLOORS) {
        const y = f * FLOOR_H
        const e = HALF + 1.4
        const rg2 = new THREE.BufferGeometry().setFromPoints([V(-e, y, -e), V(e, y, -e), V(e, y, e), V(-e, y, e)])
        const ring = new THREE.LineLoop(
          rg2,
          new THREE.LineBasicMaterial({ color: new THREE.Color(T.line).multiplyScalar(1.6), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }),
        )
        ring.frustumCulled = false
        rings.push(ring)
        group.add(ring)
      }
      pickStatsAngle(ctx)

      // annotations (drawing callouts)
      cStation = new Callout(ctx.stage, { side: 'right', offset: { x: 70, y: -64 } })
      cStation.label.textContent = 'TS-01 · Total station'
      cHit = new Callout(ctx.stage, { side: 'right', offset: { x: 60, y: -46 } })
      cModel = new Callout(ctx.stage, { side: 'right', offset: { x: 70, y: -40 } })
      cModel.label.textContent = 'A-502 · Next floors · L53–L57'
      cBrace = new Callout(ctx.stage, { side: 'right', offset: { x: 80, y: -70 } })
      cBrace.label.textContent = `BR-52 · Brace · ${braceLen[HERO].toFixed(2)} m`
      cBolt = new Callout(ctx.stage, { side: 'right', offset: { x: 70, y: 56 } })
      cBolt.label.textContent = '8 × M24 · Bolted home'
      cCradle = new Callout(ctx.stage, { side: 'right', offset: { x: 70, y: -60 } })
    },

    update(local, frame, ctx) {
      applySite(ctx, ID, local)
      const wp = ctx.world.params
      // golden hour, but crisp: thin the haze so the city reads to the horizon
      wp.fog = 0.72
      const dt = frame.dt
      S.W = frame.width
      S.H = frame.height
      S.portrait = frame.height > frame.width
      hud.setMode(S.portrait || frame.width < 640, !S.portrait && frame.height <= 500)

      // the tower's live (damped) height this frame, exactly as World will compute it
      const target = builtAt(ID, local)
      const cur = ctx.world.tower.frontier / FLOOR_H
      const kb = 1 - Math.exp(-2.2 * dt)
      const built = clamp(cur + (target - cur) * kb, 0, FLOORS)
      S.built = built
      S.F = built * FLOOR_H
      S.coreTop = Math.min(FLOORS, built + 2) * FLOOR_H
      const F = S.F

      const lL = seg(local, W_LISTEN)
      const lP = seg(local, W_PROTO)
      const lB = seg(local, W_BUILD)

      // ---------------------------------------------------------------- LISTEN
      const stationOn = local < W_BUILD[0] + 0.02
      station.root.visible = stationOn
      surveyor.visible = stationOn
      const inst = tmp.copy(INSTRUMENT).setY(S.coreTop)
      station.root.position.copy(inst)
      deck.position.set(0, S.coreTop, 0)
      deck.visible = stationOn
      surveyor.position.set(inst.x - 0.95, S.coreTop, inst.z - 0.55)
      surveyor.rotation.y = 0.75
      prism.position.set(PRISM.x, F - 3.2, PRISM.z)
      prism.visible = local < W_PROTO[0] + 0.03

      const nT = targets.length
      const shots = nT + 1
      const beamOn = smoothstep(0.0, 0.05, lL) * (1 - smoothstep(0.93, 1, lL))
      const sweep = lL * shots
      const si = Math.min(shots - 1, Math.floor(sweep))
      const sf = sweep - si
      towerPt.set(PRISM.x, F - 1.75, PRISM.z)
      const tgt = (i: number) => (i < nT ? targets[i] : towerPt)
      // aim: move to target si over the first 55% of its slot, dwell the rest
      station.scope.updateWorldMatrix(true, false)
      station.scope.localToWorld(muzzle.copy(station.muzzle))
      const prevP = si === 0 ? targets[0].clone().add(V(-60, 40, -30)) : tgt(si - 1).clone()
      const nextP = tgt(si).clone()
      const mv = smoother(clamp(sf / 0.55))
      const dirA = prevP.clone().sub(muzzle).normalize()
      const dirB = nextP.clone().sub(muzzle).normalize()
      const lenA = prevP.distanceTo(muzzle)
      const lenB = nextP.distanceTo(muzzle)
      const dir = dirA.lerp(dirB, mv).normalize()
      aim.copy(muzzle).addScaledVector(dir, lerp(lenA, lenB, mv))
      const dwell = sf >= 0.55 ? 1 : 0
      // turn the instrument toward the aim
      const inv = station.root.worldToLocal(aim.clone())
      station.alidade.rotation.y = Math.atan2(inv.x, inv.z)
      const horiz = Math.hypot(aim.x - muzzle.x, aim.z - muzzle.z)
      station.scope.rotation.x = -Math.atan2(aim.y - muzzle.y, horiz)
      station.scope.updateWorldMatrix(true, false)
      station.scope.localToWorld(muzzle.copy(station.muzzle))
      const lp = laser.geometry.attributes.position as THREE.BufferAttribute
      lp.setXYZ(0, muzzle.x, muzzle.y, muzzle.z)
      lp.setXYZ(1, aim.x, aim.y, aim.z)
      lp.needsUpdate = true
      laser.visible = beamOn > 0.01
      ;(laser.material as THREE.LineBasicMaterial).opacity = beamOn
      hitDot.visible = beamOn > 0.01 && dwell > 0
      hitDot.position.copy(aim)
      const camD = ctx.camera.position.distanceTo(aim)
      hitDot.scale.setScalar(Math.max(0.12, camD * 0.0028) * (reduced ? 1 : 0.85 + 0.15 * Math.sin(frame.time * 9)))
      // the fan of measured shots + their marks
      const fp = fan.geometry.attributes.position as THREE.BufferAttribute
      const fc = fan.geometry.attributes.color as THREE.BufferAttribute
      const mp = marks.geometry.attributes.position as THREE.BufferAttribute
      const mvAttr = marks.geometry.attributes.aVis as THREE.BufferAttribute
      const fanFade = 1 - smoothstep(0.9, 1, lL)
      for (let i = 0; i < shots; i++) {
        const p = tgt(i)
        const measured = i < si || (i === si && dwell > 0) ? 1 : 0
        const v = measured * fanFade * (lL > 0 ? 1 : 0)
        fp.setXYZ(i * 2, muzzle.x, muzzle.y, muzzle.z)
        fp.setXYZ(i * 2 + 1, p.x, p.y, p.z)
        const k = v * 0.55
        fc.setXYZ(i * 2, LINE_COL.r * k * 0.4, LINE_COL.g * k * 0.4, LINE_COL.b * k * 0.4)
        fc.setXYZ(i * 2 + 1, LINE_COL.r * k, LINE_COL.g * k, LINE_COL.b * k)
        mp.setXYZ(i, p.x, p.y, p.z)
        mvAttr.setX(i, v)
      }
      fp.needsUpdate = true
      fc.needsUpdate = true
      mp.needsUpdate = true
      mvAttr.needsUpdate = true
      fan.visible = marks.visible = lL > 0 && lL < 1

      // annotations for LISTEN
      const listenVis = smoothstep(0.1, 0.16, local) * (1 - smoothstep(W_LISTEN[1] - 0.03, W_LISTEN[1], local))
      // small screens: one annotation at a time (the reading wins while the beam dwells)
      const crowded = S.W < 900 || S.H < 560
      annotate(cStation, ctx, tmp2.copy(inst).setY(S.coreTop + 1.7), listenVis * (crowded && dwell > 0 && beamOn > 0.5 ? 0 : 1))
      if (dwell > 0 && si !== hitShown) {
        hitShown = si
        cHit.label.textContent = info(si, muzzle, tgt(si), si === nT)
      }
      annotate(cHit, ctx, aim, dwell > 0 && si === hitShown ? listenVis * beamOn : 0)

      // ---------------------------------------------------------------- PROTOTYPE
      const hold = smoothstep(0.02, 0.16, lP) * (1 - smoothstep(0.8, 0.98, lP))
      ctx.post.params.draft = 0.72 * hold
      // the world's ghost steps back while the Listen fan and the Prototype drawing speak
      wp.ghost = lerp(lerp(1, 0.55, listenVis), 0.35, hold)
      const drawn = local >= W_PROTO[1] ? 1 : smoothstep(0.06, 0.66, lP)
      const modelOn = (local > W_PROTO[0] - 0.01 ? 1 : 0) * (1 - smoothstep(W_BUILD[0] + 0.02, W_BUILD[0] + 0.06, local))
      model.visible = modelOn > 0.001
      modelMat.uniforms.uDraw.value = drawn
      modelMat.uniforms.uFrontier.value = F
      modelMat.uniforms.uOpacity.value = modelOn * lerp(0.45, 1, hold)
      for (const l of levelLabels) {
        const on = smoothstep(0, 0.03, drawn - (l.y - 212) / 17) * hold * (l.y > F - 1 ? 1 : 0)
        l.mesh.visible = on > 0.01
        ;(l.mesh.material as THREE.MeshBasicMaterial).opacity = on
      }
      annotate(cModel, ctx, tmp2.set(-HALF, 57 * FLOOR_H, -HALF), hold * smoothstep(0.35, 0.5, lP))

      // ---------------------------------------------------------------- CRANE
      const ct = craneTarget(local, { yaw: 0, reach: 0, hookY: 0 })
      const crane = ctx.world.crane
      const baseY = S.coreTop
      const kc = 1 - Math.exp(-3.2 * dt)
      wp.crane.yaw = ct.yaw
      wp.crane.reach = ct.reach
      wp.crane.drop = baseY + MAST_H + 0.3 - ct.hookY
      // predict the rendered hook this frame (World damps the crane)
      const yaw0 = -crane.slew.rotation.y
      const reach0 = crane.trolley.position.x / JIB_L
      const drop0 = (crane as unknown as { drop: number }).drop ?? wp.crane.drop
      const yawP = yaw0 + wrap(wp.crane.yaw - yaw0) * kc
      const reachP = reach0 + (wp.crane.reach - reach0) * kc
      const dropP = drop0 + (wp.crane.drop - drop0) * kc
      Crane.hookPosition(hook, baseY, yawP, reachP, dropP)
      hook.x += ctx.world.tower.swayAt(baseY)
      // the world's hook swings as a damped pendulum (one frame behind; tiny per-frame change)
      hook.add(crane.swing)
      pend.set(crane.swing.x, -Math.max(2, dropP), crane.swing.z).normalize()

      // ---------------------------------------------------------------- BUILD
      // the rest of the diagonal fills in as each bay's frame completes (the ones above the
      // hero only once the camera has left the +x face)
      for (let k = 0; k < 5; k++) {
        if (k === HERO) continue
        const m = braces[k]
        const grow = k > HERO && local < W_BUILD[1] + 0.02 ? 0 : clamp((built - (50 + k + 1.35)) / 0.3)
        m.visible = grow > 0.001
        if (!m.visible) continue
        m.scale.set(grow, 1, 1)
        m.position.copy(BRACES[k].mid).addScaledVector(BRACES[k].dir, -(braceLen[k] * (1 - grow)) / 2)
      }
      const heroOn = local > W_BUILD[0] - 0.02
      load.visible = heroOn
      const { a: ha, b: hb, dir: hdir, mid: slot, q: qHome } = BRACES[HERO]
      if (heroOn) {
        // the member hangs on the line of the swinging cable, a gentle tag-line yaw on top
        const land = smoothstep(0.5, 0.64, lB)
        qSwing.setFromUnitVectors(DOWN, pend)
        if (!reduced) qSwing.multiply(q.setFromAxisAngle(DOWN, 0.05 * Math.sin(frame.time * 0.8) * (1 - land)))
        const hang = pend.clone().multiplyScalar(HANG).add(hook)
        // the ideal path (target hook) — the member follows it into the slot
        const ideal = V(Math.cos(ct.yaw) * ct.reach * JIB_L, ct.hookY - HANG, Math.sin(ct.yaw) * ct.reach * JIB_L)
        if (lB >= 0.64) ideal.copy(slot)
        const settle = lB > 0.64 && !reduced ? -0.05 * Math.sin((lB - 0.64) * 70) * Math.exp(-(lB - 0.64) * 40) : 0
        load.position.copy(hang).lerp(ideal, land)
        if (lB >= 0.64) load.position.copy(slot).add(V(0, settle, 0))
        load.quaternion.copy(qSwing).multiply(qHome).slerp(qHome, land)
      }
      // slings from the hook to two pick points on the member
      const slung = heroOn && lB < 0.86
      slings.visible = slung
      if (slung) {
        const sp = slings.geometry.attributes.position as THREE.BufferAttribute
        const d = V(1, 0, 0).applyQuaternion(load.quaternion)
        const h = tmp2.copy(hook).addScaledVector(pend, 0.75)
        const p1 = load.position.clone().addScaledVector(d, 2.2)
        const p2 = load.position.clone().addScaledVector(d, -2.2)
        sp.setXYZ(0, h.x, h.y, h.z)
        sp.setXYZ(1, p1.x, p1.y + 0.2, p1.z)
        sp.setXYZ(2, h.x, h.y, h.z)
        sp.setXYZ(3, p2.x, p2.y + 0.2, p2.z)
        // a tag line trailing from the low end (the ironworkers steer the load with it)
        const lowEnd = p1.y < p2.y ? p1 : p2
        const tagSway = reduced ? 0 : 0.35 * Math.sin(frame.time * 0.9)
        const tagLen = lerp(9, 2.5, smoothstep(0.45, 0.64, lB))
        sp.setXYZ(4, lowEnd.x, lowEnd.y, lowEnd.z)
        sp.setXYZ(5, lowEnd.x + tagSway, lowEnd.y - tagLen, lowEnd.z - 0.6)
        sp.needsUpdate = true
      }
      // ironworkers once their deck is there
      for (const w of workers) w.visible = built >= 53.55 && local > W_PROTO[0]
      // bolting: sparks at both ends (time-driven effect; reduced motion → a steady glow)
      const bolting = local >= W_BUILD[0] && lB > 0.66 && lB < 0.92
      const endA = glows[0].position.copy(ha).addScaledVector(hdir, 0.4)
      endA.x += 0.35
      const endB = glows[1].position.copy(hb).addScaledVector(hdir, -0.4)
      endB.x += 0.35
      if (bolting && !reduced) {
        sparkClock -= dt
        if (sparkClock <= 0) {
          sparkClock = 0.06 + Math.random() * 0.12
          sparkSide = Math.random() < 0.55 ? sparkSide : 1 - sparkSide
          sparks.emit(sparkSide ? endB : endA, mobile ? 7 : 12, 2.6)
        }
      }
      sparks.update(dt)
      glows.forEach(g => (g.visible = bolting && reduced))
      const buildVis = smoothstep(W_BUILD[0] + 0.01, W_BUILD[0] + 0.04, local) * (1 - smoothstep(W_BUILD[1] - 0.025, W_BUILD[1], local))
      annotate(cBrace, ctx, load.position, buildVis * (1 - smoothstep(0.62, 0.66, lB)))
      annotate(cBolt, ctx, endA, buildVis * smoothstep(0.66, 0.72, lB))

      // ---------------------------------------------------------------- SUPPORT
      const glazedTop = Math.max(0, built - 6) * FLOOR_H
      const gy = glazedTop - 13 + (reduced ? 0 : 0.04 * Math.sin(frame.time * 0.9))
      const gp = seg(local, [W_SUPPORT[0] - 0.05, W_SUPPORT[1] + 0.05])
      const gx = lerp(-3, -10.5, smoother(gp))
      const gz = -(HALF + 0.45 + 0.4 + 0.34)
      S.gondola.set(gx, gy, gz)
      const cradleOn = local > W_BUILD[1] - 0.03
      cradle.visible = ropes.visible = cradleOn
      davits.forEach(d => (d.visible = cradleOn))
      if (cradleOn) {
        cradle.position.set(gx, gy, gz)
        cradle.rotation.z = reduced ? 0 : 0.006 * Math.sin(frame.time * 0.7)
        const rp = ropes.geometry.attributes.position as THREE.BufferAttribute
        const topY = F - 4.2
        for (let i = 0; i < 2; i++) {
          const a = tmp2.copy(P.GONDOLA_ROPES[i]).add(cradle.position)
          rp.setXYZ(i * 2, a.x, a.y, a.z)
          rp.setXYZ(i * 2 + 1, a.x, topY, gz)
          davits[i].position.set(a.x, topY + 0.2, -HALF - 0.1 - 1.3)
        }
        rp.needsUpdate = true
      }
      const supportVis = smoothstep(W_SUPPORT[0] + 0.01, W_SUPPORT[0] + 0.04, local) * (1 - smoothstep(W_SUPPORT[1] - 0.02, W_SUPPORT[1] + 0.005, local))
      // brighter sky reflections on the finished glass while the cradle works it
      wp.env = lerp(1, 1.5, smoothstep(W_SUPPORT[0] - 0.02, W_SUPPORT[0] + 0.03, local) * (1 - smoothstep(W_SUPPORT[1], STATS_IN + 0.02, local)))
      const level = Math.floor(gy / FLOOR_H) + 1
      const ct2 = `BMU cradle · L${level} · Curtain wall care`
      if (cCradle.label.textContent !== ct2) cCradle.label.textContent = ct2
      annotate(cCradle, ctx, tmp2.set(gx, gy + 2.2, gz), supportVis)

      // ---------------------------------------------------------------- RESULTS
      const statsVis = [0, 1, 2].map(i => smoothstep(STATS_IN + i * 0.018, STATS_IN + 0.03 + i * 0.018, local) * (1 - smoothstep(0.935, 0.965, local)))
      rings.forEach((r, i) => {
        const v = statsVis[i]
        r.visible = v > 0.01
        ;(r.material as THREE.LineBasicMaterial).opacity = v * 0.9
      })
      const pts: DatumPoint[] = DATUM_FLOORS.map(f => {
        // the tower's left silhouette corner at that level
        let best: { x: number; y: number; ok: boolean } | null = null
        for (const [sx, sz] of [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ]) {
          const s = screen(ctx, tmp2.set(sx * (HALF + 1.4), f * FLOOR_H, sz * (HALF + 1.4)))
          if (!best || s.x < best.x) best = s
        }
        return best!
      })
      hud.datums(pts, statsVis)

      // ---------------------------------------------------------------- HUD
      const B = beat(local, 4, STEP_A, STEP_B)
      const fills = [0, 1, 2, 3].map(i => clamp((local - (STEP_A + i * SPAN)) / SPAN))
      hud.update({
        head: smoothstep(0.03, 0.06, local) * (1 - smoothstep(0.185, 0.205, local)),
        headIn: local > 0.035 && local < 0.2,
        plate: smoothstep(0.195, 0.22, local) * (1 - smoothstep(STEP_B - 0.005, STEP_B + 0.015, local)),
        step: B.idx,
        fills,
        stats: statsVis,
      })

      // post: bloom for the laser, sparks and warning lights; a warm film
      ctx.post.params.bloomStrength = 0.5 + 0.15 * beamOn
    },

    camera(local, frame, out) {
      const p = poseAt(local)
      const portrait = S.portrait
      const r = p.r * (portrait ? 1.32 : 1)
      out.position.set(Math.sin(p.a) * r, p.y, Math.cos(p.a) * r)
      out.target.copy(p.t)
      // landscape: subject right of centre (copy lives on the left);
      // portrait: centred and in the upper part of the frame (copy lives at the bottom)
      const side = portrait ? (p.pside ?? 0) : p.side
      const fwd = tmp.copy(out.target).sub(out.position).setY(0).normalize()
      out.target.x += fwd.z * side
      out.target.z -= fwd.x * side
      if (portrait) out.target.y -= p.drop
      out.fov = p.fov + (portrait ? 8 : 0)
      if (!reduced) {
        // a drone's idle float
        out.position.x += Math.sin(frame.time * 0.31) * 0.25
        out.position.y += Math.sin(frame.time * 0.23) * 0.2
      }
      out.parallax = reduced ? 0 : 0.6
    },
  }
}
