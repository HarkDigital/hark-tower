import * as THREE from 'three'
import { FLOOR_H, FLOORS, MAT, T, TOWER_W, hssGeometry, iBeamGeometry, mergeAll } from '../kit/steel'
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
 * the few pieces being placed right now hang a little above their seats and
 * settle (steel drops in, curtain-wall units swing in from outside, metal deck
 * and concrete spread across the floor like a pour).
 *
 * Sequence per floor (what real steel-frame towers look like going up):
 *   steel (built) → metal deck (built - 0.8) → concrete (built - 1.6)
 *   → curtain wall (glazed) → interiors lit (fitted)
 *
 * The curtain wall is one instanced plane per 1.545 x 4 m module with a
 * shader that draws the mullions, transoms and spandrel band, tilts each
 * pane's normal a little (real glazing never reflects as one flat mirror), and
 * lights the offices behind fitted floors (warm, bay by bay; strongest at dusk).
 *
 * Geometry: 30 x 30 m, 5 x 5 bays of 6 m, FLOORS floors of FLOOR_H. Centred on
 * the origin, ground at y = 0, main face toward +z.
 */

const BAYS = 5
const BAY = TOWER_W / BAYS
const HALF = TOWER_W / 2
export const TOWER_H = FLOORS * FLOOR_H
/** base of the crown sign (m) */
export const CROWN_Y = TOWER_H + 3
/** height of the crown sign (m) */
export const CROWN_H = 22
/** curtain wall plane offset from the grid line (m) */
const GLASS_OUT = 0.45
const GLASS_HALF = HALF + GLASS_OUT
const GLASS_PER = 20
const GLASS_MOD = (GLASS_HALF * 2) / GLASS_PER

type Uniforms = {
  uBuilt: { value: number }
  /** metres a piece hangs above its seat when it appears */
  uDrop: { value: number }
  /** floors over which a piece travels from appearing to landing */
  uWin: { value: number }
  /** metres a piece starts outboard (local +z, curtain wall) */
  uOut: { value: number }
  /** 1 = spread across the floor from -x (deck, concrete pours) */
  uPour: { value: number }
}
const U = (drop: number, win: number, out = 0, pour = 0): Uniforms => ({
  uBuilt: { value: 0 },
  uDrop: { value: drop },
  uWin: { value: win },
  uOut: { value: out },
  uPour: { value: pour },
})
/** shared by every erected part: the top of the tower sways by this (m at the top) */
const SWAY = { uSway: { value: 0 }, uSwayPhase: { value: 0 } }

const ERECT_HEAD = /* glsl */ `
  attribute float aFloor;
  uniform float uBuilt, uDrop, uWin, uOut, uPour;
  uniform float uSway, uSwayPhase;
`
const ERECT_BODY = /* glsl */ `
  // a piece appears when uBuilt reaches aFloor and lands uWin floors later
  float kk = clamp((uBuilt - aFloor) / uWin, 0.0, 1.0);
  transformed *= step(0.0001, kk);
  float fall = 1.0 - kk;
  float ease = fall * fall;
  transformed.y += ease * uDrop;
  transformed.z += ease * uOut;
  // pours spread across the floor plate from the -x edge
  transformed.x = mix(transformed.x, -${(HALF + 0.3).toFixed(2)} + (transformed.x + ${(HALF + 0.3).toFixed(2)}) * kk, uPour);
  // wind sway: grows with the square of height (a cantilever), in x and a little z
  float hRel = clamp((instanceMatrix[3].y + transformed.y) / ${TOWER_H.toFixed(1)}, 0.0, 1.2);
  transformed.x += uSway * hRel * hRel * sin(uSwayPhase);
  transformed.z += uSway * 0.35 * hRel * hRel * cos(uSwayPhase * 0.83);
`

type Patch = (shader: THREE.WebGLProgramParametersWithUniforms) => void

/** Patch a material (and a depth material) so instances erect by aFloor vs uBuilt. */
function erect(mat: THREE.Material, u: Uniforms, key: string, extra?: Patch) {
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u, SWAY)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${ERECT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${ERECT_BODY}`)
    extra?.(shader)
  }
  mat.customProgramCacheKey = () => `erect-${key}`
}

function depthFor(u: Uniforms, key: string) {
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  erect(d, u, `${key}-depth`)
  return d
}

const HASH = /* glsl */ `
  float twHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float twLine(float d, float w) { float fw = max(fwidth(d), 1e-4); return 1.0 - smoothstep(w - fw, w + fw, d); }
`

export interface TowerState {
  /** sway amplitude at the top (m) and its phase (radians) */
  sway: number
  swayPhase: number
  built: number
  glazed: number
  fitted: number
  ghost: number
  crown: number
  /** 0 day … 1 night: interior lights and the crown glow more at night */
  night: number
  /** camera distance to the crown (m): the halo fades up close */
  camToCrown?: number
}

export class Tower {
  root = new THREE.Group()
  private steelU = U(3.2, 0.06)
  private deckU = U(0, 0.25, 0, 1)
  private slabU = U(0, 0.3, 0, 1)
  private glassU = U(0.9, 0.12, 1.6)
  private glassFx = { uFitted: { value: 0 }, uInterior: { value: 0.1 }, uNight: { value: 0 } }
  private coreMat: THREE.MeshStandardMaterial
  private core: THREE.Mesh
  private ghostMat: THREE.ShaderMaterial
  private crownMat: THREE.MeshBasicMaterial
  private crownGhost: THREE.LineSegments
  private crownParts: THREE.Object3D[] = []
  private crownHalo: THREE.Mesh
  private crownBand: THREE.MeshBasicMaterial
  private crownSign!: THREE.Mesh
  /** height of the highest erected steel (m) — chapters frame around this */
  frontier = 0

  constructor(private mobile: boolean) {
    this.root.name = 'tower'
    this.buildSteel()
    this.buildDeck()
    this.buildSlabs()
    this.coreMat = this.coreMaterial()
    this.core = this.buildCore()
    this.buildGlass()
    this.ghostMat = this.buildGhost()
    const crown = this.buildCrown()
    this.crownMat = crown.mat
    this.crownGhost = crown.ghost
    this.crownHalo = crown.halo
    this.crownBand = crown.band
  }

  /**
   * Every instanced batch is ordered by aFloor, so each frame the draw count
   * is trimmed to the pieces that exist (plus the ones in the air): unbuilt
   * floors cost nothing, in the main pass or the shadow pass.
   */
  private batches: { mesh: THREE.InstancedMesh; floors: Float32Array; u: Uniforms }[] = []

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], floors: number[], u: Uniforms, key: string, shadow = true, extra?: Patch) {
    erect(mat, u, key, extra)
    const mesh = new THREE.InstancedMesh(geo, mat, mats.length)
    this.batches.push({ mesh, floors: Float32Array.from(floors), u })
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
    // columns: HSS with a base plate / splice collar at the foot (reads as bolted steel)
    const col = mergeAll([hssGeometry(FLOOR_H, 0.55), new THREE.BoxGeometry(0.78, 0.1, 0.78).translate(0, 0.05, 0), new THREE.BoxGeometry(0.66, 0.35, 0.66).translate(0, 1.2, 0)])
    this.instanced(col, MAT.steel().clone(), colMats, colFloors, this.steelU, 'col')
    this.instanced(iBeamGeometry(BAY, { depth: 0.55, width: 0.26 }), MAT.primer().clone(), beamMats, beamFloors, this.steelU, 'beam')
  }

  /** Galvanised metal deck: laid on the steel before the pour (ribbed). */
  private buildDeck() {
    const mats: THREE.Matrix4[] = []
    const floors: number[] = []
    for (let f = 1; f < FLOORS; f++) {
      mats.push(new THREE.Matrix4().makeTranslation(0, f * FLOOR_H + 0.03, 0))
      floors.push(f)
    }
    const g = new THREE.BoxGeometry(TOWER_W + 0.2, 0.06, TOWER_W + 0.2)
    const mat = new THREE.MeshStandardMaterial({ color: '#8d959c', metalness: 0.7, roughness: 0.45 })
    this.instanced(g, mat, mats, floors, this.deckU, 'deck', true, shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vDeckX;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDeckX = position.x;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vDeckX;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          // 300 mm deck ribs (fades with distance so it never shimmers)
          float rib = abs(fract(vDeckX / 0.3) - 0.5);
          float fw = fwidth(vDeckX / 0.3);
          diffuseColor.rgb *= mix(1.0, 0.78 + 0.22 * smoothstep(0.1, 0.3, rib), 1.0 - smoothstep(0.15, 0.5, fw));`,
        )
    })
  }

  private buildSlabs() {
    const mats: THREE.Matrix4[] = []
    const floors: number[] = []
    for (let f = 1; f <= FLOORS; f++) {
      mats.push(new THREE.Matrix4().makeTranslation(0, f * FLOOR_H - 0.07, 0))
      floors.push(f)
    }
    // top at +0.12 covers the deck (+0.06) once poured, with depth margin at 250 m
    const g = new THREE.BoxGeometry(TOWER_W + 0.6, 0.38, TOWER_W + 0.6)
    this.instanced(g, MAT.concrete().clone(), mats, floors, this.slabU, 'slab')
  }

  /** Board-formed concrete: pour joints every lift, panel joints, tie holes. */
  private coreMaterial() {
    const mat = (MAT.concreteDark() as THREE.MeshStandardMaterial).clone()
    mat.color.set('#8a867e')
    mat.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCoreW;\nvarying vec3 vCoreN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCoreW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvCoreN = normal;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vCoreW;\nvarying vec3 vCoreN;\n${HASH}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            float u = abs(vCoreN.x) > 0.5 ? vCoreW.z : vCoreW.x;
            float y = vCoreW.y;
            float lift = floor(y / 4.0);
            // each pour lift a slightly different tone, a dark joint between lifts
            diffuseColor.rgb *= 0.92 + 0.12 * twHash(vec2(lift, floor(u / 2.4) * 0.37));
            diffuseColor.rgb *= 1.0 - 0.35 * twLine(abs(fract(y / 4.0 + 0.5) - 0.5) * 4.0, 0.03);
            diffuseColor.rgb *= 1.0 - 0.12 * twLine(abs(fract(u / 2.4 + 0.5) - 0.5) * 2.4, 0.015);
            // form-tie holes on a 0.6 x 0.6 m grid
            vec2 t = abs(fract(vec2(u, y) / 0.6) - 0.5) * 0.6;
            diffuseColor.rgb *= 1.0 - 0.3 * twLine(length(t), 0.025);
            // the top lift is still green (fresh, darker)
            diffuseColor.rgb *= mix(1.0, 0.8, smoothstep(-4.0, 0.0, y - uCoreTop));
          }`,
        )
        .replace('#include <common>', '#include <common>\nuniform float uCoreTop;')
      shader.uniforms.uCoreTop = this.coreTopU
    }
    mat.customProgramCacheKey = () => 'tower-core'
    return mat
  }
  private coreTopU = { value: 8 }

  private buildCore() {
    const g = new THREE.BoxGeometry(9, 1, 9)
    g.translate(0, 0.5, 0)
    const core = new THREE.Mesh(g, this.coreMat)
    core.castShadow = !this.mobile
    core.receiveShadow = !this.mobile
    this.root.add(core)
    return core
  }

  private buildGlass() {
    const mats: THREE.Matrix4[] = []
    const floors: number[] = []
    const colors: number[] = []
    const q = new THREE.Quaternion()
    const col = new THREE.Color()
    // a darker, more neutral base than the kit's glass: from a distance real
    // reflective glazing reads blue-grey, not bright blue
    const base = new THREE.Color('#6a8594')
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let f = 0; f < FLOORS; f++) {
      for (let side = 0; side < 4; side++) {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (side * Math.PI) / 2)
        for (let k = 0; k < GLASS_PER; k++) {
          const x = -GLASS_HALF + (k + 0.5) * GLASS_MOD
          const p = new THREE.Vector3(x, f * FLOOR_H + FLOOR_H / 2, GLASS_HALF).applyQuaternion(q)
          mats.push(new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)))
          floors.push(f + ((side * GLASS_PER + k) / (4 * GLASS_PER)) * 0.999)
          // real curtain walls are never perfectly uniform: slight per-unit tint variation
          col.copy(base).offsetHSL((rnd() - 0.5) * 0.02, (rnd() - 0.5) * 0.05, (rnd() - 0.5) * 0.06)
          colors.push(col.r, col.g, col.b)
        }
      }
    }
    const g = new THREE.PlaneGeometry(GLASS_MOD, FLOOR_H)
    const mat = MAT.glass().clone() as THREE.MeshStandardMaterial
    const fx = this.glassFx
    const mesh = this.instanced(g, mat, mats, floors, this.glassU, 'glass', false, shader => {
      Object.assign(shader.uniforms, fx)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vPaneUv;\nvarying vec3 vPaneSeed;\nvarying float vPaneFloor;\nvarying vec3 vPaneT;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vPaneUv = uv;
          vPaneSeed = instanceMatrix[3].xyz;
          vPaneFloor = floor(aFloor);
          vPaneT = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * vec3(1.0, 0.0, 0.0));`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uFitted, uInterior, uNight;
          varying vec2 vPaneUv;
          varying vec3 vPaneSeed;
          varying float vPaneFloor;
          varying vec3 vPaneT;
          ${HASH}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          vec2 pu = vPaneUv * vec2(${GLASS_MOD.toFixed(4)}, ${FLOOR_H.toFixed(1)});
          float paneH = twHash(vPaneSeed.xz * 0.37 + vPaneSeed.y * 0.113);
          // mullions at the unit edges, transoms at the spandrel lines
          float mull = max(twLine(min(pu.x, ${GLASS_MOD.toFixed(4)} - pu.x), 0.045), max(twLine(abs(pu.y - 0.62), 0.03), twLine(abs(pu.y - 3.52), 0.03)));
          mull = max(mull, twLine(min(pu.y, ${FLOOR_H.toFixed(1)} - pu.y), 0.03));
          // spandrel band hides the slab edge + ceiling void (opaque glass on a dark back-pan)
          float spand = 1.0 - step(0.62, pu.y) * step(pu.y, 3.52);
          float vision = (1.0 - spand) * (1.0 - mull);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62, 0.64, 0.66), spand);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.085, 0.095, 0.105), mull);`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          roughnessFactor = mix(mix(0.035 + 0.05 * paneH, 0.16, spand), 0.42, mull);`,
        )
        .replace(
          '#include <metalnessmap_fragment>',
          `#include <metalnessmap_fragment>
          metalnessFactor = mix(0.94, 0.55, mull);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            // each unit sits a hair off true, and the vision glass pillows a little:
            // reflections break up pane by pane like a real curtain wall
            vec3 up = vec3(0.0, 1.0, 0.0);
            vec3 tilt = vPaneT * (paneH - 0.5) * 0.05 + up * (twHash(vPaneSeed.zy + 3.7) - 0.5) * 0.035;
            vec2 c = (pu - vec2(${(GLASS_MOD / 2).toFixed(3)}, 2.07)) / vec2(${(GLASS_MOD / 2).toFixed(3)}, 1.45);
            tilt += (vPaneT * c.x * 0.018 + up * c.y * 0.01) * vision;
            normal = normalize(normal + (viewMatrix * vec4(tilt, 0.0)).xyz);
          }`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            // offices behind fitted floors: lit bay by bay, brighter toward the ceiling
            float fitted = step(vPaneFloor + 0.35, uFitted);
            float bay = floor((vPaneSeed.x + vPaneSeed.z * 1.37 + 40.0) / 4.6);
            float hb = twHash(vec2(vPaneFloor * 1.31, bay));
            float on = step(0.3 - 0.12 * uNight, hb) * fitted;
            float ceil = smoothstep(1.6, 3.45, pu.y);
            float strip = twLine(abs(pu.y - 3.3), 0.06) * step(0.5, fract(pu.x / 0.77 + hb));
            vec3 warm = mix(vec3(1.0, 0.8, 0.55), vec3(0.85, 0.9, 1.0), step(0.78, twHash(vec2(bay, vPaneFloor + 7.0))));
            float facing = clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);
            float glow = on * vision * (0.28 + 0.72 * ceil + 1.6 * strip) * (0.35 + 0.65 * facing);
            totalEmissiveRadiance += warm * glow * uInterior * (0.75 + 0.5 * hb);
          }`,
        )
    })
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(colors), 3)
    mesh.receiveShadow = !this.mobile
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
    // the crown sign frame at the top
    seg(c(-9, TOWER_H, 0), c(-9, CROWN_Y + CROWN_H, 0))
    seg(c(9, TOWER_H, 0), c(9, CROWN_Y + CROWN_H, 0))
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    // normal blending (not additive): on a bright morning sky the linework
    // stays drawing-blue instead of washing out to white
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      uniforms: {
        uColor: { value: new THREE.Color('#6cc4ff') },
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
          float a = above * uGhost * (0.5 + scan);
          if (a <= 0.002) discard;
          gl_FragColor = vec4(uColor * (1.0 + scan * 1.5), clamp(a, 0.0, 1.0));
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
    const H = CROWN_H
    // roof + mechanical penthouse + the sign's steel frame (visible once topped out)
    const steel = MAT.steel()
    // (the roof slab is the top slab instance; this is the penthouse + parapet)
    const roofParts: THREE.BufferGeometry[] = [new THREE.BoxGeometry(20, 2.6, 14).translate(0, TOWER_H + 1.38, -4)]
    // parapet
    for (const s of [-1, 1]) {
      roofParts.push(new THREE.BoxGeometry(TOWER_W + 0.9, 1.2, 0.3).translate(0, TOWER_H + 1.1, s * (GLASS_HALF + 0.1)))
      roofParts.push(new THREE.BoxGeometry(0.3, 1.2, TOWER_W + 0.9).translate(s * (GLASS_HALF + 0.1), TOWER_H + 1.1, 0))
    }
    const roof = new THREE.Mesh(mergeAll(roofParts), MAT.concreteDark())
    roof.castShadow = roof.receiveShadow = !this.mobile
    const framePts: THREE.BufferGeometry[] = []
    for (const x of [-9, -3, 3, 9]) framePts.push(new THREE.BoxGeometry(0.5, H + 4, 0.5).translate(x, CROWN_Y + (H + 4) / 2 - 2.5, -1.2))
    for (const y of [CROWN_Y + 1, CROWN_Y + H * 0.5, CROWN_Y + H - 1]) framePts.push(new THREE.BoxGeometry(19, 0.4, 0.4).translate(0, y, -1.2))
    const frame = new THREE.Mesh(mergeAll(framePts), steel)
    frame.castShadow = !this.mobile
    this.root.add(roof, frame)
    this.crownParts.push(roof, frame)

    const sign = new THREE.Mesh(new THREE.ShapeGeometry(shapes, 12), MAT.signal(1).clone())
    const mat = sign.material as THREE.MeshBasicMaterial
    sign.scale.setScalar(H)
    sign.position.set(0, CROWN_Y + H / 2, 0.2)
    this.root.add(sign)
    const back = sign.clone()
    back.rotation.y = Math.PI
    back.position.z = -2.6
    this.root.add(back)
    sign.userData.back = back
    this.crownSign = sign

    // a soft green halo behind the sign (night haze around a lit crown)
    const haloTex = (() => {
      const c = document.createElement('canvas')
      c.width = c.height = 128
      const g = c.getContext('2d')!
      const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
      grd.addColorStop(0, 'rgba(255,255,255,1)')
      grd.addColorStop(0.35, 'rgba(255,255,255,0.35)')
      grd.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = grd
      g.fillRect(0, 0, 128, 128)
      return new THREE.CanvasTexture(c)
    })()
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(H * 2.4, H * 2.0),
      new THREE.MeshBasicMaterial({ map: haloTex, color: new THREE.Color(T.signal), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    )
    halo.position.set(0, CROWN_Y + H / 2, -0.8)
    halo.visible = false
    this.root.add(halo)

    // a green light line along the parapet (reads from every side at night)
    const band = new THREE.MeshBasicMaterial({ color: new THREE.Color(T.signal), toneMapped: false })
    const bandParts: THREE.BufferGeometry[] = []
    for (const s of [-1, 1]) {
      bandParts.push(new THREE.BoxGeometry(TOWER_W + 1.0, 0.18, 0.1).translate(0, TOWER_H + 1.62, s * (GLASS_HALF + 0.3)))
      bandParts.push(new THREE.BoxGeometry(0.1, 0.18, TOWER_W + 1.0).translate(s * (GLASS_HALF + 0.3), TOWER_H + 1.62, 0))
    }
    const bandMesh = new THREE.Mesh(mergeAll(bandParts), band)
    this.root.add(bandMesh)
    this.crownParts.push(bandMesh)

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
    return { mat, ghost, halo, band }
  }

  /** metres the top sways at this moment (x), for chapters that ride along */
  /** full sway offset (x and z) at a height, for things that ride the tower */
  swayOffset(y: number, out: THREE.Vector3) {
    const hRel = Math.min(1.2, Math.max(0, y / TOWER_H))
    const a = SWAY.uSway.value * hRel * hRel
    return out.set(a * Math.sin(SWAY.uSwayPhase.value), 0, a * 0.35 * Math.cos(SWAY.uSwayPhase.value * 0.83))
  }

  swayAt(y: number) {
    const hRel = Math.min(1.2, Math.max(0, y / TOWER_H))
    return SWAY.uSway.value * hRel * hRel * Math.sin(SWAY.uSwayPhase.value)
  }

  update(s: TowerState, time: number) {
    const built = THREE.MathUtils.clamp(s.built, 0, FLOORS)
    SWAY.uSway.value = s.sway
    SWAY.uSwayPhase.value = s.swayPhase
    // once topped out, let the last pieces of the top floor land too
    const top = built >= FLOORS - 1e-3
    this.steelU.uBuilt.value = top ? FLOORS + 0.5 : built
    this.deckU.uBuilt.value = top ? FLOORS + 0.5 : Math.max(0, built - 0.8)
    this.slabU.uBuilt.value = top ? FLOORS + 0.5 : Math.max(0, built - 1.6)
    this.glassU.uBuilt.value = THREE.MathUtils.clamp(s.glazed, 0, FLOORS)
    this.glassFx.uFitted.value = THREE.MathUtils.clamp(s.fitted, 0, FLOORS)
    this.glassFx.uNight.value = s.night
    this.glassFx.uInterior.value = 0.035 + 1.25 * s.night
    for (const b of this.batches) {
      // first instance that hasn't appeared yet (aFloor >= uBuilt), by binary search
      const v = b.u.uBuilt.value
      let lo = 0
      let hi = b.floors.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (b.floors[mid] < v) lo = mid + 1
        else hi = mid
      }
      b.mesh.count = lo
      b.mesh.visible = lo > 0
    }
    this.frontier = built * FLOOR_H
    // the concrete core leads the steel by two floors (jump-formed ahead)
    const coreTop = Math.max(0.01, Math.min(TOWER_H, (built + 2) * FLOOR_H))
    this.core.scale.y = coreTop
    this.coreTopU.value = coreTop
    this.ghostMat.uniforms.uFrontier.value = this.frontier
    this.ghostMat.uniforms.uGhost.value = s.ghost
    this.ghostMat.uniforms.uTime.value = time
    // crown: lit sign once built; its blueprint outline before
    const crownOn = built >= FLOORS - 0.01 ? s.crown : 0
    const topped = built >= FLOORS - 0.3
    for (const p of this.crownParts) p.visible = topped
    this.crownSign.visible = topped
    ;(this.crownSign.userData.back as THREE.Mesh).visible = topped
    // unlit it's a dark sign face; lit it glows Hark green (hotter at night)
    // capped so the sign keeps its Hark green instead of clipping to white
    this.crownMat.color.set(crownOn > 0.001 ? T.signal : T.graphite).multiplyScalar(crownOn > 0.001 ? 0.25 + crownOn * (1.1 + 0.55 * s.night) : 1)
    this.crownBand.color.set(T.signal).multiplyScalar(crownOn * (0.5 + 1.1 * s.night))
    const haloMat = this.crownHalo.material as THREE.MeshBasicMaterial
    const far = THREE.MathUtils.smoothstep(s.camToCrown ?? 200, 60, 170)
    haloMat.opacity = crownOn * (0.04 + 0.16 * s.night) * far
    this.crownHalo.visible = haloMat.opacity > 0.005
    ;(this.crownGhost.material as THREE.LineBasicMaterial).opacity = 0.75 * s.ghost * (1 - crownOn)
    this.crownGhost.visible = s.ghost * (1 - crownOn) > 0.01 && !topped
  }
}
