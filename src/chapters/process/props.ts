import * as THREE from 'three'
import { FLOOR_H, T, TOWER_W, iBeamGeometry, mergeAll } from '../../kit/steel'

/*
 * Blueprint chapter props, built at real scale (metres). Small things are
 * merged into one vertex-coloured geometry each, so a surveyor, a total
 * station or a BMU cradle costs one draw call and shares one material.
 */

const HALF = TOWER_W / 2
const BAY = TOWER_W / 5

/** One shared vertex-coloured material for all the small painted props. */
let propMat: THREE.MeshStandardMaterial | null = null
export function paintedMat() {
  if (!propMat) propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.12 })
  return propMat
}

type Part = { g: THREE.BufferGeometry; c: THREE.ColorRepresentation }

/** Merge parts into one non-indexed geometry with a per-vertex colour. */
export function mergePainted(parts: Part[]): THREE.BufferGeometry {
  const col = new THREE.Color()
  let count = 0
  const prepped = parts.map(p => {
    const g = p.g.index ? p.g.toNonIndexed() : p.g
    if (!g.attributes.normal) g.computeVertexNormals()
    count += g.attributes.position.count
    return { g, c: p.c }
  })
  const pos = new Float32Array(count * 3)
  const nor = new Float32Array(count * 3)
  const clr = new Float32Array(count * 3)
  let o = 0
  for (const { g, c } of prepped) {
    const n = g.attributes.position.count
    pos.set(g.attributes.position.array as Float32Array, o * 3)
    nor.set(g.attributes.normal.array as Float32Array, o * 3)
    col.set(c)
    for (let i = 0; i < n; i++) {
      clr[(o + i) * 3] = col.r
      clr[(o + i) * 3 + 1] = col.g
      clr[(o + i) * 3 + 2] = col.b
    }
    o += n
    g.dispose()
  }
  for (const p of parts) p.g.dispose()
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  out.setAttribute('color', new THREE.BufferAttribute(clr, 3))
  out.computeBoundingSphere()
  return out
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return g
}

/** A cylinder (radius r) from a to b. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6) {
  const L = a.distanceTo(b)
  const g = new THREE.CylinderGeometry(r, r, L, seg, 1)
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()))
  const m = a.clone().add(b).multiplyScalar(0.5)
  g.translate(m.x, m.y, m.z)
  return g
}

const WEAR = '#262b31'
const SKIN = '#b4876a'
const TAPE = '#dfe3e6'

/**
 * A site worker, 1.8 m, facing +z: dark workwear, a hi-vis vest with a
 * reflective band, a hard hat. `reach` raises the right arm forward
 * (radians); `hat` colours the helmet.
 */
export function workerGeometry(o: { reach?: number; reachL?: number; hat?: string; vest?: string } = {}) {
  const parts: Part[] = []
  const vest = o.vest ?? T.safety
  parts.push({ g: box(0.15, 0.86, 0.17, -0.1, 0.43, 0), c: WEAR })
  parts.push({ g: box(0.15, 0.86, 0.17, 0.1, 0.43, 0), c: WEAR })
  parts.push({ g: box(0.13, 0.08, 0.26, -0.1, 0.04, 0.04), c: '#15181b' })
  parts.push({ g: box(0.13, 0.08, 0.26, 0.1, 0.04, 0.04), c: '#15181b' })
  parts.push({ g: box(0.42, 0.62, 0.25, 0, 1.17, 0), c: vest })
  parts.push({ g: box(0.43, 0.06, 0.26, 0, 1.06, 0), c: TAPE })
  parts.push({ g: box(0.43, 0.06, 0.26, 0, 1.3, 0), c: TAPE })
  const arm = (side: number, reach: number) => {
    const g = new THREE.BoxGeometry(0.11, 0.62, 0.12)
    g.translate(0, -0.31, 0)
    g.rotateX(-reach)
    g.rotateZ(side * 0.08)
    g.translate(side * 0.27, 1.45, 0)
    return g
  }
  parts.push({ g: arm(1, o.reach ?? 0.15), c: WEAR })
  parts.push({ g: arm(-1, o.reachL ?? 0.1), c: WEAR })
  const head = new THREE.SphereGeometry(0.105, 12, 8)
  head.translate(0, 1.6, 0)
  parts.push({ g: head, c: SKIN })
  const hat = new THREE.SphereGeometry(0.128, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2)
  hat.translate(0, 1.64, 0)
  parts.push({ g: hat, c: o.hat ?? '#f4f1ea' })
  const brim = new THREE.CylinderGeometry(0.16, 0.16, 0.018, 14)
  brim.translate(0, 1.645, 0.02)
  parts.push({ g: brim, c: o.hat ?? '#f4f1ea' })
  return mergePainted(parts)
}

/**
 * Total station on a tripod. Returns the root (tripod) plus the alidade
 * (turns in azimuth about +y) and the telescope (tilts about +x); the laser
 * leaves the telescope's front at `muzzle` (telescope-local, +z).
 */
export function totalStation() {
  const root = new THREE.Group()
  const head = new THREE.Vector3(0, 1.3, 0)
  const legs: Part[] = []
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4
    const foot = new THREE.Vector3(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55)
    legs.push({ g: rod(head.clone().add(new THREE.Vector3(Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06)), foot, 0.024), c: '#d99a1e' })
    const tip = foot.clone().lerp(head, 0.1)
    legs.push({ g: rod(foot, tip, 0.03), c: '#23272c' })
  }
  const plate = new THREE.CylinderGeometry(0.1, 0.1, 0.05, 16)
  plate.translate(0, 1.33, 0)
  legs.push({ g: plate, c: '#23272c' })
  const tripod = new THREE.Mesh(mergePainted(legs), paintedMat())
  root.add(tripod)

  const alidade = new THREE.Group()
  alidade.position.y = 1.36
  root.add(alidade)
  const body: Part[] = []
  const tri = new THREE.CylinderGeometry(0.085, 0.095, 0.06, 16)
  tri.translate(0, 0.03, 0)
  body.push({ g: tri, c: '#1b1f24' })
  body.push({ g: box(0.25, 0.12, 0.17, 0, 0.12, 0), c: T.craneYellow })
  body.push({ g: box(0.16, 0.07, 0.01, 0, 0.13, -0.09), c: '#10161c' })
  body.push({ g: box(0.05, 0.2, 0.13, -0.1, 0.27, 0), c: T.craneYellow })
  body.push({ g: box(0.05, 0.2, 0.13, 0.1, 0.27, 0), c: T.craneYellow })
  body.push({ g: box(0.2, 0.03, 0.04, 0, 0.4, 0), c: '#1b1f24' })
  alidade.add(new THREE.Mesh(mergePainted(body), paintedMat()))

  const scope = new THREE.Group()
  scope.position.y = 0.28
  alidade.add(scope)
  const tube = new THREE.CylinderGeometry(0.048, 0.042, 0.24, 14)
  tube.rotateX(Math.PI / 2)
  const ring = new THREE.CylinderGeometry(0.052, 0.052, 0.03, 14)
  ring.rotateX(Math.PI / 2)
  ring.translate(0, 0, 0.11)
  scope.add(new THREE.Mesh(mergePainted([{ g: tube, c: '#2a3036' }, { g: ring, c: '#8b949c' }]), paintedMat()))

  root.traverse(o => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true
  })
  return { root, alidade, scope, muzzle: new THREE.Vector3(0, 0, 0.13) }
}

/**
 * A BMU cradle (window-cleaning gondola): 5 m aluminium platform with guard
 * rails, yellow toe boards, orange hoist units at each end and rubber
 * rollers on the wall side. Long axis x, the glass is toward +z, floor y 0.
 */
export function gondolaGeometry() {
  const L = 5
  const D = 0.8
  const P: Part[] = []
  const alu = '#aab2b9'
  P.push({ g: box(L, 0.08, D, 0, 0.04, 0), c: '#6c747c' })
  for (const z of [-D / 2, D / 2]) {
    P.push({ g: box(L, 0.05, 0.05, 0, 1.1, z), c: alu })
    P.push({ g: box(L, 0.04, 0.04, 0, 0.58, z), c: alu })
    P.push({ g: box(L, 0.16, 0.02, 0, 0.16, z), c: T.craneYellow })
    for (let i = 0; i <= 4; i++) P.push({ g: box(0.05, 1.1, 0.05, -L / 2 + (i * L) / 4, 0.55, z), c: alu })
  }
  for (const s of [-1, 1]) {
    // hoist unit + stirrup frame at each end
    P.push({ g: box(0.36, 0.55, 0.5, s * (L / 2 + 0.18), 0.75, 0), c: T.safety })
    P.push({ g: box(0.06, 1.6, 0.06, s * (L / 2 + 0.18), 1.3, 0), c: alu })
    P.push({ g: box(0.4, 0.06, 0.06, s * (L / 2 + 0.18), 2.1, 0), c: alu })
    const roller = new THREE.CylinderGeometry(0.09, 0.09, 0.12, 12)
    roller.rotateX(Math.PI / 2)
    roller.translate(s * (L / 2 - 0.3), 0.95, D / 2 + 0.16)
    P.push({ g: roller, c: '#15181b' })
    P.push({ g: box(0.05, 0.05, 0.2, s * (L / 2 - 0.3), 0.95, D / 2 + 0.06), c: alu })
  }
  return mergePainted(P)
}

/** Rope anchor points on the cradle (local): the tops of the stirrup frames. */
export const GONDOLA_ROPES = [new THREE.Vector3(-2.68, 2.13, 0), new THREE.Vector3(2.68, 2.13, 0)]

/**
 * The brace on the +x face that fills in the ghost's diagonal: segment k
 * (floor 50+k) runs from (15, 200+4k, 15-6k) to (15, 204+4k, 9-6k). Returns
 * its end points (at the column/beam joints).
 */
export function braceEnds(k: number) {
  const f = 50 + k
  const a = new THREE.Vector3(HALF, f * FLOOR_H, HALF - k * BAY)
  const b = new THREE.Vector3(HALF, (f + 1) * FLOOR_H, HALF - (k + 1) * BAY)
  return { a, b }
}

/** Wide-flange brace geometry along +x, centred, a little shorter than the joint-to-joint length. */
export function braceGeometry(len: number) {
  const g = iBeamGeometry(len, { depth: 0.36, width: 0.3, flange: 0.03, web: 0.02 })
  g.translate(-len / 2, 0, 0)
  // bolted end plates
  const parts: THREE.BufferGeometry[] = [g]
  for (const s of [-1, 1]) {
    const p = new THREE.BoxGeometry(0.03, 0.52, 0.4)
    p.translate((s * len) / 2, 0, 0)
    parts.push(p)
  }
  return mergeAll(parts)
}

/** Orientation that lays a +x member along `dir` with its flanges parallel to the +x face. */
export function braceQuaternion(dir: THREE.Vector3) {
  const x = dir.clone().normalize()
  const z = new THREE.Vector3(1, 0, 0)
  const y = z.clone().cross(x).normalize()
  const zz = x.clone().cross(y).normalize()
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, zz))
}

/**
 * The drawing for the next floors: steel grid, columns, curtain-wall
 * mullions on two faces, the brace diagonal, a dimension string and level
 * marks — plain line segments (absolute metres) for the blueprint shader.
 */
export function modelLines(from: number, to: number, o: { mullions: boolean }) {
  const pts: number[] = []
  const seg = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => pts.push(ax, ay, az, bx, by, bz)
  for (let f = from; f <= to; f++) {
    const y = f * FLOOR_H
    for (let i = 0; i <= 5; i++) {
      const c = -HALF + i * BAY
      seg(-HALF, y, c, HALF, y, c)
      seg(c, y, -HALF, c, y, HALF)
    }
    // slab edge, drawn a little outboard (double line reads as a section)
    const e = HALF + 0.3
    seg(-e, y - 0.24, -e, e, y - 0.24, -e)
    seg(e, y - 0.24, -e, e, y - 0.24, e)
    seg(e, y - 0.24, e, -e, y - 0.24, e)
    seg(-e, y - 0.24, e, -e, y - 0.24, -e)
  }
  for (let f = from; f < to; f++) {
    const y0 = f * FLOOR_H
    const y1 = y0 + FLOOR_H
    for (let i = 0; i <= 5; i++)
      for (let j = 0; j <= 5; j++) {
        const x = -HALF + i * BAY
        const z = -HALF + j * BAY
        const edge = i === 0 || i === 5 || j === 0 || j === 5
        if (edge) {
          // perimeter columns drawn as a pair of lines (a steel section)
          seg(x - 0.28, y0, z, x - 0.28, y1, z)
          seg(x + 0.28, y0, z, x + 0.28, y1, z)
        } else seg(x, y0, z, x, y1, z)
      }
    if (o.mullions) {
      const g = HALF + 0.45
      // -z face and +x face: mullions every 1.5 m, a transom at sill height
      for (let k = 0; k <= 20; k++) {
        const c = -HALF + k * 1.5
        seg(c, y0, -g, c, y1, -g)
        seg(g, y0, c, g, y1, c)
      }
      seg(-HALF, y0 + 0.9, -g, HALF, y0 + 0.9, -g)
      seg(g, y0 + 0.9, -HALF, g, y0 + 0.9, HALF)
    }
    // the brace diagonal on the +x face continues up the ghost's line
    const k = f - 50
    if (k >= 0 && k < 5) {
      const { a, b } = braceEnds(k)
      seg(a.x + 0.02, a.y, a.z, b.x + 0.02, b.y, b.z)
    }
  }
  // dimension string at the (+x, +z) corner, 4.5 m outboard, with 45° ticks
  const dx = HALF + 4.5
  const dz = HALF + 4.5
  seg(dx, from * FLOOR_H, dz, dx, to * FLOOR_H, dz)
  for (let f = from; f <= to; f++) {
    const y = f * FLOOR_H
    seg(dx - 0.32, y - 0.45, dz + 0.32, dx + 0.32, y + 0.45, dz - 0.32)
    seg(dx + 0.9, y, dz + 0.9, HALF + 0.9, y, HALF + 0.9)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  g.computeBoundingBox()
  return g
}

/**
 * Cyan drafting linework with a pen: `uDraw` (0..1) reveals it bottom-up
 * between uMinY..uMaxY with a bright pen line at the front; anything below
 * `uFrontier` (the steel that has filled it in) fades away.
 */
export function draftMaterial(minY: number, maxY: number) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
    uniforms: {
      uColor: { value: new THREE.Color(T.line) },
      uOpacity: { value: 1 },
      uDraw: { value: 0 },
      uMinY: { value: minY },
      uMaxY: { value: maxY },
      uFrontier: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying float vY;
      void main() { vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity, uDraw, uMinY, uMaxY, uFrontier; varying float vY;
      void main() {
        float h = (vY - uMinY) / max(uMaxY - uMinY, 1e-4);
        float drawn = 1.0 - smoothstep(uDraw - 0.015, uDraw, h);
        float pen = 1.0 - smoothstep(0.0, 0.05, abs(h - uDraw));
        float filled = smoothstep(uFrontier - 0.5, uFrontier + 1.5, vY);
        float a = (drawn * 0.85 + pen * 1.6 * step(0.001, uDraw) * (1.0 - step(0.999, uDraw))) * filled * uOpacity;
        if (a <= 0.002) discard;
        gl_FragColor = vec4(uColor * a, 1.0);
      }
    `,
  })
}

/** Diamond survey marks (constant pixel size), one per point; `aVis` 0..1 each. */
export function diamondPoints(n: number, color: THREE.ColorRepresentation, sizePx: number) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage))
  g.setAttribute('aVis', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage))
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
    uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(1.6) }, uSize: { value: sizePx } },
    vertexShader: /* glsl */ `
      attribute float aVis; uniform float uSize; varying float vVis;
      void main() {
        vVis = aVis;
        gl_PointSize = uSize * clamp(aVis, 0.0, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; varying float vVis;
      void main() {
        if (vVis <= 0.001) discard;
        vec2 c = abs(gl_PointCoord - 0.5);
        float d = c.x + c.y;
        float ring = smoothstep(0.3, 0.36, d) * (1.0 - smoothstep(0.44, 0.5, d));
        float core = 1.0 - smoothstep(0.06, 0.12, d);
        float a = (ring + core) * vVis;
        if (a <= 0.002) discard;
        gl_FragColor = vec4(uColor * a, 1.0);
      }
    `,
  })
  const p = new THREE.Points(g, m)
  p.frustumCulled = false
  return p
}

/**
 * The core-top deck kit: a yellow guard rail round the 9 x 9 m jump-form
 * top (posts, top + mid rail, toe board) and a gang box. Floor at y 0.
 */
export function deckGeometry() {
  const P: Part[] = []
  // gang box + a coil of hose (the jump-form rig's own rail rings the core top)
  P.push({ g: box(1.3, 0.7, 0.62, -2.9, 0.35, 2.6), c: '#27364a' })
  P.push({ g: box(1.32, 0.08, 0.64, -2.9, 0.74, 2.6), c: T.craneYellow })
  const coil = new THREE.TorusGeometry(0.34, 0.06, 6, 18)
  coil.rotateX(Math.PI / 2)
  coil.translate(-1.6, 0.07, 3.2)
  P.push({ g: coil, c: '#15181b' })
  return mergePainted(P)
}
