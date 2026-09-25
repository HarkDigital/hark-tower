import * as THREE from 'three'
import { FLOOR_H, FLOORS, MAT, T, TOWER_W, hssGeometry, iBeamGeometry } from '../kit/steel'
import { logoShapes } from '../logo/logo'

/*
 * THE TOWER — one continuous building that every chapter shares. It rises
 * from scroll: chapters set world.params.built (floors of steel erected),
 * glazed (floors with curtain wall), fitted (floors lit inside), ghost (the
 * blueprint of what's still to come) and crown (the Hark mark sign at the top).
 *
 * Everything is instanced; per-instance `aFloor` (floor + order within the
 * floor) drives erection in the vertex shader, so any `built` value poses
 * exactly (screenshots jump straight to it): pieces not yet placed are hidden,
 * the piece being placed swings down from the crane's height and lands.
 *
 * Geometry: 30 x 30 m, 5 x 5 bays of 6 m, FLOORS floors of FLOOR_H. Centred on
 * the origin, ground at y = 0, main face toward +z.
 */

const BAYS = 5
const BAY = TOWER_W / BAYS
const HALF = TOWER_W / 2
export const TOWER_H = FLOORS * FLOOR_H
export const CROWN_Y = TOWER_H + 3

type Uniforms = { uBuilt: { value: number }; uDrop: { value: number } }

/** Patch a material (and a depth material) so instances erect by aFloor vs uBuilt. */
function erect(mat: THREE.Material, u: Uniforms, key: string) {
  mat.onBeforeCompile = shader => {
    shader.uniforms.uBuilt = u.uBuilt
    shader.uniforms.uDrop = u.uDrop
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aFloor;
        uniform float uBuilt;
        uniform float uDrop;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        // a piece appears when uBuilt reaches aFloor and lands 0.35 floors later
        float kk = clamp((uBuilt - aFloor) / 0.35, 0.0, 1.0);
        transformed *= step(0.0001, kk);
        float fall = 1.0 - kk;
        transformed.y += fall * fall * uDrop;`,
      )
  }
  mat.customProgramCacheKey = () => `erect-${key}`
}

function depthFor(u: Uniforms, key: string) {
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  erect(d, u, `${key}-depth`)
  return d
}

export interface TowerState {
  built: number
  glazed: number
  fitted: number
  ghost: number
  crown: number
  /** 0 day … 1 night: interior lights and the crown glow more at night */
  night: number
}

export class Tower {
  root = new THREE.Group()
  private steelU: Uniforms = { uBuilt: { value: 0 }, uDrop: { value: 14 } }
  private slabU: Uniforms = { uBuilt: { value: 0 }, uDrop: { value: 0 } }
  private glassU: Uniforms = { uBuilt: { value: 0 }, uDrop: { value: 6 } }
  private litU: Uniforms = { uBuilt: { value: 0 }, uDrop: { value: 0 } }
  private core: THREE.Mesh
  private ghostMat: THREE.ShaderMaterial
  private crownMat: THREE.MeshBasicMaterial
  private crownGhost: THREE.LineSegments
  private crownFrame: THREE.Mesh
  private interiorMat: THREE.MeshBasicMaterial
  /** height of the highest erected steel (m) — chapters frame around this */
  frontier = 0

  constructor(private mobile: boolean) {
    this.root.name = 'tower'
    this.buildSteel()
    this.buildSlabs()
    this.core = this.buildCore()
    this.buildGlass()
    this.interiorMat = MAT.interior(1.4).clone()
    this.buildInterior()
    this.ghostMat = this.buildGhost()
    const crown = this.buildCrown()
    this.crownMat = crown.mat
    this.crownGhost = crown.ghost
    this.crownFrame = crown.frame
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], floors: number[], u: Uniforms, key: string, shadow = true) {
    erect(mat, u, key)
    const mesh = new THREE.InstancedMesh(geo, mat, mats.length)
    for (let i = 0; i < mats.length; i++) mesh.setMatrixAt(i, mats[i])
    geo.setAttribute('aFloor', new THREE.InstancedBufferAttribute(new Float32Array(floors), 1))
    mesh.instanceMatrix.needsUpdate = true
    mesh.frustumCulled = false
    if (shadow && !this.mobile) {
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.customDepthMaterial = depthFor(u, key)
    }
    this.root.add(mesh)
    return mesh
  }

  private buildSteel() {
    const m = new THREE.Matrix4()
    const colMats: THREE.Matrix4[] = []
    const colFloors: number[] = []
    const beamMats: THREE.Matrix4[] = []
    const beamFloors: number[] = []
    const perimeterOnly = this.mobile
    const onEdge = (i: number) => i === 0 || i === BAYS
    for (let f = 0; f < FLOORS; f++) {
      const y = f * FLOOR_H
      // columns: grid points (perimeter only on phones); order 0..0.45 within the floor
      let ci = 0
      const cols: [number, number][] = []
      for (let i = 0; i <= BAYS; i++)
        for (let j = 0; j <= BAYS; j++) {
          if (perimeterOnly && !onEdge(i) && !onEdge(j)) continue
          cols.push([i, j])
        }
      for (const [i, j] of cols) {
        m.makeTranslation(-HALF + i * BAY, y, -HALF + j * BAY)
        colMats.push(m.clone())
        colFloors.push(f + (ci++ / cols.length) * 0.45)
      }
      // beams at the top of this floor, along x then z; order 0.45..1
      const beams: THREE.Matrix4[] = []
      for (let j = 0; j <= BAYS; j++) {
        if (perimeterOnly && !onEdge(j)) continue
        for (let i = 0; i < BAYS; i++) beams.push(new THREE.Matrix4().makeTranslation(-HALF + i * BAY, y + FLOOR_H - 0.25, -HALF + j * BAY))
      }
      for (let i = 0; i <= BAYS; i++) {
        if (perimeterOnly && !onEdge(i)) continue
        for (let j = 0; j < BAYS; j++) {
          const r = new THREE.Matrix4().makeRotationY(-Math.PI / 2)
          beams.push(new THREE.Matrix4().makeTranslation(-HALF + i * BAY, y + FLOOR_H - 0.25, -HALF + j * BAY).multiply(r))
        }
      }
      beams.forEach((bm, k) => {
        beamMats.push(bm)
        beamFloors.push(f + 0.45 + (k / beams.length) * 0.55)
      })
    }
    this.instanced(hssGeometry(FLOOR_H, 0.55), MAT.steel().clone(), colMats, colFloors, this.steelU, 'col')
    this.instanced(iBeamGeometry(BAY, { depth: 0.55, width: 0.26 }), MAT.primer().clone(), beamMats, beamFloors, this.steelU, 'beam')
  }

  private buildSlabs() {
    const mats: THREE.Matrix4[] = []
    const floors: number[] = []
    for (let f = 1; f < FLOORS; f++) {
      mats.push(new THREE.Matrix4().makeTranslation(0, f * FLOOR_H - 0.12, 0))
      floors.push(f)
    }
    const g = new THREE.BoxGeometry(TOWER_W + 0.6, 0.24, TOWER_W + 0.6)
    this.instanced(g, MAT.concrete().clone(), mats, floors, this.slabU, 'slab')
  }

  private buildCore() {
    const g = new THREE.BoxGeometry(9, 1, 9)
    g.translate(0, 0.5, 0)
    const core = new THREE.Mesh(g, MAT.concreteDark())
    core.castShadow = !this.mobile
    core.receiveShadow = !this.mobile
    this.root.add(core)
    return core
  }

  private buildGlass() {
    const MOD = 1.5
    const per = Math.round(TOWER_W / MOD)
    const mats: THREE.Matrix4[] = []
    const floors: number[] = []
    const colors: number[] = []
    const q = new THREE.Quaternion()
    const col = new THREE.Color()
    const base = new THREE.Color(T.glass)
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let f = 0; f < FLOORS; f++) {
      for (let side = 0; side < 4; side++) {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (side * Math.PI) / 2)
        for (let k = 0; k < per; k++) {
          const x = -HALF + (k + 0.5) * MOD
          const p = new THREE.Vector3(x, f * FLOOR_H + FLOOR_H / 2, HALF + 0.45).applyQuaternion(q)
          mats.push(new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)))
          floors.push(f + ((side * per + k) / (4 * per)) * 0.999)
          // real curtain walls are never perfectly flat: slight per-pane tint/tilt variation
          col.copy(base).offsetHSL(0, (rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.08)
          colors.push(col.r, col.g, col.b)
        }
      }
    }
    const g = new THREE.PlaneGeometry(MOD - 0.06, FLOOR_H - 0.08)
    const mesh = this.instanced(g, MAT.glass().clone(), mats, floors, this.glassU, 'glass', false)
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(colors), 3)
    mesh.receiveShadow = !this.mobile
  }

  private buildInterior() {
    // one warm light plane per floor, just inside the curtain wall (visible through the gaps at dusk)
    const mats: THREE.Matrix4[] = []
    const floors: number[] = []
    for (let f = 0; f < FLOORS; f++) {
      mats.push(new THREE.Matrix4().makeTranslation(0, f * FLOOR_H + FLOOR_H * 0.55, 0))
      floors.push(f)
    }
    const g = new THREE.BoxGeometry(TOWER_W - 1.2, FLOOR_H * 0.55, TOWER_W - 1.2)
    const mesh = this.instanced(g, this.interiorMat, mats, floors, this.litU, 'lit', false)
    mesh.renderOrder = -1
  }

  /** Cyan blueprint of the whole envelope; shown only above the steel frontier. */
  private buildGhost() {
    const pts: number[] = []
    const seg = (a: THREE.Vector3, b: THREE.Vector3) => pts.push(a.x, a.y, a.z, b.x, b.y, b.z)
    const c = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
    for (let f = 0; f <= FLOORS; f++) {
      const y = f * FLOOR_H
      seg(c(-HALF, y, -HALF), c(HALF, y, -HALF))
      seg(c(HALF, y, -HALF), c(HALF, y, HALF))
      seg(c(HALF, y, HALF), c(-HALF, y, HALF))
      seg(c(-HALF, y, HALF), c(-HALF, y, -HALF))
    }
    for (let i = 0; i <= BAYS; i++) {
      for (const j of [0, BAYS]) {
        seg(c(-HALF + i * BAY, 0, -HALF + j * BAY), c(-HALF + i * BAY, TOWER_H, -HALF + j * BAY))
        seg(c(-HALF + j * BAY, 0, -HALF + i * BAY), c(-HALF + j * BAY, TOWER_H, -HALF + i * BAY))
      }
    }
    // diagonal bracing on the faces every 5 floors (reads as engineering drawing)
    for (let f = 0; f < FLOORS; f += 5) {
      const y0 = f * FLOOR_H
      const y1 = Math.min(TOWER_H, (f + 5) * FLOOR_H)
      seg(c(-HALF, y0, HALF), c(HALF, y1, HALF))
      seg(c(HALF, y0, -HALF), c(-HALF, y1, -HALF))
      seg(c(HALF, y0, HALF), c(HALF, y1, -HALF))
      seg(c(-HALF, y0, -HALF), c(-HALF, y1, HALF))
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
      uniforms: {
        uColor: { value: new THREE.Color(T.line) },
        uFrontier: { value: 0 },
        uGhost: { value: 1 },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying float vY;
        void main() { vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uFrontier, uGhost, uTime; varying float vY;
        float pow2(float x) { return x * x; }
        void main() {
          float above = smoothstep(uFrontier - 1.0, uFrontier + 6.0, vY);
          // a scan line travelling up the unbuilt floors
          float scan = exp(-pow2(fract(vY / 60.0 - uTime * 0.08) - 0.5) * 400.0) * 0.6;
          float a = above * uGhost * (0.38 + scan);
          if (a <= 0.002) discard;
          gl_FragColor = vec4(uColor * a, 1.0);
        }
      `,
    })
    const lines = new THREE.LineSegments(g, mat)
    lines.frustumCulled = false
    this.root.add(lines)
    return mat
  }

  private buildCrown() {
    const shapes = logoShapes()
    const H = 16
    const frame = new THREE.Mesh(new THREE.BoxGeometry(TOWER_W * 0.62, 1.2, 3), MAT.steel())
    frame.position.set(0, TOWER_H + 0.6, 0)
    frame.visible = false
    this.root.add(frame)
    const sign = new THREE.Mesh(new THREE.ShapeGeometry(shapes, 12), MAT.signal(1).clone())
    const mat = sign.material as THREE.MeshBasicMaterial
    sign.scale.setScalar(H)
    sign.position.set(0, CROWN_Y + H / 2, HALF * 0.05)
    this.root.add(sign)
    const back = sign.clone()
    back.rotation.y = Math.PI
    back.position.z = -HALF * 0.05
    this.root.add(back)
    // blueprint outline of the crown for before it's built
    const edges = new THREE.EdgesGeometry(new THREE.ShapeGeometry(shapes, 12), 1)
    const ghost = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: new THREE.Color(T.line), transparent: true, opacity: 0.7, toneMapped: false, depthWrite: false, fog: false }),
    )
    ghost.scale.setScalar(H)
    ghost.position.copy(sign.position)
    ghost.position.z += 0.05
    this.root.add(ghost)
    sign.userData.back = back
    this.crownSign = sign
    return { mat, ghost, frame }
  }
  private crownSign!: THREE.Mesh

  update(s: TowerState, time: number) {
    const built = THREE.MathUtils.clamp(s.built, 0, FLOORS)
    this.steelU.uBuilt.value = built
    this.slabU.uBuilt.value = Math.max(0, built - 1.5)
    this.glassU.uBuilt.value = THREE.MathUtils.clamp(s.glazed, 0, FLOORS)
    this.litU.uBuilt.value = THREE.MathUtils.clamp(s.fitted, 0, FLOORS)
    this.frontier = built * FLOOR_H
    // the concrete core leads the steel by two floors (jump-formed ahead)
    this.core.scale.y = Math.max(0.01, Math.min(TOWER_H, (built + 2) * FLOOR_H))
    this.ghostMat.uniforms.uFrontier.value = this.frontier
    this.ghostMat.uniforms.uGhost.value = s.ghost
    this.ghostMat.uniforms.uTime.value = time
    this.interiorMat.color.set('#ffd9a0').multiplyScalar(0.25 + 1.5 * s.night)
    // crown: lit sign once built; its blueprint outline before
    const crownOn = built >= FLOORS - 0.01 ? s.crown : 0
    this.crownFrame.visible = built >= FLOORS - 0.5
    this.crownSign.visible = crownOn > 0.001
    ;(this.crownSign.userData.back as THREE.Mesh).visible = crownOn > 0.001
    this.crownMat.color.set(T.signal).multiplyScalar(0.2 + crownOn * (1.6 + 1.6 * s.night))
    ;(this.crownGhost.material as THREE.LineBasicMaterial).opacity = 0.75 * s.ghost * (1 - crownOn)
    this.crownGhost.visible = s.ghost * (1 - crownOn) > 0.01
  }
}
