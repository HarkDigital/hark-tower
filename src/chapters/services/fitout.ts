import * as THREE from 'three'
import { MAT, T, TOWER_W } from '../../kit/steel'
import { COUNT, slabOf } from './timeline'

/*
 * FIT-OUT — what a service floor becomes when the car docks: framed
 * curtain-wall units drop into the +x and +z faces (leaving the hoist
 * opening), then the floor lights up warm behind them, bay by bay, with a
 * fluorescent stutter. Everything is instanced and posed from per-floor 0..1
 * values, so any scroll position poses exactly.
 */

const HALF = TOWER_W / 2
/** the world's curtain-wall grid (src/world/tower.ts): 20 units a face on a plane 0.45 m out */
const GLASS_HALF = HALF + 0.45
const PER = 20
const MOD = (GLASS_HALF * 2) / PER
/** our units sit just proud of the world's, so the hand-over is seamless */
const OUT = GLASS_HALF + 0.05
const BAYS = 5
const BAY = TOWER_W / BAYS
/** the hoist opening on the +x face (panel centres inside it stay open) */
const OPEN: [number, number] = [10.5, 13.9]

interface Unit {
  order: number
  pos: THREE.Vector3
  rotY: number
}

/** warm interior light seen through glass: ceiling fixtures, falloff, a floor sheen, dark columns */
function glowTexture() {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 0, 128)
  grad.addColorStop(0, 'rgb(255,255,255)')
  grad.addColorStop(0.16, 'rgb(236,236,236)')
  grad.addColorStop(0.5, 'rgb(120,120,120)')
  grad.addColorStop(0.86, 'rgb(70,70,70)')
  grad.addColorStop(1, 'rgb(120,120,120)')
  g.fillStyle = grad
  g.fillRect(0, 0, 256, 128)
  // ceiling fixtures: a row of bright troffers
  g.fillStyle = '#fff'
  for (let i = 0; i < 4; i++) g.fillRect(14 + i * 64, 5, 36, 6)
  // interior columns / partitions, darker
  g.fillStyle = 'rgba(0,0,0,0.45)'
  g.fillRect(122, 14, 12, 114)
  g.fillStyle = 'rgba(0,0,0,0.22)'
  g.fillRect(40, 20, 6, 108)
  g.fillRect(200, 22, 5, 106)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export class Fitout {
  root = new THREE.Group()
  private glass: THREE.InstancedMesh
  private frames: THREE.InstancedMesh
  private glow: THREE.InstancedMesh
  private units: Unit[][] = []
  private bays: Unit[][] = []
  private offset: number[] = []
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private s = new THREE.Vector3()
  private v = new THREE.Vector3()
  private c = new THREE.Color()
  private up = new THREE.Vector3(0, 1, 0)
  private last: { g: number; l: number }[] = []

  constructor(yOf: (slab: number) => number) {
    let total = 0
    for (let k = 0; k < COUNT; k++) {
      const y = yOf(slabOf(k)) + 2
      const list: Unit[] = []
      const px: number[] = []
      for (let j = PER - 1; j >= 0; j--) {
        const z = -GLASS_HALF + (j + 0.5) * MOD
        if (z > OPEN[0] && z < OPEN[1]) continue
        px.push(z)
      }
      const n = px.length + PER
      let o = 0
      // down the +x face from the hoist, then round the corner along +z
      for (const z of px) list.push({ order: o++ / n, pos: new THREE.Vector3(OUT, y, z), rotY: Math.PI / 2 })
      for (let j = PER - 1; j >= 0; j--) list.push({ order: o++ / n, pos: new THREE.Vector3(-GLASS_HALF + (j + 0.5) * MOD, y, OUT), rotY: 0 })
      this.units.push(list)
      this.offset.push(total)
      total += list.length
      // light bays, same order: the landing bay first
      const bays: Unit[] = []
      const yl = yOf(slabOf(k)) + 1.95
      for (let b = BAYS - 1; b >= 0; b--) bays.push({ order: 0, pos: new THREE.Vector3(HALF - 0.12, yl, -HALF + (b + 0.5) * BAY), rotY: Math.PI / 2 })
      for (let b = BAYS - 1; b >= 0; b--) bays.push({ order: 0, pos: new THREE.Vector3(-HALF + (b + 0.5) * BAY, yl, HALF - 0.12), rotY: 0 })
      bays.forEach((u, i) => (u.order = i / bays.length))
      this.bays.push(bays)
      this.last.push({ g: -1, l: -1 })
    }
    const glassMat = new THREE.MeshStandardMaterial({
      color: T.glass,
      metalness: 0.5,
      roughness: 0.05,
      transparent: true,
      opacity: 0.46,
      envMapIntensity: 1.4,
      depthWrite: false,
    })
    this.glass = new THREE.InstancedMesh(new THREE.PlaneGeometry(MOD - 0.06, 3.88), glassMat, total)
    this.glass.frustumCulled = false
    this.glass.renderOrder = 3
    // unit frames: two mullions + head + sill, dark anodised
    const fr: THREE.BufferGeometry[] = []
    for (const sx of [-1, 1]) fr.push(new THREE.BoxGeometry(0.07, 3.9, 0.07).translate(sx * (MOD / 2 - 0.035), 0, 0))
    for (const sy of [-1, 1]) fr.push(new THREE.BoxGeometry(MOD, 0.08, 0.07).translate(0, sy * 1.91, 0))
    const frameGeo = mergeSimple(fr)
    this.frames = new THREE.InstancedMesh(frameGeo, MAT.mullion(), total)
    this.frames.frustumCulled = false
    this.hideAll(this.glass, total)
    this.hideAll(this.frames, total)

    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTexture(),
      color: new THREE.Color('#ffc987').multiplyScalar(1.35),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    const nb = COUNT * BAYS * 2
    this.glow = new THREE.InstancedMesh(new THREE.PlaneGeometry(BAY, 3.5), glowMat, nb)
    this.glow.frustumCulled = false
    this.glow.renderOrder = 1
    this.glow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(nb * 3).fill(1), 3)
    this.hideAll(this.glow, nb)

    this.root.add(this.glow, this.frames, this.glass)
  }

  private hideAll(mesh: THREE.InstancedMesh, n: number) {
    this.m.makeScale(0, 0, 0)
    for (let i = 0; i < n; i++) mesh.setMatrixAt(i, this.m)
    mesh.instanceMatrix.needsUpdate = true
  }

  /**
   * Floor k: glass 0..1 (units dropping in), lights 0..1 (bays flickering on;
   * calm = a plain fade). handed = the tower's own curtain wall has reached
   * this floor: ours steps aside (same grid, so nothing jumps).
   */
  set(k: number, glass: number, lights: number, calm = false, handed = false) {
    const last = this.last[k]
    const gQ = handed ? 0 : Math.round(glass * 400) / 400
    const lQ = handed ? 0 : Math.round(lights * 400) / 400
    if (last.g !== gQ) {
      last.g = gQ
      const W = 0.22
      this.units[k].forEach((u, j) => {
        const i = this.offset[k] + j
        const e = Math.min(1, Math.max(0, (gQ * (1 + W) - u.order) / W))
        if (e <= 0) this.m.makeScale(0, 0, 0)
        else {
          // lowered in from above; lands
          const fall = (1 - e) * (1 - e)
          this.v.copy(u.pos)
          this.v.y += fall * 2.4
          this.q.setFromAxisAngle(this.up, u.rotY)
          this.m.compose(this.v, this.q, this.s.set(1, 1, 1))
        }
        this.glass.setMatrixAt(i, this.m)
        this.frames.setMatrixAt(i, this.m)
      })
      this.glass.instanceMatrix.needsUpdate = true
      this.frames.instanceMatrix.needsUpdate = true
    }
    if (last.l !== lQ) {
      last.l = lQ
      const W = 0.3
      this.bays[k].forEach((u, j) => {
        const i = k * BAYS * 2 + j
        const e = Math.min(1, Math.max(0, (lQ * (1 + W) - u.order) / W))
        if (e <= 0) this.m.makeScale(0, 0, 0)
        else {
          this.q.setFromAxisAngle(this.up, u.rotY)
          this.m.compose(u.pos, this.q, this.s.set(1, 1, 1))
        }
        this.glow.setMatrixAt(i, this.m)
        // fluorescent start: a couple of stutters, then steady
        const b = e >= 1 || calm ? e : Math.floor(e * 7) % 2 === 0 ? 0.15 + e * 0.4 : 0.85
        this.glow.setColorAt(i, this.c.setScalar(b))
      })
      this.glow.instanceMatrix.needsUpdate = true
      if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true
    }
  }
}

function mergeSimple(parts: THREE.BufferGeometry[]) {
  const geos = parts.map(p => (p.index ? p.toNonIndexed() : p))
  const count = geos.reduce((s, g) => s + g.attributes.position.count, 0)
  const pos = new Float32Array(count * 3)
  const nor = new Float32Array(count * 3)
  let o = 0
  for (const g of geos) {
    pos.set(g.attributes.position.array as Float32Array, o * 3)
    nor.set(g.attributes.normal.array as Float32Array, o * 3)
    o += g.attributes.position.count
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  return out
}
