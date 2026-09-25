import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { MAT, T, latticeGeometry, mergeAll } from '../../kit/steel'
import { forInstances, instancedDepth } from './mats'

/*
 * THE CONSTRUCTION HOIST — a rack-and-pinion car on a lattice mast, tied
 * back to the +x face of the tower by the +z corner. The camera rides it.
 *
 *   mast    1.508 m lattice sections (instanced; it grows with the building),
 *           a rack on the car side, wall ties every second floor
 *   car     1.5 x 3.2 x 2.5 m cage: yellow frame, galvanised deck + roof,
 *           wire-mesh walls, hazard kick plates, the drive unit and a beacon
 *           on the roof, guard rails
 *   gates   a landing at every floor: platform, yellow frame, a lifting mesh
 *           leaf (opens while the car is docked) and a painted level header
 *
 * World units are metres; +x is out of the facade.
 */

/** slab edge of the +x face */
export const FACE = 15.3
export const CAR = { cx: 16.7, cz: 12.2, hx: 0.75, hz: 1.6, h: 2.5 }
export const MAST = { x: 16.7, z: 14.35, size: 0.65, section: 1.508 }
export const GATE_SLABS = 32
const MAX_SECTIONS = 100
const MAX_TIES = 20

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return g
}

/** a small canvas texture helper */
function canvasTex(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void, repeat = true) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  paint(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  return t
}

/** a plane with UVs in metres / tile */
function tiledPlane(w: number, h: number, tile: number) {
  const g = new THREE.PlaneGeometry(w, h)
  const uv = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile)
  return g
}

export class Hoist {
  root = new THREE.Group()
  car = new THREE.Group()
  private mast: THREE.InstancedMesh
  private ties: THREE.InstancedMesh
  private leaves: THREE.InstancedMesh
  private beaconMat: THREE.MeshBasicMaterial
  /** the beacon's lamp colour, parsed once (scaled into beaconMat each frame) */
  private beaconBase = new THREE.Color(T.safety)
  private m = new THREE.Matrix4()
  private lastSections = -1
  private lastTies = -1
  /** gate lift per slab (index slab - 1), written each frame */
  gateOpen = new Float32Array(GATE_SLABS)
  private lastGates = new Float32Array(GATE_SLABS).fill(-1)

  constructor(mobile: boolean, yOf: (slab: number) => number) {
    // plain meshes (the car) share the kit's materials; the instanced parts get their own copies
    const steel = MAT.steel()
    const yellow = MAT.craneYellow()
    const steelI = forInstances(steel)
    const yellowI = forInstances(yellow)
    const shadows = !mobile

    // ---- mast (instanced sections) + wall ties
    const sec = mergeAll([
      latticeGeometry({ len: MAST.section, size: MAST.size, chord: 0.07, bay: MAST.section }),
      box(0.06, MAST.section, 0.12, 0, MAST.section / 2, -MAST.size / 2 - 0.06),
      // section flanges
      box(MAST.size + 0.08, 0.05, MAST.size + 0.08, 0, 0.025, 0),
    ])
    this.mast = new THREE.InstancedMesh(sec, steelI, MAX_SECTIONS)
    this.mast.count = 0
    this.mast.castShadow = shadows
    this.mast.customDepthMaterial = instancedDepth()
    this.mast.frustumCulled = false
    this.root.add(this.mast)

    const tieLen = MAST.x - MAST.size / 2 - FACE
    const tie = mergeAll([
      box(tieLen, 0.08, 0.08, -MAST.size / 2 - tieLen / 2, 0, 0.26),
      box(tieLen, 0.08, 0.08, -MAST.size / 2 - tieLen / 2, 0, -0.26),
      box(0.07, 0.4, 0.9, -MAST.size / 2 - tieLen + 0.035, 0, 0),
      box(0.12, 0.12, 0.7, -MAST.size / 2 - 0.06, 0, 0),
    ])
    this.ties = new THREE.InstancedMesh(tie, yellowI, MAX_TIES)
    this.ties.count = 0
    this.ties.frustumCulled = false
    this.root.add(this.ties)

    // ---- the car
    const { hx, hz, h } = CAR
    const p = 0.045
    const yParts: THREE.BufferGeometry[] = []
    for (const sx of [-1, 1])
      for (const sz of [-1, 0, 1]) yParts.push(box(0.09, h, 0.09, sx * (hx - p), h / 2, sz * (hz - p)))
    for (const y of [0.32, 1.18, h - 0.05]) {
      const t = y > 2 ? 0.1 : 0.06
      for (const sx of [-1, 1]) yParts.push(box(0.07, t, 2 * hz, sx * (hx - p), y, 0))
      for (const sz of [-1, 1]) yParts.push(box(2 * hx, t, 0.07, 0, y, sz * (hz - p)))
    }
    // roof guard rail
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) yParts.push(box(0.05, 1.05, 0.05, sx * (hx - 0.06), h + 0.6, sz * (hz - 0.06)))
    for (const y of [h + 0.62, h + 1.1]) {
      for (const sx of [-1, 1]) yParts.push(box(0.045, 0.045, 2 * hz - 0.1, sx * (hx - 0.06), y, 0))
      yParts.push(box(2 * hx - 0.1, 0.045, 0.045, 0, y, -(hz - 0.06)))
    }
    const carYellow = new THREE.Mesh(mergeAll(yParts), yellow)

    const motor = new THREE.CylinderGeometry(0.17, 0.17, 0.62, 16)
    motor.rotateZ(Math.PI / 2)
    const m1 = motor.clone().translate(0, h + 0.55, hz - 0.35)
    const m2 = motor.translate(0, h + 0.55, hz - 0.82)
    const gParts = [
      box(2 * hx, 0.14, 2 * hz, 0, -0.07, 0),
      box(2 * hx - 0.25, 0.28, 2 * hz - 0.3, 0, -0.28, 0),
      box(2 * hx, 0.08, 2 * hz, 0, h + 0.04, 0),
      box(1.0, 0.26, 1.0, 0, h + 0.21, hz - 0.58),
      m1,
      m2,
      box(0.5, h + 0.2, 0.26, 0, h / 2 + 0.05, hz + 0.1),
      box(0.42, 0.52, 0.26, hx - 0.32, h + 0.34, -hz + 0.45),
    ]
    const carGrey = new THREE.Mesh(mergeAll(gParts), steel)

    // wire-mesh walls (see-through at a distance, like the real thing)
    const wire = canvasTex(64, 64, g => {
      g.clearRect(0, 0, 64, 64)
      g.strokeStyle = 'rgba(64, 70, 78, 1)'
      g.lineWidth = 3
      for (let i = 0; i <= 64; i += 16) {
        g.beginPath()
        g.moveTo(i, 0)
        g.lineTo(i, 64)
        g.moveTo(0, i)
        g.lineTo(64, i)
        g.stroke()
      }
    })
    const meshMat = new THREE.MeshStandardMaterial({
      map: wire,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      metalness: 0.6,
      roughness: 0.5,
    })
    const ph = h - 0.42
    const planes: THREE.BufferGeometry[] = []
    for (const sx of [-1, 1]) {
      const g = tiledPlane(2 * hz - 0.1, ph, 0.4)
      g.rotateY(Math.PI / 2)
      g.translate(sx * (hx - 0.03), 0.34 + ph / 2, 0)
      planes.push(g)
    }
    for (const sz of [-1, 1]) {
      const g = tiledPlane(2 * hx - 0.1, ph, 0.4)
      g.translate(0, 0.34 + ph / 2, sz * (hz - 0.03))
      planes.push(g)
    }
    const carMesh = new THREE.Mesh(mergeGeometries(planes), meshMat)
    carMesh.renderOrder = 2

    // hazard kick plates
    const haz = canvasTex(64, 16, g => {
      g.fillStyle = '#16191d'
      g.fillRect(0, 0, 64, 16)
      g.fillStyle = T.craneYellow
      for (let i = -16; i < 80; i += 16) {
        g.beginPath()
        g.moveTo(i, 16)
        g.lineTo(i + 8, 16)
        g.lineTo(i + 16, 0)
        g.lineTo(i + 8, 0)
        g.closePath()
        g.fill()
      }
    })
    const kick: THREE.BufferGeometry[] = []
    for (const sx of [-1, 1]) {
      const g = tiledPlane(2 * hz - 0.04, 0.28, 0.28)
      g.rotateY(sx > 0 ? Math.PI / 2 : -Math.PI / 2)
      g.translate(sx * (hx + 0.005), 0.16, 0)
      kick.push(g)
    }
    for (const sz of [-1, 1]) {
      const g = tiledPlane(2 * hx - 0.04, 0.28, 0.28)
      if (sz < 0) g.rotateY(Math.PI)
      g.translate(0, 0.16, sz * (hz + 0.005))
      kick.push(g)
    }
    const carKick = new THREE.Mesh(mergeGeometries(kick), new THREE.MeshStandardMaterial({ map: haz, roughness: 0.7 }))

    // the beacon (flashes while the car runs, steady when it is docked)
    this.beaconMat = new THREE.MeshBasicMaterial({ color: this.beaconBase.clone().multiplyScalar(3), toneMapped: false })
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.18, 12), this.beaconMat)
    beacon.position.set(hx - 0.25, h + 0.17, -hz + 0.35)

    for (const o of [carYellow, carGrey]) {
      o.castShadow = shadows
      o.receiveShadow = shadows
    }
    this.car.add(carYellow, carGrey, carMesh, carKick, beacon)
    this.root.add(this.car)

    // ---- landing gates at every floor (instanced, slab order)
    const gy: THREE.BufferGeometry[] = []
    for (const sz of [-1, 1]) {
      gy.push(box(0.08, 2.4, 0.08, 0.32, 1.2, sz * 1.46))
      gy.push(box(0.05, 1.1, 0.05, 0.62, 0.55, sz * 1.5))
      for (const y of [0.55, 1.1]) gy.push(box(0.6, 0.05, 0.05, 0.33, y, sz * 1.5))
    }
    gy.push(box(0.1, 0.1, 3.0, 0.32, 2.42, 0))
    const gg: THREE.BufferGeometry[] = [box(0.65, 0.08, 3.0, 0.325, -0.04, 0), box(0.05, 0.94, 2.84, 0.335, 2.9, 0)]
    const leaf: THREE.BufferGeometry[] = []
    for (let i = 0; i < 12; i++) leaf.push(box(0.03, 1.92, 0.03, 0.27, 1.06, -1.32 + (i * 2.64) / 11))
    for (const y of [0.1, 1.06, 2.02]) leaf.push(box(0.045, 0.045, 2.8, 0.27, y, 0))

    const frames = new THREE.InstancedMesh(mergeAll(gy), yellowI, GATE_SLABS)
    const decks = new THREE.InstancedMesh(mergeAll(gg), steelI, GATE_SLABS)
    this.leaves = new THREE.InstancedMesh(mergeAll(leaf), yellowI, GATE_SLABS)
    for (let i = 0; i < GATE_SLABS; i++) {
      this.m.makeTranslation(FACE, yOf(i + 1), CAR.cz)
      frames.setMatrixAt(i, this.m)
      decks.setMatrixAt(i, this.m)
      this.leaves.setMatrixAt(i, this.m)
    }
    for (const o of [frames, decks, this.leaves]) {
      o.frustumCulled = false
      o.count = 0
      o.receiveShadow = shadows
      this.root.add(o)
    }
    this.gates = [frames, decks, this.leaves]
    this.yOf = yOf
  }
  private gates: THREE.InstancedMesh[]
  private yOf: (slab: number) => number

  /**
   * Pose the hoist: the car at y (m), the mast up to mastTop (m), landings
   * on slabs 1..landings, ties on every second floor below the mast top.
   * running: 0..1 how fast the car is travelling (the beacon flashes only then).
   */
  update(carY: number, mastTop: number, landings: number, time: number, reducedMotion: boolean, running = 0) {
    this.car.position.set(CAR.cx, carY, CAR.cz)
    const sections = Math.min(MAX_SECTIONS, Math.ceil(mastTop / MAST.section))
    if (sections !== this.lastSections) {
      for (let i = Math.max(0, this.lastSections); i < sections; i++) {
        this.m.makeTranslation(MAST.x, i * MAST.section, MAST.z)
        this.mast.setMatrixAt(i, this.m)
      }
      this.mast.count = sections
      this.mast.instanceMatrix.needsUpdate = true
      this.lastSections = sections
    }
    const top = sections * MAST.section
    let ties = 0
    for (let s = 2; ties < MAX_TIES; s += 2) {
      const y = this.yOf(s) - 0.3
      if (y > top - 1) break
      ties++
    }
    if (ties !== this.lastTies) {
      for (let i = 0; i < ties; i++) {
        this.m.makeTranslation(MAST.x, this.yOf(2 + i * 2) - 0.3, MAST.z)
        this.ties.setMatrixAt(i, this.m)
      }
      this.ties.count = ties
      this.ties.instanceMatrix.needsUpdate = true
      this.lastTies = ties
    }
    const n = Math.max(0, Math.min(GATE_SLABS, landings))
    for (const g of this.gates) g.count = n
    let dirty = false
    for (let i = 0; i < n; i++) {
      const o = this.gateOpen[i]
      if (Math.abs(o - this.lastGates[i]) < 1e-4) continue
      this.lastGates[i] = o
      this.m.makeTranslation(FACE, this.yOf(i + 1) + o * 1.9, CAR.cz)
      this.leaves.setMatrixAt(i, this.m)
      dirty = true
    }
    if (dirty) this.leaves.instanceMatrix.needsUpdate = true
    // beacon: a slow rotating-lamp pulse while the car runs (under 1 flash/s),
    // settling to a steady glow when it docks or when motion is reduced
    const run = reducedMotion ? 0 : Math.min(1, running * 4)
    const flash = 0.25 + 0.75 * Math.pow(Math.max(0, Math.sin(time * 4.2)), 6)
    const pulse = 0.7 + (flash - 0.7) * run
    this.beaconMat.color.copy(this.beaconBase).multiplyScalar(0.6 + 3.4 * pulse)
  }
}
