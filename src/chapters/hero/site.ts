import * as THREE from 'three'
import { MAT, T, TOWER_W, etchLabel, iBeamGeometry, instancedDepth, mergeAll, personGeometry } from '../../kit/steel'
import { nextFrame } from '../../core/yield'
import { PenLines } from './pen'
import { projectBoard } from './sign'

/*
 * GROUNDBREAKING — the hero's own story objects, on top of the world's site
 * (src/world/site.ts already has the hoarding, the concrete apron, the corner
 * batter boards + building-line strings, cabins, the laydown yard, a crew):
 *
 *   plan        the cyan plan drawn onto the earth: every grid line run out
 *               past the building, A–F / 1–6 grid bubbles, the footprint
 *   set-out     batter boards + mason's lines on the INTERIOR grid lines
 *               (the world strings the perimeter), drawn on
 *   footings    grout pedestals, steel base plates and anchor bolts at every
 *               column of the world tower's grid (in its erection order)
 *   gang        ironworkers at the far plates (small in every shot: scale, not
 *               subject), dark against the dawn with a warm work-light rim;
 *               a surveyor's total station on the east side
 *   lights      two mobile light towers, still burning at dawn
 *   hoarding    the plywood hoarding round the lot (the world's copy, graphics
 *               and all, is hidden while the hero stages its own site), with
 *               the project board bolted to its street face
 *   load        a beam bundle on the crane's hook (spreader bar + slings) that
 *               the hero flies to the laydown yard and lands
 *
 * Everything is at real scale (metres) and outside the column lines or on
 * the apron.
 */

export const HALF = TOWER_W / 2
export const BAYS = 5
export const BAY = TOWER_W / BAYS
/** top of the world's concrete apron (src/world/site.ts) */
const APRON = 0.12
/**
 * Where the crane picks the bundle up: off the top of the load on the world's
 * delivery flatbed (src/world/site.ts: truck(-8, 22), bundle(-8.6, 22, …, y 1))
 */
export const PICK = new THREE.Vector3(-8.6, 2.61, 21.87)
/** where the crane sets it down: a clear patch on the west side, in view of grid line A */
export const LAYDOWN = new THREE.Vector3(-27, 0, -25)
/**
 * the bundle's yaw on its dunnage: it rides the hook without turning, so it
 * lands turned by the slew between the flatbed and the laydown
 */
export const REST_RY = Math.atan2(PICK.z, PICK.x) - Math.atan2(LAYDOWN.z, LAYDOWN.x)
/** bundle centre at the laydown (on its dunnage) */
export const REST_Y = 0.66
/** the street face of the hoarding (src/world/site.ts F = 60) */
const FENCE = 60

export interface ColumnSpot {
  x: number
  z: number
  /** fraction of the floor's column sequence (tower.ts erect order) */
  q: number
}

/** The world tower's floor-0 columns, in its erection order (tower.ts buildSteel). */
export function columnSpots(mobile: boolean): ColumnSpot[] {
  const out: ColumnSpot[] = []
  const edge = (i: number) => i === 0 || i === BAYS
  for (let i = 0; i <= BAYS; i++)
    for (let j = 0; j <= BAYS; j++) {
      if (mobile && !edge(i) && !edge(j)) continue
      out.push({ x: -HALF + i * BAY, z: -HALF + j * BAY, q: 0 })
    }
  out.forEach((c, k) => (c.q = k / out.length))
  return out
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z)

/**
 * The crew at dawn: read as figures against the site, not characters — the
 * clothes a stop darker, and a warm rim where the work lights catch their
 * edges (grazing view angles), so they hold as silhouettes.
 */
function crewMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.85 })
  m.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= 0.62;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float crewRim = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          totalEmissiveRadiance += vec3(1.0, 0.66, 0.36) * 0.55 * crewRim * crewRim * crewRim;
        }`,
      )
  }
  m.customProgramCacheKey = () => 'hero-crew-rim'
  return m
}

export class Site {
  group = new THREE.Group()
  spots: ColumnSpot[]
  /** mason's lines on the batter boards (drawn on) */
  strings!: THREE.LineSegments
  batter!: THREE.Group
  /** the plan drawn on the earth: grid lines + bubbles */
  plan!: THREE.LineSegments
  planLabels: THREE.Mesh[] = []
  footings!: THREE.InstancedMesh
  plates!: THREE.InstancedMesh
  lampMat!: THREE.MeshBasicMaterial
  /** the load on the crane */
  load = new THREE.Group()
  bundle = new THREE.Group()
  spreader!: THREE.Mesh
  slings!: THREE.LineSegments
  private m4 = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private s = new THREE.Vector3(1, 1, 1)
  private p = new THREE.Vector3()

  constructor(private mobile: boolean) {
    this.group.name = 'hero-site'
    this.spots = columnSpots(mobile)
  }

  async build() {
    this.buildPlan()
    this.buildSetOut()
    await nextFrame()
    this.buildFootings()
    this.buildGang()
    this.buildLights()
    this.buildLoad()
    this.buildHoarding()
    this.group.add(projectBoard(-12.4, FENCE, this.mobile))
  }

  // ---------------------------------------------------------------- the plan on the earth
  private buildPlan() {
    const plan = new PenLines()
    const E = HALF + 12
    const Y = APRON + 0.03
    const RB = 1.35
    const ring = (cx: number, cz: number, start: number) => {
      const pts: THREE.Vector3[] = []
      for (let k = 0; k <= 36; k++) {
        const a = (k / 36) * Math.PI * 2 + Math.PI / 2
        pts.push(new THREE.Vector3(cx + Math.cos(a) * RB, Y, cz + Math.sin(a) * RB))
      }
      plan.poly(pts, start, 0.12)
    }
    const letters = 'ABCDEF'
    for (let i = 0; i <= BAYS; i++) {
      const c = -HALF + i * BAY
      plan.seg(new THREE.Vector3(c, Y, -E), new THREE.Vector3(c, Y, E), 0.05 * i, 0.35)
      plan.seg(new THREE.Vector3(E, Y, c), new THREE.Vector3(-E, Y, c), 0.1 + 0.05 * i, 0.35)
      ring(c, E + RB, 0.3 + 0.04 * i)
      ring(-E - RB, c, 0.4 + 0.04 * i)
      // labels lie on the ground, reading from the street (+z)
      for (const [txt, x, z] of [
        [letters[i], c, E + RB],
        [String(BAYS + 1 - i), -E - RB, c],
      ] as [string, number, number][]) {
        const l = etchLabel(txt, { height: 1.7, color: T.line, weight: 500, font: "'IBM Plex Mono', monospace", pad: 10 })
        l.rotation.x = -Math.PI / 2
        l.position.set(x, Y + 0.01, z)
        const m = l.material as THREE.MeshBasicMaterial
        m.blending = THREE.AdditiveBlending
        m.depthWrite = false
        m.toneMapped = false
        m.color.set(T.line).multiplyScalar(1.1)
        this.planLabels.push(l)
        this.group.add(l)
      }
    }
    // the footprint, doubled like a heavy plan line
    for (const o of [0, 0.35]) {
      const h = HALF + o
      plan.poly(
        [
          new THREE.Vector3(-h, Y, h),
          new THREE.Vector3(h, Y, h),
          new THREE.Vector3(h, Y, -h),
          new THREE.Vector3(-h, Y, -h),
          new THREE.Vector3(-h, Y, h),
        ],
        0.25,
        0.5,
      )
    }
    this.plan = plan.build({ opacity: 0.62, head: 2.4 })
    this.group.add(this.plan)
  }

  // ---------------------------------------------------------------- set-out (interior grid lines)
  private buildSetOut() {
    const R = HALF + 7
    const timber: THREE.BufferGeometry[] = []
    const flags: THREE.BufferGeometry[] = []
    const board = (x: number, z: number, alongX: boolean) => {
      const ry = alongX ? 0 : Math.PI / 2
      timber.push(mergeAll([box(0.08, 1.15, 0.08, -0.75, 0.57, 0), box(0.08, 1.15, 0.08, 0.75, 0.57, 0), box(1.8, 0.16, 0.04, 0, 0.82, 0.06)]).rotateY(ry).translate(x, 0, z))
      flags.push(mergeAll([box(0.1, 0.12, 0.1, -0.75, 1.2, 0), box(0.1, 0.12, 0.1, 0.75, 1.2, 0)]).rotateY(ry).translate(x, 0, z))
    }
    const str = new PenLines()
    const Y = 0.9
    for (let i = 1; i < BAYS; i++) {
      const c = -HALF + i * BAY
      board(c, -R, true)
      board(c, R, true)
      board(-R, c, false)
      board(R, c, false)
      str.seg(new THREE.Vector3(c, Y, R), new THREE.Vector3(c, Y, -R), 0.03 * i, 0.5)
      str.seg(new THREE.Vector3(-R, Y, c), new THREE.Vector3(R, Y, c), 0.12 + 0.03 * i, 0.5)
    }
    this.batter = new THREE.Group()
    const timberMesh = new THREE.Mesh(mergeAll(timber), new THREE.MeshStandardMaterial({ color: '#a4814f', roughness: 0.85 }))
    timberMesh.castShadow = !this.mobile
    const flagMesh = new THREE.Mesh(mergeAll(flags), MAT.safety())
    this.batter.add(timberMesh, flagMesh)
    this.group.add(this.batter)
    this.strings = str.build({ color: '#ff5b9a', opacity: 0.9, head: 1.2 })
    this.group.add(this.strings)
  }

  // ---------------------------------------------------------------- footings
  private buildFootings() {
    const n = this.spots.length
    // grout pedestal poured on the apron
    const cap = new THREE.BoxGeometry(1.5, 0.9, 1.5)
    cap.translate(0, -0.45 + 0.36, 0)
    this.footings = new THREE.InstancedMesh(cap, MAT.concrete({ instanced: true }), n)
    this.footings.receiveShadow = !this.mobile
    this.footings.castShadow = !this.mobile
    this.footings.customDepthMaterial = instancedDepth()
    // base plate + four anchor bolts with nuts, one merged piece
    const parts: THREE.BufferGeometry[] = [box(0.9, 0.05, 0.9, 0, 0.385, 0)]
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const b = new THREE.CylinderGeometry(0.035, 0.035, 0.32, 8)
        b.translate(sx * 0.32, 0.46, sz * 0.32)
        parts.push(b)
        parts.push(box(0.11, 0.06, 0.11, sx * 0.32, 0.44, sz * 0.32))
      }
    this.plates = new THREE.InstancedMesh(mergeAll(parts), MAT.steel({ instanced: true }), n)
    this.plates.castShadow = !this.mobile
    this.plates.customDepthMaterial = instancedDepth()
    this.footings.frustumCulled = false
    this.plates.frustumCulled = false
    this.group.add(this.footings, this.plates)
    this.setFootings(0, 0)
  }

  private lastF = -1
  private lastB = -1

  /** f: 0..1 pedestals poured (in erection order); b: 0..1 base plates set. */
  setFootings(f: number, b: number) {
    if (f === this.lastF && b === this.lastB) return
    this.lastF = f
    this.lastB = b
    const n = this.spots.length
    for (let k = 0; k < n; k++) {
      const s = this.spots[k]
      const kf = THREE.MathUtils.clamp(f * (n + 4) - k, 0, 4) / 4
      const ef = 1 - (1 - kf) * (1 - kf)
      this.p.set(s.x, -0.9 * (1 - ef), s.z)
      this.m4.compose(this.p, this.q.identity(), this.s.setScalar(kf > 0 ? 1 : 0.0001))
      this.footings.setMatrixAt(k, this.m4)
      const kb = THREE.MathUtils.clamp(b * (n + 4) - k, 0, 4) / 4
      // plates are lowered in and land (a small settle, no bounce)
      const drop = kb >= 1 ? 0 : 1.6 * (1 - kb) * (1 - kb)
      this.p.set(s.x, drop, s.z)
      this.m4.compose(this.p, this.q.identity(), this.s.setScalar(kb > 0 ? 1 : 0.0001))
      this.plates.setMatrixAt(k, this.m4)
    }
    this.footings.instanceMatrix.needsUpdate = true
    this.plates.instanceMatrix.needsUpdate = true
  }

  // ---------------------------------------------------------------- the gang at the plates
  private buildGang() {
    // the far (east and back) rows: every hero camera works the front-left
    // corner, so the crew stays 30 m+ out — scale for the steel, never the subject
    const at: [number, number, number, 'work' | 'reach' | 'stand' | 'walk'][] = [
      [14.3, -8.4, -2.2, 'work'],
      [16.4, 3.3, -1.3, 'stand'],
      [8.9, -16.5, 0.4, 'reach'],
      [-3.3, -16.3, 0.9, 'work'],
      [15.9, 14.8, -2.6, 'walk'],
    ]
    const use = this.mobile ? at.filter((_, i) => i % 2 === 0) : at
    const geos = use.map(([x, z, ry, pose], i) => personGeometry({ pose, seed: 40 + i }).rotateY(ry).translate(x, APRON, z))
    // a surveyor's total station on its tripod on the east side, and its operator
    const tp = new THREE.Vector3(27, 0, 22)
    geos.push(personGeometry({ pose: 'stand', seed: 47 }).rotateY(-2.2).translate(tp.x + 0.8, 0, tp.z + 0.7))
    const people = new THREE.Mesh(mergeAll(geos), crewMaterial())
    people.castShadow = !this.mobile
    const tri: THREE.BufferGeometry[] = []
    for (let k = 0; k < 3; k++) {
      const leg = new THREE.CylinderGeometry(0.025, 0.03, 1.55, 6)
      leg.translate(0, 0.72, 0)
      leg.rotateZ(0.26)
      leg.rotateY((k / 3) * Math.PI * 2)
      tri.push(leg)
    }
    tri.push(box(0.22, 0.26, 0.18, 0, 1.62, 0))
    const station = new THREE.Mesh(mergeAll(tri).translate(tp.x, 0, tp.z), MAT.craneYellow())
    this.group.add(people, station)
  }

  // ---------------------------------------------------------------- light towers
  private buildLights() {
    const steel: THREE.BufferGeometry[] = []
    const lamps: THREE.BufferGeometry[] = []
    const at: [number, number][] = this.mobile
      ? [[-50, 52]]
      : [
          [-50, 52],
          [53, -50],
        ]
    for (const [x, z] of at) {
      const face = Math.atan2(-x, -z) // lamps face the footprint
      steel.push(mergeAll([box(2.4, 0.9, 1.3, 0, 0.75, 0), box(0.22, 9, 0.22, 0, 5.4, -0.2), box(2.2, 0.14, 0.16, 0, 9.85, -0.2)]).rotateY(face).translate(x, 0, z))
      const lp: THREE.BufferGeometry[] = []
      for (let k = 0; k < 4; k++) lp.push(box(0.44, 0.36, 0.1, -0.78 + k * 0.52, 10.15, 0.0))
      lamps.push(mergeAll(lp).rotateY(face).translate(x, 0, z))
    }
    const body = new THREE.Mesh(mergeAll(steel), MAT.craneYellow())
    body.castShadow = !this.mobile
    this.lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd7a0').multiplyScalar(5), toneMapped: false })
    const heads = new THREE.Mesh(mergeAll(lamps), this.lampMat)
    this.group.add(body, heads)
  }

  // ---------------------------------------------------------------- hoarding
  private buildHoarding() {
    const H = 2.6
    const SHEET = 2.44
    const GATE: [number, number] = [16, 28]
    // painted plywood, sheet by sheet: graphite, a hazard foot band, a yellow cap rail
    const c = document.createElement('canvas')
    c.width = 256
    c.height = Math.round((256 * H) / SHEET)
    const g = c.getContext('2d')!
    const band = Math.round(c.height * 0.1)
    g.fillStyle = '#22282f'
    g.fillRect(0, 0, c.width, c.height)
    g.fillStyle = 'rgba(0,0,0,0.35)'
    g.fillRect(0, 0, 3, c.height)
    g.fillStyle = 'rgba(255,255,255,0.05)'
    g.fillRect(3, 0, 2, c.height)
    g.save()
    g.beginPath()
    g.rect(0, c.height - band, c.width, band)
    g.clip()
    g.fillStyle = T.craneYellow
    g.fillRect(0, c.height - band, c.width, band)
    g.fillStyle = '#15181b'
    for (let x = -band * 2; x < c.width + band * 2; x += band * 2) {
      g.beginPath()
      g.moveTo(x, c.height)
      g.lineTo(x + band, c.height - band)
      g.lineTo(x + band * 2, c.height - band)
      g.lineTo(x + band, c.height)
      g.closePath()
      g.fill()
    }
    g.restore()
    g.fillStyle = T.craneYellow
    g.fillRect(0, 0, c.width, 3)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = THREE.RepeatWrapping
    tex.anisotropy = 4

    const V = (x: number, z: number) => new THREE.Vector2(x, z)
    // counter-clockwise from above, so each run's outward face is on its right
    const runs: [THREE.Vector2, THREE.Vector2][] = [
      [V(-FENCE, FENCE), V(GATE[0], FENCE)],
      [V(GATE[1], FENCE), V(FENCE, FENCE)],
      [V(FENCE, FENCE), V(FENCE, -FENCE)],
      [V(FENCE, -FENCE), V(-FENCE, -FENCE)],
      [V(-FENCE, -FENCE), V(-FENCE, FENCE)],
    ]
    const quad = (a: THREE.Vector2, b: THREE.Vector2, out: boolean) => {
      const len = a.distanceTo(b)
      const u = len / SHEET
      const geo = new THREE.BufferGeometry()
      const [p, q] = out ? [a, b] : [b, a]
      geo.setAttribute('position', new THREE.Float32BufferAttribute([p.x, 0, p.y, q.x, 0, q.y, q.x, H, q.y, p.x, 0, p.y, q.x, H, q.y, p.x, H, p.y], 3))
      geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, u, 0, u, 1, 0, 0, u, 1, 0, 1], 2))
      geo.computeVertexNormals()
      return geo
    }
    const outer = new THREE.Mesh(mergeAll(runs.map(([a, b]) => quad(a, b, true))), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0 }))
    const inner = new THREE.Mesh(mergeAll(runs.map(([a, b]) => quad(a, b, false))), new THREE.MeshStandardMaterial({ color: '#8a7a62', roughness: 0.9 }))
    outer.receiveShadow = inner.receiveShadow = !this.mobile
    outer.castShadow = !this.mobile
    this.group.add(outer, inner)
  }

  // ---------------------------------------------------------------- the load on the hook
  private buildLoad() {
    const L = 6
    const beam = (y: number, z: number) => iBeamGeometry(L, { depth: 0.45, width: 0.22 }).translate(-L / 2, y, z)
    // dunnage waiting at the landing spot
    const dun = mergeAll([box(0.22, 0.2, 2.2, -2, 0.1, 0), box(0.22, 0.2, 2.2, 2, 0.1, 0)])
    dun.rotateY(REST_RY).translate(LAYDOWN.x, 0, LAYDOWN.z)
    const dunnage = new THREE.Mesh(dun, new THREE.MeshStandardMaterial({ color: '#8a6b45', roughness: 0.9 }))
    // the bundle: four beams, two straps; origin at its centre (spans y −0.46..0.45)
    const bundle = new THREE.Mesh(mergeAll([beam(-0.46, -0.13), beam(-0.46, 0.13), beam(0, -0.13), beam(0, 0.13)]), MAT.primer())
    bundle.castShadow = !this.mobile
    const straps = new THREE.Mesh(mergeAll([box(0.08, 1.0, 0.6, -1.8, 0, 0), box(0.08, 1.0, 0.6, 1.8, 0, 0)]), MAT.rubber())
    this.bundle.add(bundle, straps)
    this.spreader = new THREE.Mesh(box(5.6, 0.22, 0.22, 0, 0, 0), MAT.craneYellow())
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3))
    this.slings = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: '#1d1f22' }))
    this.slings.frustumCulled = false
    this.load.add(this.bundle, this.spreader, this.slings)
    this.group.add(dunnage, this.load)
  }
}
